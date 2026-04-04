# Codex Session Manager

Codex Session Manager 是一个独立于 `openai/codex` 的外置项目，用来管理
本地 Codex session 的命名、批量重命名、自动重命名、规则配置、AI 命名后端、
以及 `session_index.jsonl` 的维护与压缩。

这个项目明确不修改 Codex 的启动方式，也不依赖改动 Codex 源码。它通过读取
`~/.codex/sessions/**/rollout-*.jsonl` 理解 session 内容，并通过向
`~/.codex/session_index.jsonl` 追加 rename 记录来写回最终名称。

## 当前阶段

当前仓库已经完成 v1 第一阶段后端骨架，已具备这些能力：

- 扫描 `~/.codex/sessions/**/rollout-*.jsonl`
- 维护本地 SQLite 状态库
- 读取 / 追加 / compact `~/.codex/session_index.jsonl`
- 计算 revision 与 dirty 状态
- 单个与批量 rename
- rename history、freeze、manual override
- AI rename backend:
  - `none`
  - `openai-compatible`
  - `codex`

其中 `backend = "codex"` 的当前语义是：

- 优先继承 `~/.codex/config.toml` 的 provider/model
- 优先继承 `~/.codex/auth.json` 的认证
- 优先直接走 Responses / Chat Completions
- 只有直连不可用时才回退 `codex exec`

WebUI / TUI / 本地 API 目前仍处于详细设计阶段，见下方设计文档。

## 文档导航

- [系统设计](./docs/spec/system-design.md)
- [产品范围](./docs/spec/product-scope.md)
- [数据模型](./docs/spec/data-model.md)
- [触发与生命周期](./docs/spec/trigger-and-lifecycle.md)
- [CLI / API / UI 设计](./docs/spec/cli-api-ui.md)
- [WebUI / TUI / Local API 详细设计](./docs/spec/web-tui-local-api-design.md)
- [当前状态与 Pipeline 审查](./docs/spec/status-and-pipeline-review.md)
- [配置与 AI 后端](./docs/spec/config-and-ai.md)
- [维护与压缩](./docs/spec/maintenance-and-compaction.md)
- [实现路线图](./docs/spec/implementation-roadmap.md)
- [开放问题](./docs/spec/open-questions.md)
- [参考项目对照](./docs/research/reference-review.md)
- [ADR 0001: 写回层选择](./docs/adr/0001-writeback-via-session-index.md)
- [ADR 0002: 非 wrapper 架构](./docs/adr/0002-no-wrapper-architecture.md)

## 设计原则

1. 不碰 Codex SQLite。用户 rename 层与内部抽取 title 层必须分离。
2. 主写回层使用 `session_index.jsonl`，因为这就是官方 rename 的最终持久化层。
3. 自动 rename 不追求“每次更新都改名”，而是用“实质更新 + idle finalize”控制频率。
4. AI 命名不是强依赖。没有 AI 时也要能靠 heuristic 正常工作。
5. WebUI / TUI / CLI 必须复用同一套后端状态与 rename 引擎，避免分叉逻辑。
6. 先让“最终名字正确落盘”，再考虑“当前活跃界面立刻刷新”。

## 预期成果

v1 完成后，项目至少应支持：

- 查看本机 Codex sessions 列表与当前官方名称
- 标记“自上次 rename 以来已变化”的 dirty sessions
- 单个 session rename
- 批量 rename 选中 sessions
- 批量 rename 所有 dirty sessions
- 配置模板、规则和 AI 后端
- 自动 rename 的 idle/finalize 策略
- `session_index.jsonl` 的体积监控与离线 compact

## 已有命令

当前 CLI 已有：

- `codex-session list`
- `codex-session show --id <thread-id>`
- `codex-session suggest --id <thread-id>`
- `codex-session apply --id <thread-id>`
- `codex-session rename --id <thread-id> --name "..."`
- `codex-session history --id <thread-id>`
- `codex-session freeze --id <thread-id>`
- `codex-session unfreeze --id <thread-id>`
- `codex-session manual-override --id <thread-id>`
- `codex-session clear-manual-override --id <thread-id>`
- `codex-session batch apply --dirty`
- `codex-session compact-index --dry-run`
- `codex-session doctor`
- `codex-session config print`
- `codex-session provider test`
