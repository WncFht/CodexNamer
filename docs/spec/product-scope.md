# 产品范围

更新时间：`2026-04-09`

## 一句话定义

这是一个独立的本地 session 管理器，用来为 Codex 会话生成、应用、维护和批量管理用户可见的会话名。

## 目标

- 不改 Codex 源码也能工作。
- 不改变用户启动 Codex 的方式。
- 让 session rename 从零散手工操作变成可批量、可自动、可回溯的流程。
- 用同一套 core / API 同时支撑 CLI、Web、TUI 和 daemon。
- 提供 builder-first 的命名规则配置，以及本地 AI provider 配置。

## 核心使用场景

### 1. 单个会话管理

用户想查看某个 session 当前的 official name、candidate、rename history、transcript，并在需要时：

- `suggest`
- `apply`
- `freeze / unfreeze`
- 手动 `rename`

### 2. 批量管理 dirty sessions

用户想预览所有 dirty 会话的候选名，再批量 apply。

### 3. 自动 rename

用户希望系统在 session 空闲一段时间后自动进入 `suggest` 或 `apply`，并在 daemon 运行且 `rename.auto_apply = "idle-finalize"` 时真正落盘。

### 4. 规则管理

用户想配置：

- naming builder
- tag 目录
- prompt override
- context strategy / `context_max_chars`
- auto-apply 与扫描阈值

### 5. AI 后端管理

用户希望：

- 直接用 `responses` 或 `openai-compatible`
- 选择从 `codex-config` 继承 provider/model/auth，或走 `manual` 配置
- 在 Settings / provider test 中看到实际解析出的 provider 信息

### 6. 运行态与排障

用户希望直接看到：

- daemon 是否在运行
- auto-apply 是否真的在生效
- 最近请求日志是否失败或变慢
- overview 图表统计是否健康

## 非目标

- 不替代 Codex 的聊天界面。
- 不做云同步或多用户共享状态。
- 不直接管理 thread 内容本身，只管理命名相关的元数据与状态。
- 不再维护独立的 `manual override` 保护态。
- 不再把 `brief / detailed` 当作当前可配置的命名模式。

## 成功标准

### 功能层

- 单个 session rename 成功率高，不依赖活跃 app-server。
- 批量 dirty apply 可以稳定运行。
- 自动 rename 不会频繁刷写 `session_index.jsonl`。
- Web / TUI / CLI 对同一会话的核心状态读取一致。

### 体验层

- 用户能直观看到 dirty / frozen / status estimate。
- 用户能预览 rename 结果，再决定是否应用。
- 状态页请求日志能翻完全部历史，而不是只看固定 40 条。

### 维护层

- `session_index.jsonl` 的 compact 不破坏 latest-wins 语义。
- overview 中“近期重命名活动”和“应用来源分布”按会话去重，不会把同一会话多次命名重复计数。
