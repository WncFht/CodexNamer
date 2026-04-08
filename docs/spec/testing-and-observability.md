# 测试与可观测性

更新时间：`2026-04-09`

## 目标

当前最需要防回归的不是 UI 小改动，而是：

- dirty / revision 判定漂移
- auto-rename guard 顺序被改坏
- apply / batch apply 写回语义错误
- `session_index.jsonl` compact 破坏 latest-wins
- overview 统计把同一会话重复计数
- 请求日志筛选 / 分页 / 详情显示与后端不一致

## 当前测试重点

### 1. core / 写回

- revision 构建
- rename apply / rename history
- freeze / unfreeze
- batch dirty apply
- duplicate official name 处理
- compact latest-wins

### 2. auto-rename

- `estimateSessionStatus()`
- `evaluateAutoRename()`
- `frozen`
- `rename_cooldown`
- `max_auto_renames_reached`
- daemon auto-apply 路径

### 3. overview / runtime

- overview 聚合口径
- rename activity 去重
- accepted official name 统计
- runtime display 派生逻辑

### 4. API / Web 交互

- sessions list/detail/transcript
- request logs 查询参数
- request log 分页响应结构
- browser / runtime panel 辅助函数

## 直接相关的现有测试

典型用例包括：

- [test/auto-rename-evaluation.test.ts](../../test/auto-rename-evaluation.test.ts)
- [test/auto-rename-apply.test.ts](../../test/auto-rename-apply.test.ts)
- [test/history-freeze.test.ts](../../test/history-freeze.test.ts)
- [test/overview-dedup.test.ts](../../test/overview-dedup.test.ts)
- [test/api.test.ts](../../test/api.test.ts)
- [test/runtime-display.test.ts](../../test/runtime-display.test.ts)

## 当前可观测性面

项目目前没有独立 metrics endpoint；主要依赖下面这些内建面板和接口：

### 1. `overview`

- pipeline 分布
- rename history 聚合
- 近期 rename activity
- 工作区负载
- daemon runtime 快照

### 2. `doctor`

- 路径存在性
- session_index 可读写性
- DB 路径
- auto-rename 配置
- provider 解析结果

### 3. `ai_request_logs`

- `running / succeeded / failed`
- `responses / openai-compatible`
- 项目、thread、模型、base URL、耗时、错误
- 请求/响应 payload 与最终解析结果

### 4. daemon 控制面板

- controller running / stopped
- PID、启动时间、最近日志
- `configuredAutoApply`
- `actualExecution`
- `lastSweepSummary`

## 当前文档约束

- 不再把 `manual override` 当作活跃保护态来测试或观测
- 不再把 `brief / detailed` 当作当前配置行为来测试
- 请求日志文档必须反映：
  - 后端分页
  - 状态页每页 10 条
  - 可直接跳页
  - 可以看完整历史，而不是固定 40 条前端快照

## 回归验收口径

至少应满足：

- 对同一组 fixture，重复运行两次结果一致
- frozen 会话不会被 auto-apply
- batch dirty apply 不会重复写入完全相同的 official name
- overview 图表不会把同一会话的多次 rename 重复累计
- 请求日志筛选和翻页后，详情区不会停留在当前页不可见的旧请求
