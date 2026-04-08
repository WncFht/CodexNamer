# 系统设计

更新时间：`2026-04-09`

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
          `--> local API
                  |- CLI
                  |- Web
                  |- TUI
                  `- daemon controls
```

## 组件职责

### scanner / ingest

- 扫描 rollout 文件
- 增量解析消息摘要、provider、cwd、token、task_complete
- 计算 revision 与 dirty

### SQLite state DB

- 存放 sessions / revisions / rename state / rename history / maintenance state / AI request logs
- 为 Web、TUI、CLI 提供统一视图

### naming + provider

- 构建 rename context
- 运行 heuristic 或 AI rename
- 按 `naming.builder` 拼装最终标题
- 执行重名规避

### writeback

- 只在 apply 时向 `session_index.jsonl` 追加记录
- 保持 latest-wins 语义
- 提供离线 compact

### local API / UI

- CLI：单次查询、rename、batch apply、doctor、provider test
- Web：Sessions / Settings / 状态 / Daemon 四个主视图
- TUI：浏览、搜索、transcript、suggest/apply、freeze、manual rename、batch dirty apply

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

### 4. accepted official name 归一化

- 当前只把 `ai` 和 `manual` 视为 accepted official rename source
- 非 accepted source 的 official name 会被视为待重写过渡态
- overview 统计会按这个口径统一

### 5. 请求日志内建到状态面板

- 所有 AI rename 请求都会写入 `ai_request_logs`
- 状态页通过后端分页读取，不再只拉固定 40 条到前端

## 运行模式

### 纯手动

- 用户通过 CLI / Web / TUI 手动 `suggest`、`apply`、`rename`

### preview-only

- daemon 或状态页会给出 `skip / suggest / apply`
- 但不会自动写回

### auto-apply

- daemon 运行
- `rename.auto_apply = "idle-finalize"`
- `finalize_ready` 会话会真正落盘
