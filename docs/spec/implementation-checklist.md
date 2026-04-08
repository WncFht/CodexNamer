# 实现 Checklist

> 历史过程清单。更新时间：`2026-04-09`

这份清单保留的是开发阶段的“做过什么”，不再逐项代表当前产品语义。为避免误读，下面只保留与当前代码仍一致的项目，并把已删除的旧行为移出清单。

## 0. 代码前准备

- [x] 产品范围与非目标明确
- [x] 写回层决策完成
- [x] 非 wrapper 架构决策完成
- [x] 自动 rename 触发逻辑定稿
- [x] AI 配置继承方案定稿
- [x] compact 语义定稿

## 1. 基础脚手架

- [x] 初始化 monorepo 结构
- [x] 统一 TypeScript 配置
- [x] 建立共享 DTO 与 schema 包

## 2. 文件层能力

- [x] 读取 `session_index.jsonl`
- [x] 追加写入 `session_index.jsonl`
- [x] 离线 compact `session_index.jsonl`
- [x] 扫描 rollout 文件列表
- [x] 增量读取 rollout 文件

## 3. 领域模型

- [x] session extractor
- [x] revision builder
- [x] dirty tracking
- [x] rename state repository
- [x] AI request logs repository

## 4. rename engine

- [x] heuristic summarizer
- [x] builder-first 结构化命名
- [x] duplicate suppression
- [x] AI suggest 接口
- [x] prompt preview

## 5. 调度与自动化

- [x] watcher
- [x] periodic sweep
- [x] candidate generation
- [x] finalize apply
- [x] freeze 逻辑
- [x] rename replay / requeue

## 6. CLI

- [x] `list`
- [x] `show`
- [x] `suggest`
- [x] `apply`
- [x] `rename`
- [x] `batch apply`
- [x] `freeze`
- [x] `unfreeze`
- [x] `compact-index`
- [x] `doctor`
- [x] `config print`
- [x] `provider test`

## 7. WebUI

- [x] Sessions
- [x] Settings / Naming policy
- [x] Rename Ops / 状态页
- [x] Daemon 控制页
- [x] provider diagnostics
- [x] request log 分页与详情

## 8. AI provider

- [x] `backend = none`
- [x] `backend = responses`
- [x] `backend = openai-compatible`
- [x] 从 Codex 配置继承 provider
- [x] provider test

## 9. 测试

- [x] writer 单元测试
- [x] compact 单元测试
- [x] revision 单元测试
- [x] batch dirty rename 集成测试
- [x] overview dedup 测试
- [x] runtime display 测试
- [ ] CLI smoke tests

## 10. 当前仍需补强

- [ ] provider 连通性相关的全量测试稳定性
- [ ] auto-apply 稳定性 gate
- [ ] `freeze_manual_name` 是否继续保留
