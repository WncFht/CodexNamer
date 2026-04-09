# 当前状态与 Pipeline 审查

更新时间：`2026-04-09`

## 1. 当前已经落地的主线

### 基础链路

- rollout 扫描与增量 ingest
- SQLite 状态库
- `session_index.jsonl` 读取 / 追加 / compact
- revision / dirty tracking

### rename 链路

- suggest / apply / manual rename
- freeze / unfreeze
- batch dirty apply
- auto-rename preview
- daemon auto-apply
- 按规则签名重新归队

### 配置与 AI

- builder-first naming policy
- prompt preview
- `responses | openai-compatible | none`
- `provider_source = codex-config | manual`
- provider parse / provider test

### UI / 运行态

- Web：Sessions / Settings / 状态 / Requeue / Daemon
- TUI：browser / settings / transcript / batch dirty apply
- 状态页请求日志：后端分页、每页 10 条、支持直接跳页
- overview 统计：按会话去重
- daemon 面板：显示 controller 状态与下一次定时 sweep 倒计时

## 2. 最近收敛掉的旧语义

下面这些不再是当前行为：

- `manual override`
- `brief / detailed` 风格切换
- `backend = "codex"`
- `codex exec` fallback
- 状态页前端一次性只看固定 40 条请求日志

## 3. 当前仍然存在的实现边界

### 3.1 调度还没真正消费 ingest 增量阈值

配置里有：

- `min_rollout_growth_bytes`
- `min_task_complete_delta`

但 `evaluateAutoRename()` 当前仍主要基于：

- dirty
- idle
- frozen
- cooldown
- `max_auto_renames_per_session`

### 3.2 auto-apply 还没有“稳定一轮”保护

当前 `finalize_ready` 在 daemon auto-apply 生效时就可能直接落盘，尚未引入“候选稳定一轮 sweep”这类额外 gate。

### 3.3 `freeze_manual_name` 仍是持久化配置，但还没进入调度主逻辑

Settings / 配置文件里仍保留该字段，但当前真正参与调度保护的是会话级 `freeze`。

### 3.4 provider 测试链仍需要持续整平

核心 provider 解析与请求路径已实现，但 provider 连通性相关测试仍有继续收敛空间。

## 4. 当前真相源

如果要判断“代码现在到底怎么跑”，请优先看：

- [README](../../README.md)
- [仓库总览](./repo-overview.md)
- [配置与 AI 后端](./config-and-ai.md)
- [Auto Rename 评估与 Context 构建](./rename-evaluation-and-context.md)
- [状态页说明](./status-page-guide.md)
