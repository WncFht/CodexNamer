# WebUI / TUI / Local API 详细设计

更新时间：`2026-04-13`

这份文档描述的是**当前已落地实现**，不是早期 proposal。

## 1. 统一原则

- Web 与 TUI 当前都消费同一套 Local API
- CLI 与 standalone daemon 可以直接调用 core
- 保护态只保留 `freeze`
- builder 是当前命名结构主入口
- 请求日志由后端分页，不在前端一次性缓存全量

## 2. Web 当前结构

### 2.1 Sessions

左侧：

- workspace 列表
- session 列表

右侧：

- transcript
- rename history
- session metadata

当前会话级操作：

- `Suggest`
- `Apply`
- `Freeze / Unfreeze`

当前 Web 没有独立的手动 rename 按钮。

### 2.2 Settings

当前 section：

- `Overview`
- `Naming`
- `AI Provider`
- `Scheduler`
- `Runtime`

其中：

- `Naming` 负责 builder / tags / prompt preview / context strategy / prompt override
- `AI Provider` 负责 provider source / manual profile / provider parse / provider test
- `Scheduler` 负责 scan cadence、idle thresholds 与 auto-apply policy
- `Runtime` 负责路径与 resolved provider 视图

### 2.3 Rename Ops / Maintenance

主要分区：

- runtime hero / KPI
- overview 图表
- request logs
- doctor JSON
- dirty auto-rename preview

说明：

- `preview queue` 与 `requeue` 已拆到独立的 `Requeue` 页面
- 当前页面更偏 sweep 运行态、图表与请求日志观测

### 2.4 Requeue

主要分区：

- 当前规则签名与覆盖情况
- queue / skip 原因统计
- 会话级 preview 列表
- 执行重新入队

### 2.5 Daemon

主要分区：

- controller 状态
- runtime explain
- process 信息
- preview 摘要
- 下一次定时 sweep 倒计时
- 最近日志

### 2.6 视觉系统

当前 Web 已统一到一套更产品化的壳层：

- `system / light / dark` 三态主题
- 更轻的 workspace rail
- 统一的 card / pill / form / chart 语义

## 3. TUI 当前结构

当前 TUI 是高密度终端管理界面，共四个 screen mode：

- `browser`
- `maintenance`
- `daemon`
- `settings`

### 3.1 Browser

主要能力：

- session 列表
- session 详情
- transcript
- rename history
- suggest / apply / freeze / manual rename
- 搜索与 transcript role/query 过滤
- dirty preview / batch apply

### 3.2 Maintenance

主要能力：

- runtime 摘要
- auto-rename preview 刷新
- replay basis 切换
- since 值编辑与 requeue 执行

### 3.3 Daemon

主要能力：

- daemon start / stop
- runtime 状态刷新
- controller 与 heartbeat 联动显示

### 3.4 Settings

主要能力：

- 配置字段编辑
- prompt preview
- provider test
- import Codex provider
- 保存设置

## 4. Local API 当前约束

- 默认本地使用，不做远程多用户设计
- 返回 DTO 由 `packages/shared` 统一定义
- `sessions` 列表是过滤 + 排序，不是 cursor API
- transcript 与 request logs 使用分页
- config update 当前只写用户级配置文件
- prompt preview 既支持已保存配置，也支持带 `userConfig` 的草稿预览

## 5. 请求日志契约

### 列表接口

`GET /api/v1/ai/request-logs`

当前支持：

- `page`
- `pageSize`
- `search`
- `project`
- `status`
- `transport`

返回：

- `total`
- `page`
- `pageSize`
- `totalPages`
- `statusCounts`
- `projects`
- `items`

### 明细接口

`GET /api/v1/ai/request-logs/:id`

当前会返回：

- 表格里的元字段
- prompt / response 文本
- request / response payload
- 最终解析结果

## 6. 当前与旧设计的差异

下面这些旧设计已失效：

- `manual override`
- `naming style` 切换
- `backend = "codex"`
- `codex exec` fallback
- Web 里的手动 rename 按钮

## 7. 当前实现边界

当前 UI 与 API 只围绕现行配置模型工作：

- `naming.builder`
- `naming.tags`
- `ai.backend`
- `ai.provider_source`
- `rename.auto_apply`
- `providerProfiles` / `[provider.<id>]`
