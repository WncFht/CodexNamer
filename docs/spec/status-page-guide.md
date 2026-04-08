# 状态页说明（Rename Ops / 运行态）

更新时间：`2026-04-09`

## 1. 页面回答什么问题

状态页主要回答四件事：

1. daemon 现在到底有没有真的在 auto-apply
2. 当前有哪些会话会落到 `skip / suggest / apply`
3. 最近 rename activity 和 AI 请求是否健康
4. 规则改了之后，如何把旧会话重新打回队列

## 2. 数据来源

状态页主要读这些接口：

- `/api/v1/overview`
- `/api/v1/auto-rename/preview`
- `/api/v1/ai/request-logs`
- `/api/v1/doctor`

另有 replay 与 daemon 控制相关接口：

- `/api/v1/maintenance/requeue-renames`
- `/api/v1/daemon`
- `/api/v1/daemon/start`
- `/api/v1/daemon/stop`

## 3. 页面结构

主内容区当前大致分成：

1. 自动重命名运行态
2. 四张 overview 图表
3. 状态说明
4. 当前预览队列
5. rename replay
6. 模型请求日志
7. 原始 doctor 信息

## 4. 顶部运行态

这里最重要的区别是：

- `apply` 只是“允许应用”
- 不是“已经自动落盘”

判断是否真的在自动落盘，要同时看：

- `overview.runtime.configuredAutoApply`
- `overview.runtime.actualExecution`
- `overview.runtime.daemonStatus`
- `overview.runtime.daemonAutoApply`
- `overview.runtime.lastSweepSummary.autoApplied`

## 5. 预览队列

状态页里的预览队列来自 `previewAutoRename()`，不是 daemon 上一轮 sweep 的历史快照。

当前动作只有三种：

- `skip`
- `suggest`
- `apply`

当前 guard 只有三类高优先级保护：

1. `frozen`
2. `max_auto_renames_reached`
3. `rename_cooldown`

不再有独立的 `manual_override` 分支。

## 6. 图表语义

### 会话阶段分布

看当前 session 落在：

- `discovered`
- `active`
- `candidate_ready`
- `finalize_ready`
- `applied`
- `idle`
- `archived_hint`
- `missing`

### 原因到动作的流向

把 `evaluateAutoRename()` 的 reason 映射到：

- `skip`
- `suggest`
- `apply`

### 近期重命名活动

来源：`overview.activity`

当前图只画：

- `applied`
- `previewOnly`
- `skipped`

口径说明：

- 已按会话去重
- 同一 thread 多次命名不会重复累计

### 应用来源分布

来源：`overview.renameHistory.aiApplied` 与 `manualApplied`

当前只统计 accepted official source：

- `ai`
- `manual`

同样按会话去重。

## 7. 请求日志

这是状态页里最偏运维视角的一块。

### 当前过滤器

- 搜索
- 项目
- 状态
- 传输

### 当前分页行为

- 后端分页
- 状态页每页固定 10 条
- 可以翻完整历史
- 支持首页 / 上一页 / 下一页 / 末页
- 支持直接输入页码跳转

说明：

- API 在没有传 `pageSize` 时仍会默认 40
- 但状态页表格现在明确按 10 条一页请求

### 表格列

- 时间
- 项目
- Thread
- 模型
- 状态
- 耗时
- 字符
- 传输
- 接口
- 信息

当前表格不再做单元格截断；内容完整显示，必要时允许横向滚动。

### 详情区

选中一条请求后，详情区会展示：

- 表格中的关键元信息
- `ID / 项目 / Thread / 状态 / 开始时间 / 结束时间 / 耗时`
- `模型 / 后端 / 传输 / 接口 / provider ref / profile`
- `chars / final name / error`
- request payload
- response payload

如果翻页或换筛选后当前选中的请求不在当前页，详情会自动清空。

## 8. replay

当前 replay 只做两件事：

- 清空命中会话的旧 candidate
- 重新把它们放回命名队列

可选基准：

- `session-updated-at`
- `last-applied-at`

## 9. 如何快速排障

建议按这个顺序看：

1. 先看顶部 runtime，确认 daemon 和 auto-apply 是否真的活着
2. 再看当前 preview queue，确认是 `skip` 还是 `apply`
3. 看图表确认是否只是大量 frozen / cooldown
4. 如果怀疑模型请求异常，看请求日志
5. 如果改了规则后想重跑旧会话，用 replay
