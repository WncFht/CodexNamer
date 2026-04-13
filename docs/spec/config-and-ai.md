# 配置与 AI 后端

更新时间：`2026-04-13`

## 1. 当前配置加载顺序

当前真实实现来自 `packages/core/src/config/files.ts` 与 `packages/core/src/config/document.ts`。

配置不是“几份文件并排拼起来”这么简单，而是按下面顺序形成最终运行态：

1. **内置默认值**
2. **用户级配置**：`~/.config/codexnamer/config.toml`
3. **项目级覆盖**：`<cwd>/.codexnamer.toml`
4. **CLI / runtime overrides**
5. **继承的 Codex provider/auth**：根据最终 `general.codex_home` 再去读取 `~/.codex/config.toml` 与 `auth.json`

说明：

- 第 5 步不是把 Codex 配置整块 merge 到用户配置里，而是把它解析成 `inheritedCodex` 运行时视图，供 provider 解析和诊断使用。
- Web / TUI 保存设置时，当前只会写回**用户级配置文件**，不会改项目级覆盖文件。

## 2. 路径与 `ConfigView`

当前配置相关路径：

- 用户配置：`~/.config/codexnamer/config.toml`
- 项目级覆盖：`<cwd>/.codexnamer.toml`
- 默认状态目录：`~/.local/state/codexnamer`

`GET /api/v1/config` 返回的 `ConfigView` 会包含：

- `paths.cwd`
- `paths.userConfigPath`
- `paths.projectConfigPath`
- `userConfig`（已做 secret redact）
- `projectOverride`（已做 secret redact）
- `effectiveConfig`

其中 `effectiveConfig.inheritedCodex.auth` 会显示：

- `authMode`
- `hasOpenaiApiKey`
- `hasAccessToken`

真正的 key/token 会被隐藏成 `[redacted]`。

## 3. 当前有效配置模型

### `[general]`

- `codex_home`
- `state_dir`
- `ui_language = "en-US" | "zh-CN"`

### `[rename]`

- `auto_apply = "disabled" | "idle-finalize"`

说明：

- 当前真正控制自动落盘的是 `auto_apply`
- 当前调度保护态只有会话级 `freeze`

### `[watch]`

- `scan_interval_seconds`
- `candidate_idle_seconds`
- `finalize_idle_seconds`
- `rename_cooldown_seconds`
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

当前 TOML 文件里的手动 provider profile 仍使用：

- `[provider.default]`
- `[provider.<profile_id>]`

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

说明：

- Web / TUI / `ConfigView` 在内存里会把它表示成 `providerProfiles[]`
- 但落到 TOML 时，当前 serializer 仍写成 `[provider.<id>]` 表结构

### `[maintenance]`

- `suggest_compact_index_above_mb`
- `suggest_compact_index_above_lines`
- `backup_before_compact`

## 4. 当前内置默认值

当前真实默认值来自 `packages/core/src/config/defaults.ts`：

```toml
[general]
codex_home = "~/.codex"
state_dir = "~/.local/state/codexnamer"
ui_language = "zh-CN"

[rename]
auto_apply = "idle-finalize"

[watch]
scan_interval_seconds = 300
candidate_idle_seconds = 120
finalize_idle_seconds = 600
rename_cooldown_seconds = 900
max_auto_renames_per_session = 2

[naming]
preset = "conventional"
template = "{{time:%m%d-%H%M}} {{kind}}{{scope_paren}}: {{summary}}"
max_length = 500
language = "zh-CN"
context_strategy = "paired-user-turns"
context_max_chars = 1000000
composition_mode = "structured"
builder = [
  { type = "component", component = "timestamp", format = "%Y-%m-%d" },
  { type = "separator", value = " · " },
  { type = "component", component = "project" },
  { type = "separator", value = " · " },
  { type = "component", component = "kind" },
  { type = "separator", value = " · " },
  { type = "component", component = "scope" },
  { type = "separator", value = " · " },
  { type = "component", component = "summary" }
]
custom_prompt = "Always prefix a workspace-heavy Chinese tag."

[ai]
backend = "responses"
provider_source = "codex-config"
profile = "default"
timeout_seconds = 45
temperature = 0.2
max_concurrency = 1

[maintenance]
suggest_compact_index_above_mb = 5
suggest_compact_index_above_lines = 20000
backup_before_compact = true
```

## 5. `config.example.toml` 与默认值的关系

仓库根目录的 `config.example.toml` 现在基本对齐当前内置默认值：

- 默认 UI 语言就是 `zh-CN`
- 默认 `rename.auto_apply` 就是 `idle-finalize`
- 默认 builder / context / custom prompt 也与运行态一致

它仍然保留了更多注释，方便首次编辑，但不再故意走一套“更保守的样例默认”。

## 6. builder-first 命名

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
- 空值组件会自动跳过
- 分隔符不会单独出现在标题开头或结尾

## 7. `composition_mode`

### `structured`

- 默认模式
- AI 返回结构化字段
- 后端再按 `builder` 拼装最终标题

### `prompt-override`

- 仍保留 builder / tag 语义
- 但把 `custom_prompt` 作为最高优先级 AI 指令

## 8. 当前 AI backend 语义

### `backend = "none"`

- 不调用 AI
- 走 heuristic + builder 组合

### `backend = "responses"`

- 走 OpenAI Responses 风格请求
- `provider_source = "codex-config"` 时使用当前 Codex 的 provider / auth 解析结果
- `provider_source = "manual"` 时读取 `providerProfiles` / `[provider.<id>]`

### `backend = "openai-compatible"`

- 走 OpenAI-compatible 请求
- provider 解析来源与上面相同

## 9. Settings 页当前分区

Web Settings 当前分为五个 section：

- `Overview`
- `Naming`
- `AI Provider`
- `Scheduler`
- `Runtime`

它们分别覆盖：

- 当前运行摘要与标题质量概览
- builder / tags / prompt preview / context strategy / prompt override
- provider source / manual profile / provider parse / provider test
- auto-apply 策略与 watch 阈值
- 配置路径、解析结果与 resolved provider 视图

## 10. 当前已删除的旧语义

下面这些不再是当前配置行为：

- `backend = "codex"`
- `provider_source = "inherit-codex"`
- `codex exec` fallback
- `naming.default_style`
- `brief / detailed` 风格切换
- `manual override`

## 11. 当前仍需要注意的边界

- `provider_source = "manual"` 时，最终是否可用仍取决于 provider test 结果
- `rename.auto_apply = "idle-finalize"` 只是允许自动落盘；真正是否在执行，还要结合 daemon runtime 看
- 项目级 `.codexnamer.toml` 会覆盖用户配置，但当前 UI 保存不会写它
