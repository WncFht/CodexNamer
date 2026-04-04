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

Local API、WebUI 与 TUI 都已经有第一版可运行实现：

- Local API：会话列表、详情、history、suggest/apply/rename、freeze/manual override、batch apply、provider diagnostics、doctor、compact、config writeback、events polling
- WebUI：本地 session dashboard，支持会话浏览、详情查看、suggest/apply/freeze/manual override、provider 与 maintenance 视图
- TUI：终端列表 + 详情布局，支持搜索、单个 suggest/apply/manual rename、freeze/manual override、batch preview/apply

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

当前还可通过本地 API 启动命令运行服务：

- `npm run api -- --host 127.0.0.1 --port 42110`

当前前端入口：

- `npm run web`
- `npm run tui`

## 安装

### 前置要求

- Node.js `20+`
- npm `10+`
- 本机已有可读取的 Codex 目录，默认是 `~/.codex`
- 如果要用 `backend = "codex"` 或继承 Codex provider，确保 `~/.codex/config.toml` 与 `~/.codex/auth.json` 可用

### 克隆与依赖安装

```bash
git clone <your-repo-url> codex-session-manager
cd codex-session-manager
npm install
npm run build
```

### 可选：初始化用户配置

默认配置文件路径：

- `~/.config/codex-session-manager/config.toml`

如果你什么都不写，项目会直接继承：

- `~/.codex/config.toml`
- `~/.codex/auth.json`

最小示例：

```toml
[general]
codex_home = "~/.codex"
state_dir = "~/.local/state/codex-session-manager"

[ai]
backend = "codex"
provider_source = "inherit-codex"
profile = "default"

[naming]
template = "{{time:%m%d-%H%M}} {{kind}}{{scope_paren}}: {{summary}}"
max_length = 72
language = "zh-CN"
```

如果你想显式指定 URL + API key：

```toml
[ai]
backend = "openai-compatible"
provider_source = "explicit"
profile = "default"

[provider.default]
backend_kind = "openai-compatible"
display_name = "default"
provider_source = "explicit"
base_url = "http://127.0.0.1:23141/v1"
model = "gpt-5.4"
api_key = "your-api-key"
wire_api = "responses"
enabled = true
is_default = true
```

## 使用

### 1. 启动 Local API

```bash
npm run api -- --host 127.0.0.1 --port 42110
```

健康检查：

```bash
curl http://127.0.0.1:42110/api/v1/health
```

### 2. 启动 WebUI

```bash
npm run web
```

默认 Vite 地址：

- `http://127.0.0.1:43110`

### 3. 启动 TUI

```bash
npm run tui -- --api-base http://127.0.0.1:42110
```

常用快捷键：

- `j/k`：移动
- `/`：搜索
- `s`：suggest
- `a`：apply
- `r`：manual rename
- `f`：freeze / unfreeze
- `m`：manual override / clear
- `p`：预览 dirty auto-rename
- `A`：批量 apply dirty
- `q`：退出

### 4. 使用 CLI

列出 dirty sessions：

```bash
npm run cli -- list --dirty
```

查看详情：

```bash
npm run cli -- show --id <thread-id>
```

生成候选标题：

```bash
npm run cli -- suggest --id <thread-id>
```

应用候选标题：

```bash
npm run cli -- apply --id <thread-id>
```

手动 rename：

```bash
npm run cli -- rename --id <thread-id> --name "feat(api): add events polling"
```

批量处理 dirty sessions：

```bash
npm run cli -- batch apply --dirty --preview
npm run cli -- batch apply --dirty
```

### 5. 使用 Local API

会话列表：

```bash
curl 'http://127.0.0.1:42110/api/v1/sessions?dirty=true&search=api'
```

单个 suggest：

```bash
curl -X POST http://127.0.0.1:42110/api/v1/sessions/<thread-id>/suggest
```

单个 apply：

```bash
curl -X POST http://127.0.0.1:42110/api/v1/sessions/<thread-id>/apply
```

手动 rename：

```bash
curl -X POST http://127.0.0.1:42110/api/v1/sessions/<thread-id>/rename \
  -H 'content-type: application/json' \
  -d '{"name":"feat(api): add config writeback"}'
```

获取配置视图：

```bash
curl http://127.0.0.1:42110/api/v1/config
```

写回用户配置：

```bash
curl -X PUT http://127.0.0.1:42110/api/v1/config \
  -H 'content-type: application/json' \
  -d '{
    "naming": {
      "template": "{{summary}}",
      "maxLength": 48
    },
    "watch": {
      "candidateIdleSeconds": 90
    }
  }'
```

轮询事件流：

```bash
curl 'http://127.0.0.1:42110/api/v1/events/since?cursor=0'
```

事件流是轻量 polling 接口，适合 WebUI/TUI 在本地环境做增量刷新。当前不会直接上 WebSocket。

## 本地运行说明

推荐先启动本地 API，再启动 WebUI 或 TUI：

```bash
npm run api -- --host 127.0.0.1 --port 42110
npm run web
# 或
npm run tui -- --api-base http://127.0.0.1:42110
```

说明：

- `npm run api` / `npm run cli` / `npm run daemon` 会先自动补齐 runtime 相关包的编译产物
- `npm run clean` 会同时清掉 `dist` 和 `tsbuildinfo`，避免增量构建把 runtime 包留在不完整状态
- `npm run web` 默认通过 Vite 代理到 `http://127.0.0.1:42110`
- `npm run tui` 在真实 TTY 下支持快捷键；非交互环境下会退化成只读渲染
- `PUT /api/v1/config` 只写 `codex-session-manager` 自己的用户配置，不会回写 Codex 自身配置
- 当前不支持在运行中的 API 进程里热切换 `general.stateDir`；这个字段如果要改，建议停服务后修改配置再重启
