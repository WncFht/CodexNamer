# 文档总览

这套文档现在按“先看当前实现，再看设计约束，最后看历史材料”的顺序组织，避免把已经落地的行为、仍在生效的设计约束、以及早期规划草稿混在一起。

## 1. 先看这里

- [仓库总览](./spec/repo-overview.md)：从代码结构、运行入口、核心数据流、功能矩阵、测试与维护角度介绍整个仓库。
- [系统设计](./spec/system-design.md)：解释为什么这个项目是外置 session manager，以及核心子系统如何协作。
- [配置与 AI 后端](./spec/config-and-ai.md)：说明配置来源、AI provider 继承与当前命名相关配置。
- [WebUI / TUI / Local API 详细设计](./spec/web-tui-local-api-design.md)：查看界面层和本地 API 的具体行为。

## 2. 当前实现与行为约束

- [产品范围](./spec/product-scope.md)
- [数据模型](./spec/data-model.md)
- [触发与生命周期](./spec/trigger-and-lifecycle.md)
- [Auto Rename 评估与 Context 构建](./spec/rename-evaluation-and-context.md)
- [状态页说明（Rename Ops / 运行态）](./spec/status-page-guide.md)
- [CLI / API / UI 设计](./spec/cli-api-ui.md)
- [维护与压缩](./spec/maintenance-and-compaction.md)
- [测试与可观测性](./spec/testing-and-observability.md)
- [仓库布局与工程约定](./spec/repo-layout-and-standards.md)

## 3. 当前状态与待确认项

- [当前状态与 Pipeline 审查](./spec/status-and-pipeline-review.md)
- [开放问题](./spec/open-questions.md)

## 4. 历史规划材料

这些文档保留是为了追踪设计演进，不再作为“当前代码行为”的唯一依据：

- [实现路线图](./spec/implementation-roadmap.md)
- [实现 Checklist](./spec/implementation-checklist.md)

## 5. 决策记录

- [ADR 0001：通过 `session_index.jsonl` 写回](./adr/0001-writeback-via-session-index.md)
- [ADR 0002：不采用 wrapper 架构](./adr/0002-no-wrapper-architecture.md)

## 6. 设计参考与审查记录

- [Claude 风格接入说明](./design/claude/ADOPTION.md)
- [Claude 风格参考手册](./design/claude/DESIGN.md)
- [Claude 风格参考原始说明](./design/claude/README.md)
- [前端设计审查（2026-04-05）](./reviews/frontend-design-audit-2026-04-05.md)
- [参考项目对照](./research/reference-review.md)

## 7. 阅读建议

如果你是第一次进入仓库，建议按下面顺序读：

1. `README.md`
2. [仓库总览](./spec/repo-overview.md)
3. [系统设计](./spec/system-design.md)
4. [配置与 AI 后端](./spec/config-and-ai.md)
5. [Auto Rename 评估与 Context 构建](./spec/rename-evaluation-and-context.md)

如果你要改 UI：

1. [WebUI / TUI / Local API 详细设计](./spec/web-tui-local-api-design.md)
2. [Claude 风格接入说明](./design/claude/ADOPTION.md)
3. [前端设计审查（2026-04-05）](./reviews/frontend-design-audit-2026-04-05.md)

如果你要改调度、写回或状态机：

1. [数据模型](./spec/data-model.md)
2. [触发与生命周期](./spec/trigger-and-lifecycle.md)
3. [维护与压缩](./spec/maintenance-and-compaction.md)
4. [ADR 0001](./adr/0001-writeback-via-session-index.md)
