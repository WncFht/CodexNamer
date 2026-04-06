# 配置与 AI 后端

## 设计目标

- AI 命名可以完全关闭
- 可以直接配置 OpenAI-compatible provider
- 可以默认继承 Codex 现有 provider/model
- 可以从 `~/.codex/auth.json` 继承认证
- 在直连不可用时，可以回退到通过 `codex` 间接完成 AI 命名

## 配置来源优先级

1. CLI flags
2. 项目级 `.codex-session-manager.toml`
3. 用户级 `~/.config/codex-session-manager/config.toml`
4. 继承 `~/.codex/config.toml`
5. 内置默认值

## 用户配置文件

建议路径：

- `~/.config/codex-session-manager/config.toml`

建议结构：

```toml
[general]
codex_home = "~/.codex"
state_dir = "~/.local/state/codex-session-manager"

[rename]
auto_apply = "idle-finalize"
manual_override_wins = true
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

[ai]
backend = "codex"
provider_source = "inherit-codex"
profile = "default"
timeout_seconds = 45
temperature = 0.2

[provider.default]
backend_kind = "openai-compatible"
base_url = ""
model = ""
api_key = ""
api_key_ref = ""
headers = {}

[maintenance]
suggest_compact_index_above_mb = 5
suggest_compact_index_above_lines = 20000
backup_before_compact = true
```

说明：

- `rename.mode` 目前仍作为兼容字段被解析，但设置页已经不再暴露它。
- 当前真正决定是否走 AI 的主开关是 `[ai].backend`。
- heuristic 仍然作为内部 fallback 存在，但不再作为推荐给用户切换的正式模式。

## 命名风格版本

从当前版本开始，`[naming]` 还新增一个正式配置项：

- `default_style = "detailed" | "brief"`
- `context_strategy = "summary-signals" | "user-assistant-transcript"`
- `context_max_chars = <number>`

语义：

- `detailed`
  - 默认风格
  - 倾向输出更具体的标题
  - 会尽量补一个短的 secondary focus
- `brief`
  - 保持更短、更扫读友好的标题

注意：

- 这不是旧的 `rename.mode`
- 它不决定“是否启用 AI”
- 它决定的是“在当前命名链路里，标题更偏详细版还是简略版”
- 单会话还可以单独覆盖这个默认值

## 结构化命名组合

从这一版开始，`[naming]` 还新增了一组“结构化命名组合”字段：

- `composition_mode = "structured" | "prompt-override"`
- `components = ["tag", "kind", "scope", "summary", "project"]` 的有序子集
- `component_separator = " · "`：组件之间如何拼接
- `[[naming.tags]]`：可编辑的分类 tag 目录
- `custom_prompt = "..."`：仅在 `prompt-override` 模式下作为 AI 覆写指令

语义：

- `structured`
  - 默认模式
  - AI prompt 和 heuristic 都会读取组件顺序与 tag 目录
  - 用户不需要自己写 prompt，只需要调组件和 tag
- `prompt-override`
  - 仍然保留结构化组件信息
  - 但会额外把 `custom_prompt` 作为最高优先级 AI 指令
  - 适合高级用户做强约束或个性化覆写

注意：

- `template` 现在退化为兼容层参考字段，不再是主要推荐入口
- 真正控制最终标题结构的主入口已经变成：
  - `components`
  - `component_separator`
  - `tags`
- 如果组件顺序里不包含 `tag`，即使某个 tag 被命中，也不会出现在最终标题里

## Tag 目录

`[[naming.tags]]` 每项当前支持：

- `id`
- `label`
- `description`
- `prompt_hint`

用法：

- `id`：内部稳定标识
- `label`：最终显示标签；如果缺省，会回退到内置的本地化 label 或直接使用 `id`
- `description`：给人和 prompt preview 看的短说明
- `prompt_hint`：给 AI 和 heuristic 做分类命中的关键词提示

当前 tag 的定位是“分类”，不是“二级模板”。
也就是说，tag 只负责告诉系统“这次会话大致属于哪一类”，
真正的标题正文仍由 `kind / scope / summary / project` 等组件决定。

## AI 后端

### `backend = "none"`

- 不使用 AI
- 全部由 heuristic + 结构化组件生成
- 默认必须可用

### `backend = "openai-compatible"`

- 直接请求兼容 OpenAI Responses / Chat Completions 的服务
- 用户配置 `base_url + api_key + model`
- 适合 relay、自建网关、第三方兼容服务

### `backend = "codex"`

- 先继承 `~/.codex/config.toml` 的 provider/model
- 再继承 `~/.codex/auth.json` 的认证
- 优先直接走 Responses / Chat Completions
- 只有直连不可用时才回退到本机 `codex exec`
- 适合作为“默认无痛” AI 路径

## provider_source

### `provider_source = "explicit"`

- 只用本项目自己的 provider profile

### `provider_source = "inherit-codex"`

- 读取 `~/.codex/config.toml`
- 读取 `~/.codex/auth.json`
- 继承：
  - 顶层 `model_provider`
  - 顶层 `model`
  - `[model_providers.<id>]`
  - `auth.json.OPENAI_API_KEY`
  - `auth.json.tokens.access_token`

这与你本机当前配置结构一致。

### `provider_source = "mixed"`

- 先读取本项目 profile
- 缺失字段再从 Codex 配置补

## 为什么要保留 `backend = "codex"`

原因：

- 默认用户往往已经在 Codex 里配好了可用模型
- 对 `apikey` 登录，直接读取 `auth.json` 就能直连，不需要再启动 `codex exec`
- 对依赖更复杂登录态的 provider，仍需要保留 `codex exec` 作为回退
- 所以 `backend = "codex"` 更准确的含义是：
  - “优先复用 Codex 的 provider / model / auth”
  - “优先直连 API”
  - “必要时才回退到 `codex exec`”

## provider profile 数据结构

WebUI / DB 中建议持久化：

- `profile_id`
- `backend_kind`
- `display_name`
- `provider_source`
- `provider_ref`
- `base_url`
- `model`
- `api_key`
- `headers_json`
- `enabled`
- `is_default`

敏感字段：

- `api_key`
- `bearer_token`

应存放于 keyring 或环境变量，不建议进明文 TOML。

## 密钥存储策略

优先级：

1. 系统 keyring
2. 环境变量
3. `~/.codex/auth.json`
4. 用户明确允许的明文配置

WebUI 要求：

- 只显示“已配置/未配置”
- 不显示密钥原文
- 支持测试连接

## 命名 AI 输入

建议给 AI 的结构化输入：

```json
{
  "threadId": "...",
  "cwd": "...",
  "projectName": "...",
  "firstUserMessage": "...",
  "latestUserMessage": "...",
  "latestAgentMessage": "...",
  "taskCompleteCount": 3,
  "currentOfficialName": "...",
  "language": "zh-CN",
  "stylePreset": "conventional",
  "maxLength": 72
}
```

## 命名 AI 输出

建议强制结构化输出：

```json
{
  "kind": "feat",
  "scope": "provider",
  "topic": "共享 provider 设计",
  "summary": "共享 provider 设计与接口梳理",
  "name": "0404-1200 feat(provider): 共享 provider 设计"
}
```

## heuristic 回退

AI 失败时：

1. 若有 `first_user_message`，从中截取主题
2. 若有 `latest_agent_message`，抽出结果摘要
3. 用模板渲染
4. 若仍失败，回退为：

```text
<project>: <first_user_message_excerpt>
```

## 配置验证

启动时需要检查：

- `codex_home` 是否存在
- `session_index.jsonl` 是否可读
- provider profile 是否至少有一种可用方式
- 若 `backend = "openai-compatible"`，则 `base_url` 和认证必须可用
- 若 `backend = "codex"`，则本机 `codex` 命令必须可调用

## WebUI 配置页

配置页必须支持：

- 切换 AI backend
- 导入 Codex 默认 provider
- 配置命名模板
- 设置自动 rename 参数
- 测试 AI provider
- 导出 / 导入配置
