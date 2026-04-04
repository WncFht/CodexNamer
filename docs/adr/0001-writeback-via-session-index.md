# ADR 0001: 使用 `session_index.jsonl` 作为 rename 写回层

## 状态

Accepted

## 背景

需要为独立外置项目确定“最终把 session name 写到哪里”。

候选方案：

1. 改 SQLite `threads.title`
2. 改 rollout JSONL
3. 写 sidecar
4. 追加 `~/.codex/session_index.jsonl`

## 决策

选择方案 4：把 `session_index.jsonl` 作为唯一官方写回层。

## 依据

- 官方 `thread/name/set` 对未加载 thread 的处理就是追加 `session_index.jsonl`
- 官方会在读取 thread 信息时把 session index 中的 name 挂回 `Thread.name`
- `title` 是内部抽取字段，不等于用户 rename name

## 后果

正面：

- 与官方语义一致
- 后续 `resume/list/read` 可直接看到
- 外置项目不需要碰高风险 SQLite

负面：

- 活跃 TUI 里的实时刷新不一定立刻可见
- 文件是 append-only，需要后续 compact

## 不选其他方案的原因

### SQLite

- 层级错误
- 有并发和 WAL 风险

### rollout

- 不符合官方 rename 持久化模型

### sidecar-only

- 只能被我们自己识别
- Codex 原生 UI 和其他工具看不到
