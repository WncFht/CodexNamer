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
- 默认命名风格版本与单会话风格切换
- AI rename backend:
  - `none`
  - `openai-compatible`
  - `codex`

其中 `backend = "codex"` 的当前语义是：

- 优先继承 `~/.codex/config.toml` 的 provider/model
- 优先继承 `~/.codex/auth.json` 的认证
- 优先直接走 Responses / Chat Completions
- 只有直连不可用时才回退 `codex exec`

当前自动重命名的运行态需要明确区分“评估结果”和“实际落盘”：

- `evaluateAutoRename()` 统一给出 `skip / suggest / apply`
- `candidate_ready` 会在 UI 里显示为 `suggest`
- `finalize_ready` 会在 UI 里显示为 `apply`
- daemon 现在会根据 `rename.auto_apply` 决定是否真正写回：
  - `idle-finalize`：对 `finalize_ready` 自动落盘
  - `disabled`：仍然只做 preview
- 因此前端里看到的 `apply` 表示“允许应用”；是否已自动应用，要看运行态里的：
  - `actualExecution`
  - `daemonStatus`
  - `lastSweepAt / lastSweepSummary`

当前“正式命名”还有一条新的约定：

- 只把 `AI` 和 `手动命名` 视为正式名字
- 旧的 heuristic 命名会被当作“待 AI 重写”的过渡态
- 因此它们不会计入 `named`，后续也会重新进入 rename 队列

当前还有一条重名约定：

- 新的候选名或手动名在落盘前会先做重名检查
- 如果和别的 session 正式名重复，会自动追加 ` (2) / (3) ...` 后缀
- 已经历史上形成的重复正式名，也会把后出现的那几个重新打回待处理队列

当前命名还有一条新的风格版本约定：

- 全局默认风格由 `naming.default_style` 控制
- 当前支持：
  - `detailed`
  - `brief`
- 单会话可以单独切换“跟随默认 / 详细 / 简略”
- `rename_history` 现在会记录每次 rename 对应的风格版本

当前命名还有一条新的“组件组合”约定：

- 默认模式是 `structured`
- 标题由 `tag / kind / scope / summary / project` 这些组件按顺序拼装
- tag 目录可以在 Settings 里编辑
- 高级用户也可以切到 `prompt-override`，给 AI 一段自定义命名覆写 prompt
- `template` 现在只保留为兼容层参考字段，不再是主要推荐入口

Local API、WebUI 与 TUI 都已经有第一版可运行实现：

- Local API：会话列表、详情、history、suggest/apply/rename、freeze/manual override、batch apply、provider diagnostics、doctor、compact、config writeback、events polling
- WebUI：本地 session dashboard，支持 workspace 浏览、transcript、suggest/apply/freeze/manual override、Settings 表单配置、context 策略与字符预算配置、运行态面板；旧的 `rename.mode` 已不再在设置页暴露
- 运行态面板现在还会显示 AI 请求日志，包含活跃请求、最近请求状态、传输方式、耗时与错误
- Settings / 运行态现在都会展示“平均标题字数”
- TUI：终端版 browser/settings 双界面，支持搜索、detail 全屏、settings 编辑、单个 suggest/apply/manual rename、freeze/manual override、batch preview/apply

## 文档导航

- [系统设计](./docs/spec/system-design.md)
- [产品范围](./docs/spec/product-scope.md)
- [数据模型](./docs/spec/data-model.md)
- [触发与生命周期](./docs/spec/trigger-and-lifecycle.md)
- [Auto Rename 评估与 Context 构建](./docs/spec/rename-evaluation-and-context.md)
- [CLI / API / UI 设计](./docs/spec/cli-api-ui.md)
- [WebUI / TUI / Local API 详细设计](./docs/spec/web-tui-local-api-design.md)
- [Claude 设计系统接入说明](./docs/design/claude/ADOPTION.md)
- [Claude 设计系统原始文档](./docs/design/claude/DESIGN.md)
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
default_style = "detailed"
context_strategy = "summary-signals"
context_max_chars = 8000
composition_mode = "structured"
components = ["tag", "kind", "summary"]
component_separator = " · "

[[naming.tags]]
id = "settings"
description = "配置、设置、保存、语言、provider 相关会话。"
prompt_hint = "setting settings config save language provider"
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

现在 `npm run web` 会自动：

- 查找并关闭当前 repo 之前残留的旧 Web / API / launcher 实例
- 复用一个健康的本地 API
- 或者在 `42110+` 范围内找可用端口启动 API
- 然后把 Vite 代理指向对应 API

默认 Vite 地址：

- `http://127.0.0.1:43110`

WebUI 当前包含 3 个主视图：

- `Sessions`：workspace 分组、session 列表、transcript、rename history、rename 操作
- `Settings`：默认命名风格、context 策略与 `context_max_chars`、结构化命名组件、tag 目录、prompt override、watch 阈值、AI backend/profile/default provider 配置、界面语言切换、AI prompt preview，并直接写回 `~/.config/codex-session-manager/config.toml`
- `Rename Ops / 运行态`：自动重命名运行态、近期应用活动、命名来源分布、工作区 token 压力、平均标题字数、预览队列与原始 doctor 信息

运行态页现在会明确展示：

- 当前是否检测到 daemon 心跳
- 最近一轮 daemon sweep 时间
- 最近一轮 sweep 的 `suggest / apply / skip / autoApplied`
- 当前自动应用是否真的在生效，而不只是配置里打开了 `idle-finalize`

`Rename Ops / 运行态` 页当前默认只拉取状态级 preview：

- 默认只展示 `skip / suggest / apply` 状态与原因
- 候选名改成按需载入，避免页面一打开就触发全量 AI 命名
- 图表使用与 `ccLoad` 趋势页同一实现家族的 ECharts canvas 方案，按主题色自动取值，并用 `ResizeObserver` 适配容器尺寸

Web/TUI 现在都支持两种界面语言：

- `en-US`
- `zh-CN`

对应配置项为：

```toml
[general]
ui_language = "zh-CN"
```

当前 WebUI 的视觉系统已开始按上游 `awesome-design-md/claude` 重构，参考文件位于：

- `docs/design/claude/`
- `docs/design/claude/ADOPTION.md`

### 3. 启动 TUI

```bash
npm run tui
```

如果你要显式指定一个已有 API，也可以：

```bash
npm run tui -- --api-base http://127.0.0.1:42110
```

常用快捷键：

- `j/k`：移动
- `tab`：在 session 列表与 transcript 之间切换焦点
- `/`：搜索
- `,`：打开 / 关闭 settings 界面
- `z`：当前焦点 pane 全屏 / 还原
- `v`：detail / transcript 直接全屏
- `o`：加载更早的 transcript
- `h`：显示 / 隐藏 hidden transcript
- `1-5`：切换 transcript role 过滤
- `s`：suggest
- `a`：apply
- `r`：manual rename
- `f`：freeze / unfreeze
- `m`：manual override / clear
- `p`：预览 dirty auto-rename
- `A`：批量 apply dirty
- `q`：退出

命名 context 目前支持两种策略：

- `summary-signals`：只使用 `firstUserMessage / lastUserMessage / lastAgentMessage`
- `user-assistant-transcript`：读取完整 transcript，但只保留 `user` 和 `assistant` 的 message 内容，自动去掉 tool call/output 和隐藏 bootstrap，再按 `context_max_chars` 截断后提供给 heuristic / AI

如果你想让 rename 更贴近整段会话，而不是只看首尾摘要，可以在 Web/TUI 的 `Settings` 里把 `Context strategy` 切到 `user-assistant-transcript`。

Settings 界面里：

- `j/k`：选择字段
- `e`：编辑当前字段
- `space`：对枚举字段循环切换
- `s`：保存到用户配置
- `p`：刷新当前 AI prompt preview
- `R`：从磁盘重新加载

自动命名预览现在显式区分三种状态：

- `skip`
- `suggest`：表示 `candidate_ready`
- `apply`：表示 `finalize_ready`

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

获取当前 AI prompt preview：

```bash
curl 'http://127.0.0.1:42110/api/v1/ai/prompt-preview?threadId=<thread-id>'
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

默认推荐直接用一条命令启动：

```bash
npm run web
# 或
npm run tui
```

如果你想单独调 API，再手动连接 WebUI 或 TUI，也可以这样：

```bash
npm run api -- --host 127.0.0.1 --port 42110
npm run web
# 或
npm run tui -- --api-base http://127.0.0.1:42110
```

说明：

- `npm run api` / `npm run cli` / `npm run daemon` 会先自动补齐 runtime 相关包的编译产物
- `npm run clean` 会同时清掉 `dist` 和 `tsbuildinfo`，避免增量构建把 runtime 包留在不完整状态
- `npm run web` / `npm run tui` 现在会优先复用健康 API；如果默认端口被其他非 CSM 进程占用，会自动换到下一个可用端口
- `npm run web:raw` 只启动 Vite，不会自动起 API
- `npm run tui:raw` 只启动 TUI，不会自动起 API
- `npm run tui` 在真实 TTY 下支持快捷键；非交互环境下会退化成只读渲染
- Web Settings 表单保存会走 `PUT /api/v1/config`；当前运行中的 API 不支持热切换 `general.stateDir`
- `PUT /api/v1/config` 只写 `codex-session-manager` 自己的用户配置，不会回写 Codex 自身配置
- 当前不支持在运行中的 API 进程里热切换 `general.stateDir`；这个字段如果要改，建议停服务后修改配置再重启
