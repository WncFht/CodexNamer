# 实现路线图

## 原则

- 先把“读、判定、写回”闭环做稳
- 再做界面
- 再做高级自动化

## v0.1 文档冻结

交付物：

- 设计书
- 数据模型
- API/CLI/UI 规格
- 维护与 compact 规格
- 参考项目对照
- ADR

完成标准：

- 开始编码前的关键决策基本不再反复摇摆

## v0.2 核心后端

交付物：

- 项目脚手架
- watcher
- rollout extractor
- SQLite 状态库
- session_index writer
- CLI 基础命令

完成标准：

- 可以列出 sessions
- 可以识别 dirty
- 可以单个 suggest / apply / rename

## v0.3 批量与自动化

交付物：

- batch suggest / apply
- automatic idle finalize
- manual override / freeze
- rename history

完成标准：

- “rename 所有 dirty sessions” 可运行
- 自动 rename 可控，不会过频

## v0.4 WebUI

交付物：

- session 列表页
- 详情页
- 批量 rename 页
- 规则配置页
- provider 配置页
- maintenance 页

完成标准：

- 用户无需 CLI 也能完成主要管理任务

## v0.5 TUI

交付物：

- session 浏览
- 多选批处理
- 快速 rename
- compact / doctor

完成标准：

- 终端内可完成高频管理任务

## v0.6 增强能力

候选项：

- 启用 TUI session log 增强 clear/exit 判断
- 更多命名 preset
- 导入导出规则
- AI prompt 版本管理
- 批量操作撤销

## v1 范围建议

v1 建议锁定在：

- daemon
- SQLite 状态库
- watcher + extractor
- heuristic rename
- optional AI rename
- batch dirty rename
- WebUI
- compact-index

TUI 可以放到 v1.1。

## 实施顺序

建议实际开发顺序：

1. 定义 TypeScript domain types
2. 实现 session index reader/writer
3. 实现 rollout extractor
4. 实现 revision builder
5. 实现 SQLite repository
6. 实现 heuristic rename engine
7. 实现 CLI
8. 实现 daemon
9. 实现 WebUI
10. 补 AI backend

## 里程碑验收

### Milestone A

- 能扫描现有 sessions
- 能展示官方 name 和 dirty 状态

### Milestone B

- 能单个 rename
- 能批量 rename dirty sessions

### Milestone C

- 能自动 idle finalize
- 能 freeze/manual override

### Milestone D

- WebUI 可配置规则与 provider
- 能 compact index
