# ADR 0002: 采用非 wrapper 的外置架构

## 状态

Accepted

## 背景

需要决定本项目是否通过 wrapper 接管 Codex 启动，从而获得更精确的生命周期事件。

## 决策

不使用 wrapper。采用：

- daemon
- watcher
- 本地状态库
- 手动操作入口
- idle finalize 自动化

## 原因

- 用户明确不希望改动 Codex 启动方式
- 独立项目应尽量低侵入
- 绝大多数 rename 管理需求可以由“rollout 观察 + idle 策略”覆盖

## 代价

- 默认情况下无法 100% 精确感知每次 `/clear` 和 `/exit`
- 当前活跃 session 的判断更依赖启发式

## 补偿措施

- 使用 material change + idle finalize
- 使用 dirty revision
- 支持可选的 TUI session log 增强
- 提供手动批量 rename dirty sessions

## 结论

非 wrapper 架构更符合本项目的用户约束，代价可接受。
