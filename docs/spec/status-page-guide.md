# 状态页说明（Rename Ops / 运行态）

更新时间：`2026-04-09`

## 1. 页面回答什么问题

状态页现在主要回答三件事：

1. daemon 最近是不是真的在 auto-apply
2. 最近几轮 sweep 究竟扫了多少、处理了多少、还剩多少
3. 最近 rename activity 和 AI 请求是否健康

## 2. 数据来源

状态页主要读这些接口：

- `/api/v1/overview`
- `/api/v1/ai/request-logs`
- `/api/v1/doctor`

说明：

- 这里看的主要是 `/api/v1/overview` 里的 heartbeat 与 sweep summary
- daemon 子进程 controller 本身的运行信息在 `Daemon` 页面
- requeue preview / execute 在 `Requeue` 页面

## 3. 页面结构

主内容区当前分成：

1. 自动重命名运行态
2. sweep / pipeline / coverage 图表
3. 模型请求日志
4. 原始 doctor 信息

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

这里的运行态说明，当前直接来自最近一次成功写入数据库的 sweep summary。

最关键的字段是：

- `scan.scannedRollouts`
- `scan.updatedSessions`
- `dirtyTotal`
- `total`
- `pending`
- `suggest`
- `apply`
- `skip`
- `failedSuggestions`
- `autoApplied`

## 5. controller 与 heartbeat 的区别

状态页不直接回答“API 现在托管的 daemon 子进程活没活”，而是回答：

- 最近一次成功 sweep 记录到了什么
- 这个 heartbeat 目前是 `running / stale / not_seen`

所以状态页更偏“运行快照与趋势”，不是 live process console。

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

把最近一轮 preview / apply 评估原因映射到：

- `skip`
- `suggest`
- `apply`

它显示的是当前整体分布，不是单独的待处理队列。

### 近期 sweep 趋势

来源：`overview.runtime.recentSweeps`

这里重点看：

- 每轮 sweep 看到了多少 dirty sessions
- 每轮实际处理了多少
- 还有多少 `pending`
- `failedSuggestions` 有没有抬头
- `autoApplied` 是否开始出现

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

### 规则覆盖状态

来源：`overview.ruleCoverage`

当前会区分：

- `latest`
- `outdated`
- `manual`
- `unknown`

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
- 状态页表格现在明确按 10 条一页请求

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

当前“信息”列的语义是：

- 成功：显示模型产出的最终命名
- 失败：显示错误信息

表格不再做单元格截断；内容完整显示，必要时允许横向滚动。

### 详情区

选中一条请求后，详情区会展示：

- 表格中的关键元信息
- `ID / 项目 / Thread / 状态 / 开始时间 / 结束时间 / 耗时`
- `模型 / 后端 / 传输 / 接口 / provider ref / profile`
- `chars / final name / error`
- request payload
- response payload

如果翻页或换筛选后当前选中的请求不在当前页，详情会自动清空。

## 8. 已移出的内容

下面这些内容已经不在状态页里：

- `requeue`
- 独立的“状态说明”文本块
- 旧的“待处理 / preview 队列”列表
- daemon 启停控制

它们现在分别在：

- `Requeue` 页面
- `Daemon` 页面

## 9. 如何快速排障

建议按这个顺序看：

1. 先看顶部 runtime，确认 daemon 和 auto-apply 是否真的活着
2. 再看 sweep 指标，确认最近一轮到底扫了多少、剩了多少、是否已自动落盘
3. 看图表确认是不是大量会话停在 `active / candidate_ready / finalize_ready`
4. 如果怀疑模型请求异常，看请求日志
5. 如果改了规则后想重跑旧会话，去 `Requeue` 页面
