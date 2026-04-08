# WebUI / TUI / Local API 详细设计

更新时间：`2026-04-09`

这份文档描述的是**当前已落地实现**，不是早期 proposal。

## 1. 统一原则

- Web、TUI、CLI 都复用同一套 core / Local API
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

主要分区：

- Naming policy
- Runtime / provider
- watch thresholds
- maintenance

当前 Naming policy 包含：

- builder 编辑
- tag 编辑
- prompt preview
- context strategy / `context_max_chars`
- prompt override

### 2.3 状态（Rename Ops）

主要分区：

- runtime hero
- overview 图表
- preview queue
- replay
- request logs
- doctor JSON

请求日志当前具备：

- 搜索
- 项目筛选
- 状态筛选
- 传输筛选
- 后端分页
- 直接跳页
- 详情区自动跟随当前页可见项

### 2.4 Daemon

主要分区：

- controller 状态
- runtime explain
- process 信息
- queue 摘要
- 启动命令
- 最近日志

## 3. TUI 当前结构

当前是高密度终端管理界面。

主要能力：

- session 列表
- session 详情
- transcript
- rename history
- settings 编辑
- preview dirty auto-rename
- batch dirty apply

当前 TUI 操作：

- suggest
- apply
- manual rename
- freeze / unfreeze

## 4. Local API 当前约束

- 默认本地使用，不做远程多用户设计
- 返回 DTO 由 `packages/shared` 统一定义
- `sessions` 列表是过滤 + 排序，不是 cursor API
- transcript 与 request logs 使用分页

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

## 7. 还保留的兼容层

尽管当前 UI 不再使用，系统里仍保留部分 legacy 字段以兼容旧数据：

- `rename_history.style`
- `rename_state.current_candidate_style`
- `rename_state.last_applied_style`
- `rename_state.preferred_style`
- `rename_state.manual_override`
