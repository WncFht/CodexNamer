# CLI / API / UI 设计

更新时间：`2026-04-09`

这份文档只描述**当前已实现**的 CLI / Local API / UI 契约。

## 1. CLI

当前命令：

```bash
codexnamer list [--dirty]
codexnamer show --id <thread-id>
codexnamer suggest --id <thread-id>
codexnamer apply --id <thread-id>
codexnamer rename --id <thread-id> --name "..."
codexnamer history --id <thread-id>
codexnamer freeze --id <thread-id>
codexnamer unfreeze --id <thread-id>
codexnamer batch apply --dirty [--preview]
codexnamer compact-index [--dry-run]
codexnamer doctor
codexnamer config print
codexnamer provider test
```

说明：

- `batch apply` 目前只支持 `--dirty`
- 不存在 CLI 级 `manual override`

## 2. Local API

### 核心资源

- `GET /api/v1/sessions`
- `GET /api/v1/sessions/:id`
- `GET /api/v1/sessions/:id/transcript`
- `GET /api/v1/sessions/:id/history`
- `POST /api/v1/sessions/:id/suggest`
- `POST /api/v1/sessions/:id/apply`
- `POST /api/v1/sessions/:id/rename`
- `POST /api/v1/sessions/:id/freeze`
- `POST /api/v1/sessions/:id/unfreeze`
- `POST /api/v1/sessions/batch/suggest`
- `POST /api/v1/sessions/batch/apply`
- `GET /api/v1/overview`
- `GET /api/v1/auto-rename/preview`
- `GET /api/v1/ai/request-logs`
- `GET /api/v1/ai/request-logs/:id`
- `GET /api/v1/daemon`
- `POST /api/v1/daemon/start`
- `POST /api/v1/daemon/stop`

说明：

- `npm run api` 启动后会默认自动拉起 controller-managed daemon
- `GET /api/v1/daemon` 现在除了进程与日志信息，还会返回下一次定时 sweep 的 `nextSweepAt`

### `GET /api/v1/sessions`

支持过滤：

- `dirty`
- `frozen`
- `status`
- `project`
- `provider`
- `workspace`
- `search`
- `sort = updatedAt | project | officialName`
- `order = asc | desc`
- `limit`

当前不支持：

- `manualOverride`
- cursor pagination

### `GET /api/v1/sessions/:id/transcript`

支持：

- `page`
- `pageSize`
- `includeHidden`
- `role = all | user | assistant | tool | system`
- `query`

### `POST /api/v1/sessions/:id/apply`

语义：

- 取当前存储的 candidate，必要时现算一个
- 去重后写入 `session_index.jsonl`
- 写 rename history

### `POST /api/v1/sessions/:id/rename`

语义：

- 用户直接给最终名字
- 走与 apply 相同的 official writeback
- `source = manual`

### `POST /api/v1/sessions/batch/suggest`

当前语义：

- 只做 dirty 批处理预览
- 返回的数据结构与 `batch apply --preview` 对齐

### `POST /api/v1/sessions/batch/apply`

当前语义：

- 只支持 dirty 批处理
- `previewOnly = true` 时只预览
- frozen 会话会被跳过

### `GET /api/v1/ai/request-logs`

支持：

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

说明：

- API 缺省页大小是 40
- Web 状态页现在按 10 条一页调用这个接口

## 3. Web UI

当前主视图：

- `Sessions`
- `Settings`
- `状态 / Rename Ops`
- `Requeue`
- `Daemon`

### Sessions

当前支持：

- workspace 浏览
- session 列表 / transcript / rename history
- 会话级 `Suggest / Apply / Freeze`

### Settings

当前支持：

- naming builder
- tags
- prompt preview
- context strategy / context budget
- AI backend / provider source / profile
- watch 阈值

### 状态

当前支持：

- runtime KPI
- overview 图表
- request logs
- doctor JSON

说明：

- `preview queue` 与 `requeue` 已从状态页拆出
- 状态页现在主要展示 runtime summary、sweep 趋势、pipeline 分布与请求日志

### Requeue

当前支持：

- 按规则签名 preview queue / skip
- 分页查看会话级结果
- 执行重新入队

### Daemon

当前支持：

- start / stop
- PID / interval / log tail
- 下一次定时 sweep 倒计时
- runtime explain

## 4. TUI

当前支持：

- 浏览与搜索
- transcript 分页 / role 过滤
- suggest / apply / freeze / manual rename
- batch dirty apply
- settings 编辑

常用快捷键：

- `s` suggest
- `a` apply
- `r` manual rename
- `f` freeze / unfreeze
- `p` preview dirty auto-rename
- `A` batch apply dirty

当前不存在：

- `m` manual override toggle
