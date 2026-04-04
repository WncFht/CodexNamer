# 系统设计

## 设计摘要

Codex Session Manager 的主线路如下：

1. 监听并解析 Codex rollout 文件。
2. 将 session 内容抽取成结构化状态。
3. 用 heuristic 或 AI 生成候选 name。
4. 依据“dirty + idle + cooldown + policy”决定是否正式应用。
5. 通过向 `~/.codex/session_index.jsonl` 追加记录写回最终 name。
6. 用本地数据库承载 UI、批处理、历史记录和自动化状态。

## 架构分层

```text
Codex Filesystem
  |- ~/.codex/sessions/**/rollout-*.jsonl
  |- ~/.codex/session_index.jsonl
  |- ~/.codex/config.toml
          |
          v
Watcher / Scanner
          |
          v
Extractor / Revision Builder
          |
          v
State DB (SQLite)
          |
          +--> Rename Engine
          |       |- heuristic
          |       |- AI provider
          |       `- template renderer
          |
          +--> Writer
          |       |- append session_index
          |       `- compact-index
          |
          `--> Local API
                  |- CLI
                  |- WebUI
                  `- TUI
```

## 组件说明

### Watcher / Scanner

职责：

- 监听 rollout 文件增长
- 监听 `session_index.jsonl` 外部变化
- 定时全量 reconcile，避免只依赖文件系统事件

触发源：

- 文件创建
- 文件内容追加
- mtime / size 变化
- 周期性轮询

### Extractor

职责：

- 增量解析 rollout JSONL
- 抽取：
  - `thread_id`
  - `cwd`
  - `created_at`
  - `updated_at`
  - `first_user_message`
  - `last_user_message`
  - `last_agent_message`
  - `task_complete_count`
  - `token_total`
  - `model_provider`
  - `model`

输出：

- session 快照
- revision hash
- 实质更新信号

### State DB

职责：

- 作为本项目唯一 source of truth
- 记录 rename 状态、历史、dirty、manual override、freeze
- 承接 WebUI/TUI 的筛选和批量操作

### Rename Engine

职责：

- 生成候选 name
- 管理命名模板和风格
- 调用 AI 或 heuristic
- 负责长度限制、去重、回退规则

### Writer

职责：

- 在满足 apply 条件时向 `session_index.jsonl` 追加一条记录
- 做幂等检查，避免重复写
- 提供离线 compact

## 文件与数据流

### 输入文件

- `~/.codex/sessions/**/rollout-*.jsonl`
- `~/.codex/session_index.jsonl`
- `~/.codex/config.toml`

### 输出文件

- `~/.codex/session_index.jsonl`
- `~/.local/state/codex-session-manager/app.db`
- `~/.local/state/codex-session-manager/backups/*`
- `~/.local/state/codex-session-manager/logs/*`

## 关键设计选择

### 1. 不使用 SQLite 作为 rename 写回层

原因：

- 官方用户可见 rename 最终落在 `session_index.jsonl`
- SQLite 的 `threads.title` 对应的是内部抽取 title，不是用户 rename name
- 直接改 SQLite 风险更高，且与官方语义不对齐

### 2. 不依赖 wrapper

原因：

- 用户明确不希望修改 Codex 启动方式
- 我们接受“默认无法精确知道每次 clear/exit 边界”，转而使用 idle finalize + 可选 session log 增强

### 3. 本地 DB 与官方文件分层

原因：

- 官方文件只承担“最终可见名字”
- 本项目状态远多于官方 index，需要自己维护
- 这样 compact、dirty tracking、AI 配置、批量选择都能独立演进

## 服务模式

### daemon

职责：

- 常驻监控
- 处理自动 rename
- 提供本地 HTTP/Unix socket API

### CLI

职责：

- 单次查询、重命名、批处理、compact、诊断

### WebUI

职责：

- 可视化查看 sessions
- 配置规则和 provider
- 批量管理

### TUI

职责：

- 终端环境下快速筛选与批处理

## 运行模式

### 模式 A: 纯手动

- 用户只使用 CLI / WebUI / TUI
- 不启用自动 rename

### 模式 B: 观察 + 手动 apply

- daemon 持续计算候选名
- 用户手动决定何时 apply

### 模式 C: 自动 finalize

- daemon 在 idle 条件满足时自动 apply
- 仍保留 manual override 和 freeze

## 兼容性

目标兼容：

- 当前本机现有 Codex 数据目录结构
- 已经存在的 `session_index.jsonl`
- 没有 session log 的默认环境
- 继承 `~/.codex/config.toml` 中已有 provider/model 定义

非强兼容：

- 不承诺兼容未来 Codex 对 rollout 内部事件字段的所有变化
- 不承诺在所有版本上使用同一套“增强信号”逻辑

## 观测与诊断

项目需要内建：

- 文件扫描统计
- session 数量统计
- dirty / frozen / manual 数量
- 自动 rename 成功率
- compact 建议
- AI 调用失败率与回退原因
