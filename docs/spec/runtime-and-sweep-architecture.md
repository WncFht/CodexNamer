# 运行时与 Sweep 架构

更新时间：`2026-04-09`

这份文档只描述**当前代码已经实现**的运行模型。

## 1. 一句话理解

当前系统不是“后台维护一张独立任务队列表”，而是：

1. 先持续维护每个 session 的本地状态
2. 把 `dirty` session 集合当成一条软队列
3. 由 sweep 每轮重新评估这些 dirty session 应该 `skip / suggest / apply`

## 2. 关键组件

### 原始输入

- `~/.codex/sessions/**/rollout-*.jsonl`
- `~/.codex/session_index.jsonl`

### 本地状态库

SQLite 里最关键的是：

- `sessions`
- `session_revisions`
- `rename_state`
- `rename_history`
- `maintenance_state`
- `ai_request_logs`

### Sweep 引擎

`runAutoRenameSweep()` 每轮会做三件事：

1. `scan()`：重新扫描 rollout 与 `session_index.jsonl`
2. 取出当前 dirty sessions
3. 对每个 dirty session 重新计算 `skip / suggest / apply`

### Daemon

daemon 只是“持续触发 sweep”的后台进程，不单独维护业务队列。

当前触发源有三类：

1. daemon 启动时立刻先跑一轮
2. 监听 rollout / `session_index.jsonl` 文件变化，1 秒 debounce 后补跑一轮
3. 按固定 interval 周期性跑一轮

## 3. 没有独立持久队列

当前没有一张单独的“待处理任务队列”表。

真正承担队列语义的是 `rename_state` 上的 dirty 相关字段：

- `dirty_since_rename`
- `force_rewrite`

当前代码里，一个 session 是否 dirty，等价于：

- `dirty_since_rename = 1`
- 或 `force_rewrite = 1`

所以：

- **dirty session 集合** 就是系统的“软队列”
- 每一轮 sweep 都会重新从数据库筛出 dirty sessions
- 不是把任务先塞进去、再按 task row 消费

## 4. 一轮 sweep 的真实流程

一轮正常 sweep 的顺序如下：

1. 扫描 rollout 文件，更新 `sessions / session_revisions`
2. 结合 revision 与 official name 状态，刷新 dirty 标记
3. 读取当前 dirty sessions
4. 对每个 dirty session 调 `evaluateAutoRename()`
5. 产出 `skip / suggest / apply`
6. 若当前运行态允许 auto-apply，则把命中的 `apply` 真正写回 `session_index.jsonl`
7. 把本轮 summary 写进 `maintenance_state.daemon_runtime`

## 5. Requeue 到底做了什么

`requeue` 不是插入一条后台任务。

当前做法是：

1. 先按规则签名和时间条件做 preview
2. 只把真正需要重评估的 sessions 重新标成 dirty
3. 清掉这些 sessions 旧的 candidate

具体落库效果是：

- `dirty_since_rename = 1`
- `force_rewrite = 1`
- `current_candidate_name = NULL`
- `current_candidate_source = NULL`
- `current_candidate_generated_at = NULL`
- `current_candidate_rule_signature = NULL`

所以下一次 sweep 看到它，就会把它当成“要重新命名”的 dirty session。

## 6. 规则签名如何参与 requeue

当前系统只维护一套全局命名规则，但每次正式 apply 都会记录当时的规则签名。

关键字段是：

- `rename_state.last_applied_rule_signature`
- `rename_state.current_candidate_rule_signature`
- `rename_history.rule_signature`

当前 requeue preview 的决策是：

- 规则签名不同：`queue`
- 内容 revision 已变化：`queue`
- 老数据没有规则签名：`queue`
- 已经用当前规则签名正式命名，且内容没变：`skip`
- `frozen` 或手动命名：默认 `skip`

## 7. 当前有哪些“状态”

### 会话生命周期状态

`status_estimate` 当前有：

- `discovered`
- `active`
- `candidate_ready`
- `finalize_ready`
- `applied`
- `idle`
- `archived_hint`
- `missing`

### Sweep 动作状态

每轮评估只会得到：

- `skip`
- `suggest`
- `apply`

### 规则覆盖状态

UI 当前把会话规则状态展示成：

- `latest`
- `outdated`
- `manual`
- `unknown`

### Daemon 相关状态

当前要分两层看：

1. **controller 状态**  
   来自 `/api/v1/daemon`，表示 API 进程当前有没有托管中的 daemon 子进程。

2. **runtime heartbeat 状态**  
   来自 `/api/v1/overview.runtime.daemonStatus`，表示最近一次成功 sweep 的 heartbeat 是：
   - `running`
   - `stale`
   - `not_seen`

Web 还会额外派生一个前端状态：

- `controller-running`

它表示 daemon 子进程已经起来了，但首轮 sweep 的 heartbeat 还没来得及写回。

## 8. controller 状态和 heartbeat 为什么可能不一致

这两者当前是故意分开的：

- `/api/v1/daemon` 看的是 API 当前这次进程里托管的子进程
- `/api/v1/overview` 看的是数据库里最近一次成功 sweep 落下的 runtime 快照

所以会出现两种真实场景：

1. daemon 已经启动，但首轮 sweep 还没写 heartbeat  
   这时 controller 会显示 running，overview 可能还是 `not_seen` 或旧状态。

2. daemon 已经停了，但数据库里还留着上一轮成功 sweep  
   这时 controller 会显示 stopped，overview 可能是 `stale`。

## 9. 默认运行方式

现在 `npm run api` 启动 Local API 时，会默认自动拉起一个 controller-managed daemon。

因此：

- `npm run web` 启动后的常见默认态，是 API 已经拉起 daemon
- Web 里的 Daemon 面板主要用于观察、停止、再启动
- 若用户需要脱离 API 独立运行，也仍然可以单独 `npm run daemon`

## 10. Daemon 面板里的倒计时是什么

Daemon 面板现在展示的是**下一次定时 sweep** 的倒计时。

它按 controller 当前 interval 计算，并在前端每 1 秒刷新一次。

需要注意：

- 这是“下一次周期性 sweep”的时间
- 如果 rollout 文件有变化，文件监听仍然可能触发更早的一轮 sweep
