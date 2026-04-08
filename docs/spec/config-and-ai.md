# 配置与 AI 后端

更新时间：`2026-04-09`

## 配置来源优先级

1. CLI / runtime overrides
2. 项目级 `.codex-session-manager.toml`
3. 用户级 `~/.config/codex-session-manager/config.toml`
4. 继承的 `~/.codex/config.toml` / `auth.json`
5. 内置默认值

## 当前有效配置模型

### `[general]`

- `codex_home`
- `state_dir`
- `ui_language`

### `[rename]`

- `auto_apply = "disabled" | "idle-finalize"`
- `freeze_manual_name = true | false`

说明：

- 当前真正控制自动落盘的是 `auto_apply`
- `freeze_manual_name` 仍会被读取和写回，但当前调度保护态实际只有会话级 `freeze`

### `[watch]`

- `scan_interval_seconds`
- `candidate_idle_seconds`
- `finalize_idle_seconds`
- `rename_cooldown_seconds`
- `min_rollout_growth_bytes`
- `min_task_complete_delta`
- `max_auto_renames_per_session`

### `[naming]`

- `preset`
- `template`
- `max_length`
- `language`
- `context_strategy`
- `context_max_chars`
- `composition_mode = "structured" | "prompt-override"`
- `builder = [...]`
- `tags = [...]`
- `custom_prompt`

### `[ai]`

- `backend = "responses" | "openai-compatible" | "none"`
- `provider_source = "codex-config" | "manual"`
- `profile`
- `timeout_seconds`
- `temperature`
- `max_concurrency`

### `[provider.<profile_id>]`

每个 profile 支持：

- `request_type = "responses" | "openai-compatible"`
- `display_name`
- `provider_ref`
- `base_url`
- `model`
- `api_key`
- `api_key_ref`
- `headers`
- `enabled`
- `is_default`

### `[maintenance]`

- `suggest_compact_index_above_mb`
- `suggest_compact_index_above_lines`
- `backup_before_compact`

## 当前默认值

当前内置默认值大意如下：

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
preset = "conventional"
template = "{{time:%m%d-%H%M}} {{kind}}{{scope_paren}}: {{summary}}"
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

## builder-first 命名

当前最终标题结构由 `naming.builder` 决定。

支持的 component：

- `timestamp`
- `workspace`
- `project`
- `tag`
- `kind`
- `scope`
- `summary`

支持的 item 类型：

- `{ type = "component", component = ... }`
- `{ type = "separator", value = "..." }`

额外约定：

- `timestamp` 支持 `format`
- 空值组件不会直接输出
- 分隔符不会在标题开头单独出现

## `composition_mode`

### `structured`

- 默认模式
- AI 返回结构化字段
- 后端根据 `builder` 拼装最终标题

### `prompt-override`

- 仍保留 builder / tag 语义
- 但把 `custom_prompt` 作为最高优先级 AI 指令

## 当前 AI backend 语义

### `backend = "none"`

- 不调用 AI
- 走 heuristic + builder 组合

### `backend = "responses"`

- 走 OpenAI Responses 风格请求
- `provider_source = "codex-config"` 时直接读取当前 Codex provider / auth
- `provider_source = "manual"` 时读取 `[provider.<id>]`

### `backend = "openai-compatible"`

- 走 OpenAI-compatible 请求
- 解析来源同上

## 当前已删除的旧语义

下面这些不再是当前配置行为：

- `backend = "codex"`
- `provider_source = "inherit-codex"`
- `codex exec` fallback
- `naming.default_style`
- `brief / detailed` 风格切换

## 兼容层

当前仍会兼容读取这些 legacy 字段，但它们不再是推荐入口：

- `rename.mode`
- `naming.components`
- `naming.component_separator`
- history / state 中的 `style` 字段

## Settings 页现状

Web Settings 当前是 builder-first：

- Naming policy：builder、tags、prompt preview、context strategy
- Runtime / provider：provider source、profile、配置路径、diagnostics

当前不再在设置页暴露：

- `brief / detailed`
- `manual override`
- `backend = "codex"`
