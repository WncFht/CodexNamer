# Codex Session Manager

Codex Session Manager 是一个独立于 `openai/codex` 的本地工具，用来管理 Codex 会话命名、自动重命名、批量 apply、运行态排障，以及 `session_index.jsonl` 的维护与压缩。

它不修改 Codex 源码，也不接管 Codex 启动方式。当前实现通过读取 `~/.codex/sessions/**/rollout-*.jsonl` 理解会话内容，并通过向 `~/.codex/session_index.jsonl` 追加记录写回最终名称。

## 当前状态

当前仓库已经具备完整的本地闭环：

- 扫描 rollout 并维护本地 SQLite 状态库
- 计算 revision、dirty、status estimate
- 单个 `suggest / apply / rename / freeze`
- dirty 批量 apply
- daemon auto-rename 与 auto-apply
- builder-first 命名配置与 prompt preview
- Local API、Web、TUI、CLI 四套入口
- AI 请求日志、overview 图表、daemon 控制页
- `session_index.jsonl` compact

当前运行逻辑有几条重要约定：

- `evaluateAutoRename()` 统一输出 `skip / suggest / apply`
- `apply` 只表示“允许正式应用”，不等于已经落盘
- 真正是否自动落盘，要同时看：
  - `rename.auto_apply`
  - daemon 是否运行
  - runtime `actualExecution`
- 当前调度保护态只保留 `freeze`
- `brief / detailed` 不再是当前配置与 UI 的主语义
- overview 中“近期重命名活动”和“应用来源分布”已按会话去重

## AI backend 现状

当前后端是：

- `none`
- `responses`
- `openai-compatible`

当前 provider 来源是：

- `codex-config`
- `manual`

这意味着：

- `responses + codex-config` 会直接读取当前 Codex 配置与鉴权
- `manual` 会读取当前用户配置里的 `[provider.<profile>]`
- 不再维护 `backend = "codex"` 或 `codex exec` fallback

## 命名结构现状

当前最终标题结构由 `naming.builder` 决定。

builder 支持的 component：

- `timestamp`
- `workspace`
- `project`
- `tag`
- `kind`
- `scope`
- `summary`

AI 或 heuristic 先产出结构化信息，后端再按 builder 组装最终标题。`components / component_separator` 只作为兼容层存在。

## 文档导航

- [文档总览](./docs/README.md)
- [仓库总览](./docs/spec/repo-overview.md)
- [系统设计](./docs/spec/system-design.md)
- [配置与 AI 后端](./docs/spec/config-and-ai.md)
- [Auto Rename 评估与 Context 构建](./docs/spec/rename-evaluation-and-context.md)
- [状态页说明](./docs/spec/status-page-guide.md)
- [CLI / API / UI 设计](./docs/spec/cli-api-ui.md)
- [WebUI / TUI / Local API 详细设计](./docs/spec/web-tui-local-api-design.md)

## 安装

前置要求：

- Node.js `20+`
- npm `10+`
- 本机已有可读取的 Codex 目录，默认是 `~/.codex`

安装：

```bash
git clone <your-repo-url> codex-session-manager
cd codex-session-manager
npm install
npm run build
```

## 最小配置示例

默认用户配置路径：

- `~/.config/codex-session-manager/config.toml`

```toml
[general]
codex_home = "~/.codex"
state_dir = "~/.local/state/codex-session-manager"
ui_language = "zh-CN"

[rename]
auto_apply = "disabled"
freeze_manual_name = true

[watch]
scan_interval_seconds = 300
candidate_idle_seconds = 120
finalize_idle_seconds = 600
rename_cooldown_seconds = 900
min_rollout_growth_bytes = 4096
min_task_complete_delta = 1
max_auto_renames_per_session = 2

[naming]
max_length = 72
language = "zh-CN"
context_strategy = "summary-signals"
context_max_chars = 8000
composition_mode = "structured"
builder = [
  { type = "component", component = "tag" },
  { type = "separator", value = " · " },
  { type = "component", component = "kind" },
  { type = "separator", value = " · " },
  { type = "component", component = "summary" }
]

[ai]
backend = "responses"
provider_source = "codex-config"
profile = "default"
timeout_seconds = 45
temperature = 0.2
max_concurrency = 1
```

如果你想显式指定 provider：

```toml
[ai]
backend = "openai-compatible"
provider_source = "manual"
profile = "default"

[provider.default]
request_type = "openai-compatible"
display_name = "Default"
base_url = "http://127.0.0.1:23141/v1"
model = "gpt-5.4"
api_key = "your-api-key"
enabled = true
is_default = true
```

## 启动方式

### Local API

```bash
npm run api -- --host 127.0.0.1 --port 42110
```

健康检查：

```bash
curl http://127.0.0.1:42110/api/v1/health
```

### Web

```bash
npm run web
```

当前 Web 有四个主视图：

- `Sessions`
- `Settings`
- `状态 / Rename Ops`
- `Daemon`

当前 Web 支持：

- workspace 浏览
- session 详情 / transcript / rename history
- 会话级 `Suggest / Apply / Freeze`
- settings 写回
- overview 图表
- AI 请求日志
- daemon start / stop / log tail

请求日志当前行为：

- 后端分页
- 状态页每页 10 条
- 支持搜索、项目、状态、传输过滤
- 支持直接跳页

### TUI

```bash
npm run tui
```

也可以显式指定已有 API：

```bash
npm run tui -- --api-base http://127.0.0.1:42110
```

常用快捷键：

- `j/k` 移动
- `/` 搜索
- `s` suggest
- `a` apply
- `r` manual rename
- `f` freeze / unfreeze
- `p` 预览 dirty auto-rename
- `A` 批量 apply dirty
- `q` 退出

## CLI

当前命令：

- `codex-session list`
- `codex-session show --id <thread-id>`
- `codex-session suggest --id <thread-id>`
- `codex-session apply --id <thread-id>`
- `codex-session rename --id <thread-id> --name "..."`
- `codex-session history --id <thread-id>`
- `codex-session freeze --id <thread-id>`
- `codex-session unfreeze --id <thread-id>`
- `codex-session batch apply --dirty`
- `codex-session compact-index --dry-run`
- `codex-session doctor`
- `codex-session config print`
- `codex-session provider test`

示例：

```bash
npm run cli -- list --dirty
npm run cli -- show --id <thread-id>
npm run cli -- suggest --id <thread-id>
npm run cli -- apply --id <thread-id>
npm run cli -- rename --id <thread-id> --name "feat(api): add config writeback"
npm run cli -- batch apply --dirty --preview
npm run cli -- batch apply --dirty
```

## Local API 示例

```bash
curl 'http://127.0.0.1:42110/api/v1/sessions?dirty=true&search=api'
curl -X POST http://127.0.0.1:42110/api/v1/sessions/<thread-id>/suggest
curl -X POST http://127.0.0.1:42110/api/v1/sessions/<thread-id>/apply
curl -X POST http://127.0.0.1:42110/api/v1/sessions/<thread-id>/rename \
  -H 'content-type: application/json' \
  -d '{"name":"feat(api): add config writeback"}'
curl 'http://127.0.0.1:42110/api/v1/ai/request-logs?page=1&pageSize=10&project=codex-session-manager'
curl 'http://127.0.0.1:42110/api/v1/events/since?cursor=0'
```

## 当前不再使用的旧语义

下面这些现在只应当被视为历史兼容信息，而不是当前行为：

- `manual override`
- `naming.default_style`
- `brief / detailed`
- `backend = "codex"`
- `provider_source = "inherit-codex"`
- `codex exec` fallback
