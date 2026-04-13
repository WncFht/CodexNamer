# 实现路线图

> 历史规划文档。更新时间：`2026-04-13`

这份文档保留项目早期的阶段划分思路，不再逐项代表当前代码事实。

当前真实能力请优先参考：

- [README](../../README.md)
- [仓库总览](../../spec/repo-overview.md)
- [配置与 AI 后端](../../spec/config-and-ai.md)

## 历史阶段划分

### v0.1 文档冻结

- 设计书
- 数据模型
- API / CLI / UI 规格
- compact 语义
- 关键设计决策整理

### v0.2 核心后端

- watcher
- rollout extractor
- SQLite 状态库
- session_index writer
- CLI 基础命令

### v0.3 批量与自动化

- batch preview / apply
- idle finalize auto-apply
- freeze
- rename history

### v0.4 WebUI

- session 列表与详情
- settings / naming policy
- runtime / request logs
- compact / replay / provider diagnostics

### v0.5 TUI

- session 浏览
- transcript
- suggest / apply / freeze / manual rename
- batch dirty apply

### v0.6 增强能力

仍可继续演进的方向：

- 更强的 auto-apply 稳定性 gate
- ingest 增量信号真正进入调度核心
- 请求日志导出 / 更细粒度排序
- 更明确的 daemon / runtime 联动诊断

## 当前里程碑口径

### 已落地

- CLI / API / daemon / Web / TUI 都已可运行
- 状态页请求日志已是后端分页
- overview 统计已按会话去重
- `serve` 与用户级 service 流程已可用

### 仍在演进

- provider 测试链稳定性
- auto-apply 是否增加“稳定一轮”保护
