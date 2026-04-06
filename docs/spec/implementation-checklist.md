# 实现 Checklist

> 状态说明：这是一份历史过程清单，保留的是开发时阶段性判断，不保证逐项反映当前实现。当前代码能力请优先参考 [仓库总览](./repo-overview.md) 与测试。

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
- [ ] 建立日志与错误处理基础设施

## 2. 文件层能力

- [x] 读取 `session_index.jsonl`
- [x] 追加写入 `session_index.jsonl`
- [x] 离线 compact `session_index.jsonl`
- [x] 扫描 rollout 文件列表
- [x] 增量读取 rollout 文件

## 3. 领域模型

- [x] 实现 session extractor
- [x] 实现 revision builder
- [x] 实现 dirty tracking
- [x] 实现 rename state repository

## 4. rename engine

- [x] 实现 heuristic summarizer
- [x] 实现 template renderer
- [x] 实现 length limiter
- [x] 实现 duplicate suppression
- [x] 定义 AI suggest 接口

## 5. 调度与自动化

- [x] 实现 watcher
- [x] 实现 periodic sweep
- [x] 实现 candidate generation
- [x] 实现 finalize apply
- [x] 实现 manual override 检测
- [x] 实现 freeze 逻辑

## 6. CLI

- [x] `list`
- [x] `show`
- [x] `suggest`
- [x] `apply`
- [x] `rename`
- [ ] `batch suggest`
- [x] `batch apply`
- [x] `freeze`
- [x] `unfreeze`
- [x] `compact-index`
- [x] `doctor`
- [x] `config print`
- [x] `provider test`

## 7. WebUI

- [x] Session 列表页
- [x] Session 详情页
- [x] Batch rename / rename ops 页
- [x] Settings / Rules / Naming policy
- [x] Provider diagnostics
- [x] Maintenance / Runtime 页

## 8. AI provider

- [x] `backend = none`
- [x] `backend = codex`
- [x] `backend = openai-compatible`
- [x] 从 Codex 配置继承 provider
- [x] provider test

## 9. 测试

- [x] writer 单元测试
- [x] compact 单元测试
- [x] revision 单元测试
- [x] manual override 测试
- [x] batch dirty rename 集成测试
- [ ] CLI smoke tests

## 10. 发布前检查

- [x] 文档与行为一致
- [ ] 默认配置合理
- [ ] 没有明文密钥输出
- [ ] compact 有备份
- [ ] 自动 rename 不会过频
