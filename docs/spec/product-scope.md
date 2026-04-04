# 产品范围

## 一句话定义

这是一个独立的本地 session 管理器，用来为 Codex 会话生成、应用、维护和批量管理
用户可见的 session name。

## 目标

- 不改 Codex 源码也能工作。
- 不改变用户启动 Codex 的方式。
- 让 session name 管理从“手工零散操作”变成“可批量、可自动、可回溯”。
- 允许用户用模板或 AI 生成命名。
- 允许用户查看哪些 session 在“上次 rename 之后又发生了变化”。
- 提供 WebUI 与 TUI 管理入口。

## 核心使用场景

### 1. 单个 session 管理

用户想查看某个 session 当前的 name、候选 name、上次 rename 时间，并手动应用一个新名字。

### 2. 批量管理

用户想选中若干 sessions，统一预览 rename 结果，再批量 apply。

### 3. rename 所有 dirty sessions

用户希望系统自动找出“自上次 rename 以后发生过实质变化”的 session，然后统一生成并应用新名字。

### 4. 自动 rename

用户希望系统在 session 空闲一段时间后自动 finalize 一次名字，但又不希望过于频繁。

### 5. 规则管理

用户想配置命名模板、长度限制、是否带时间戳、是否采用类 conventional commit 风格。

### 6. AI 后端管理

用户希望：

- 直接填写 OpenAI-compatible 的 `base_url + api_key + model`
- 或默认继承 `~/.codex/config.toml` 中的 provider/model 配置
- 或直接调用本机 `codex` 做 AI 命名

### 7. 维护与清理

用户希望监控 `session_index.jsonl` 的增长情况，并在合适的时候做离线 compact。

## 非目标

- 不负责替代 Codex 的聊天界面。
- 不在 v1 里做云同步。
- 不负责管理 thread 内容本身，只管理命名相关的元数据与状态。
- 不在 v1 里做插件化规则 marketplace。
- 不在 v1 里保证每个活跃会话都能实时推送变更到运行中的 Codex UI。

## 用户价值

- 解决大量历史 session 无法区分的问题。
- 避免重复手工重命名。
- 支持“工作完成后一键整理所有 session”。
- 把 session name 从一次性的字符串变成可维护对象。

## 成功标准

### 功能层

- 单个 session rename 成功率高，不依赖活跃 app-server。
- 批量 rename dirty sessions 可以稳定运行。
- 自动 rename 在真实使用中既不会“狂写 index”，也不会长期没有结果。
- 能直接兼容本机已有的 Codex sessions。

### 体验层

- 用户能直观看到 dirty / frozen / manual override 状态。
- 用户能预览 rename 结果，再决定是否应用。
- AI 配置失败时有明确回退与错误提示。

### 维护层

- `session_index.jsonl` 不会因为自动 rename 被快速刷大。
- compact 不会破坏 latest-wins 语义。
