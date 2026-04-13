# 系统设计

更新时间：`2026-04-13`

## 设计摘要

CodexNamer 的主线路如下：

1. 扫描 Codex rollout 文件并抽取会话事实。
2. 将会话状态写入本地 SQLite。
3. 基于 rename context + naming builder 生成 candidate。
4. 用 `evaluateAutoRename()` 把会话判成 `skip / suggest / apply`。
5. 在需要时向 `~/.codex/session_index.jsonl` 追加正式 rename。
6. 通过 CLI、Local API、Web、TUI、daemon 暴露统一操作入口。

## 架构分层

```text
Codex filesystem
  |- ~/.codex/sessions/**/rollout-*.jsonl
  |- ~/.codex/session_index.jsonl
  |- ~/.codex/config.toml / auth.json
          |
          v
scanner / ingest
          |
          v
SQLite state DB
          |
          +--> naming + provider
          |       |- context builder
          |       |- heuristic
          |       `- AI provider
          |
          +--> writeback
          |       |- append session_index
          |       `- compact
          |
          +--> direct operators
          |       |- CLI
          |       `- standalone daemon
          |
          `--> Local API
                  |- Web UI
                  |- TUI
                  |- serve entry
                  `- daemon controller
```

## 组件职责

### scanner / ingest

- 扫描 rollout 文件
- 增量解析消息摘要、provider、cwd、token、task_complete
- 计算 revision 与 dirty

### SQLite state DB

- 存放 sessions / revisions / rename state / rename history / maintenance state / AI request logs
- 为 Web、TUI、CLI、daemon 提供统一视图

### naming + provider

- 构建 rename context
- 运行 heuristic 或 AI rename
- 按 `naming.builder` 拼装最终标题
- 执行重名规避

### writeback

- 只在 apply 时向 `session_index.jsonl` 追加记录
- 保持 latest-wins 语义
- 提供离线 compact

### Local API 与前端

- Local API：Fastify 路由、事件流、daemon controller、可选静态 Web 托管
- Web：Sessions / Settings / Maintenance / Requeue / Daemon 五个主视图
- TUI：browser / maintenance / daemon / settings 四个 screen mode

### 直接操作入口

- CLI：单次查询、rename、batch apply、doctor、provider test、serve/service
- standalone daemon：脱离 API 单独跑 sweep

## 关键设计选择

### 1. 不直接改 Codex SQLite

- 用户可见 rename 的正式持久化层是 `session_index.jsonl`
- SQLite 的内部 title 不是本项目的真 source of truth

### 2. builder-first 命名

- 当前最终标题结构由 `naming.builder` 决定
- `brief / detailed` 不再是当前 UI / 配置的主语义

### 3. 保护态只保留 `freeze`

- 调度层当前没有独立的 `manual override`
- 自动流程的高优先级保护态只有 `frozen`

### 4. dirty session 集合就是软队列

- 当前没有单独的持久化 task queue
- `dirty_since_rename || force_rewrite` 的 session 集合就是 sweep 的处理集合
- requeue 的本质是把会话重新打成 dirty，并清掉旧 candidate

### 5. accepted official name 归一化

- 当前只把 `ai` 和 `manual` 视为 accepted official rename source
- 非 accepted source 的 official name 会被视为待重写过渡态
- overview 统计会按这个口径统一

### 6. 请求日志内建到维护面板

- 所有 AI rename 请求都会写入 `ai_request_logs`
- Maintenance 页通过后端分页读取，不再只拉固定 40 条到前端

### 7. API 托管 daemon + standalone daemon 并存

- `npm run api` / `codexnamer serve` 默认会托管 daemon 子进程
- 同时仍保留 `npm run daemon` 这条独立运行路径，方便隔离验证和调试

## 运行模式

### 纯手动

- 用户通过 CLI / Web / TUI 手动 `suggest`、`apply`、`rename`

### preview-only

- daemon 或维护面板会给出 `skip / suggest / apply`
- 但不会自动写回

### auto-apply

- daemon 运行
- `rename.auto_apply = "idle-finalize"`
- `finalize_ready` 会话会真正落盘

补充：

- `npm run api` 与 `npm run serve` 现在默认会自动拉起 controller-managed daemon
- Web 的 Daemon 面板展示的是 controller 状态、下一次定时 sweep 倒计时和最近日志
