# 参考项目对照

本项目设计主要参考以下四个来源：

- `TokenArena`
- `cli-history-hub`
- `codexmate`
- `openai/codex`

## 1. TokenArena

参考点：

- parser / extractor 的分层思路
- 把 rollout 中的 session 事实抽成统一 metadata
- 适合作为“读取层”和“抽取层”的借鉴

不直接沿用的部分：

- TokenArena 的目标是分析和统计，不是 rename 管理
- 没有围绕 title/name 的持久化层设计

本项目借鉴结论：

- extractor 需要独立成明确模块
- 不要让 UI 直接碰 rollout 解析细节

## 2. cli-history-hub

参考点：

- sidecar 元数据思路
- 对 Codex session 的展示整合
- 明确意识到 `session_index.jsonl` / `thread_name` 的存在

不直接沿用的部分：

- 以浏览和管理历史为主
- 没有完整自动 rename 状态机
- 没有命名规则、AI 后端、dirty tracking

本项目借鉴结论：

- “原始会话不动 + 额外元数据层”是对的
- 但最终用户可见 name 仍应写回官方 `session_index.jsonl`

## 3. codexmate

参考点：

- session 浏览器 / UI 组织方式
- 列表与详情分离的体验方向

不直接沿用的部分：

- 当前 title 更接近 first prompt 派生值
- 持久化会话元数据层偏弱
- 不适合作为 rename 系统底座

本项目借鉴结论：

- UI 可以学，但状态存储不能学

## 4. openai/codex

这是最关键的参考源。

确认点：

- 官方 rename API 存在
- 但 rename 的最终持久化层是 `session_index.jsonl`
- `thread/name/set` 对未加载 thread 的处理就是 append `session_index.jsonl`
- `Thread.name` 与内部 `title` 不是一个层级

本项目借鉴结论：

- 外置项目的正确写回层就是 `session_index.jsonl`
- 不应写 SQLite `threads.title`
- 不应伪造另一套“官方 name”

## 借鉴总结

### 最终保留

- 从 TokenArena 学 extractor 分层
- 从 cli-history-hub 学原始数据与派生元数据分层
- 从 codexmate 学 session 管理界面思路
- 从 openai/codex 学 rename 的真实持久化契约

### 最终放弃

- 不把 rename 仅做成 sidecar
- 不把 first prompt/title 当成最终官方 name
- 不把 SQLite 当写回层
- 不把 wrapper 当必需前提
