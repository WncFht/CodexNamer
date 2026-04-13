# 文档说明

这套文档现在分成两层：

- **面向用户 / 贡献者的主文档**：这里的 `docs/spec/**` 是当前代码主线的同步说明
- **维护者内部材料**：`docs/internal/**` 保留设计参考、评审记录、路线图和历史规划，便于维护追溯，但不再作为普通用户主阅读入口

## 面向用户 / 贡献者的主文档

### 建议先看

- [系统设计](./spec/system-design.md)
- [配置与 AI Provider](./spec/config-and-ai.md)
- [CLI / API / UI 总览](./spec/cli-api-ui.md)
- [Maintenance 与 compact](./spec/maintenance-and-compaction.md)
- [状态页说明](./spec/status-page-guide.md)

### 想继续理解实现时再看

- [仓库总览](./spec/repo-overview.md)
- [产品范围](./spec/product-scope.md)
- [数据模型](./spec/data-model.md)
- [运行时与 sweep 架构](./spec/runtime-and-sweep-architecture.md)
- [Rename 评估与 context](./spec/rename-evaluation-and-context.md)
- [触发与生命周期](./spec/trigger-and-lifecycle.md)
- [测试与可观测性](./spec/testing-and-observability.md)
- [仓库结构与工程约定](./spec/repo-layout-and-standards.md)
- [WebUI / TUI / Local API 详细设计](./spec/web-tui-local-api-design.md)

## 维护者内部材料

设计导入、评审草稿、路线图和历史规划材料已移动到 [`./internal/`](./internal/README.md)。

这些内容仍然保留在仓库里，但它们是**带日期的内部记录**，不再保证逐行同步当前代码。
