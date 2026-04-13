# CLI / API / UI 设计

更新时间：`2026-04-13`

这份文档只描述**当前已实现**的 CLI / Local API / UI 契约。

## 1. CLI

当前 CLI 分成三组能力。

### 1.1 会话与维护命令

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

- `batch apply` 当前只支持 `--dirty`
- 不存在 CLI 级 `manual override`
- `config print` 与 `provider test` 当前都是用户友好的别名写法；内部注册命令分别是 `config-print` 与 `provider-test`

### 1.2 本地常驻服务入口

```bash
codexnamer serve [--host 127.0.0.1] [--port 42110] [--web-root <path>] [--no-daemon]
```

当前语义：

- 要求存在构建好的 Web 资产
- 同时启动 Local API 与静态 Web 托管
- 默认自动拉起 controller-managed daemon

### 1.3 用户级 service 管理

```bash
codexnamer service install [--start] [--json]
codexnamer service start [--json]
codexnamer service stop [--json]
codexnamer service restart [--json]
codexnamer service status [--json]
codexnamer service uninstall [--json]
```

说明：

- 当前 parser 会把 `service install` 这种写法归一化到内部命令 `service-install`
- `service-host` 是内部 service 启动入口，不作为普通用户命令文档主路径
- 默认输出是面向人的摘要；TTY 下会自动带 ANSI 颜色
- 只有传 `--json` 时才输出机器可读 JSON
- 如果只想禁用颜色，可设置 `NO_COLOR=1`

## 2. Local API

### 2.1 资源分组

#### Health / events

- `GET /api/v1/health`
- `GET /api/v1/events/since`

#### Sessions / workspaces

- `GET /api/v1/sessions`
- `GET /api/v1/workspaces`
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

#### Overview / runtime / maintenance

- `GET /api/v1/overview`
- `POST /api/v1/scan`
- `GET /api/v1/doctor`
- `GET /api/v1/maintenance/stats`（当前兼容别名，返回与 `doctor` 相同）
- `POST /api/v1/maintenance/compact-index`
- `POST /api/v1/maintenance/requeue-preview`
- `POST /api/v1/maintenance/requeue-renames`

#### AI / providers / config

- `GET /api/v1/auto-rename/preview`
- `GET /api/v1/ai/prompt-preview`
- `POST /api/v1/ai/prompt-preview`
- `GET /api/v1/ai/request-logs`
- `GET /api/v1/ai/request-logs/:id`
- `GET /api/v1/providers`
- `POST /api/v1/providers/test`
- `POST /api/v1/providers/parse-codex`
- `GET /api/v1/config`
- `PUT /api/v1/config`

#### Daemon

- `GET /api/v1/daemon`
- `POST /api/v1/daemon/start`
- `POST /api/v1/daemon/stop`

说明：

- `npm run api` / `codexnamer serve` 启动后默认都会自动拉起 controller-managed daemon
- `GET /api/v1/daemon` 返回的是**当前 API 进程托管的 daemon 子进程状态**
- `GET /api/v1/overview.runtime.*` 返回的是最近一次成功 sweep 的 runtime 快照

### 2.2 `GET /api/v1/sessions`

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

### 2.3 `GET /api/v1/sessions/:id/transcript`

支持：

- `page`
- `pageSize`
- `includeHidden`
- `role = all | user | assistant | tool | system`
- `query`

### 2.4 `GET /api/v1/ai/prompt-preview` / `POST /api/v1/ai/prompt-preview`

- `GET`：基于当前已保存配置预览 prompt，可选 `threadId`
- `POST`：允许带上临时 `userConfig`，用于预览未保存设置草稿的 prompt 效果

### 2.5 `GET /api/v1/config` / `PUT /api/v1/config`

当前语义：

- `GET` 返回 `ConfigView`
- `PUT` 只写用户配置文件，返回：
  - `writtenTo`
  - `restartRequired`
  - `config`

### 2.6 `POST /api/v1/sessions/batch/suggest`

当前语义：

- 只做 dirty 批处理预览
- 返回的数据结构与 `batch apply --preview` 对齐

### 2.7 `POST /api/v1/sessions/batch/apply`

当前语义：

- 只支持 dirty 批处理
- `previewOnly = true` 时只预览
- frozen 会话会被跳过

### 2.8 `GET /api/v1/ai/request-logs`

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
- Web 状态页固定按 10 条一页调用这个接口

## 3. Web UI

当前主视图：

- `Sessions`
- `Settings`
- `Rename Ops / Maintenance`
- `Requeue`
- `Daemon`

### Sessions

当前支持：

- workspace 浏览
- session 列表 / transcript / rename history
- transcript role 过滤、分页与搜索
- 会话级 `Suggest / Apply / Freeze`

### Settings

当前 section：

- `Overview`
- `Naming`
- `AI Provider`
- `Scheduler`
- `Runtime`

当前支持：

- naming builder / tags / prompt override
- prompt preview
- context strategy / context budget
- AI backend / provider source / manual profile
- provider parse / provider test
- watch 阈值与 auto-apply 策略
- 配置路径与 resolved provider 视图

### Rename Ops / Maintenance

当前支持：

- runtime KPI
- overview 图表
- request logs
- doctor JSON
- dirty auto-rename preview

说明：

- `preview queue` 的会话级重跑现在放在 `Requeue` 页面
- Maintenance 页现在主要展示 runtime summary、趋势图表、请求日志和 doctor 信息

### Requeue

当前支持：

- 按规则签名 preview queue / skip
- 查看原因统计和会话级结果
- 执行重新入队

### Daemon

当前支持：

- start / stop
- PID / interval / next sweep countdown / recent logs
- runtime explain

### 主题与壳层

当前 Web 还支持：

- `system / light / dark` 三态主题
- 更轻的 workspace rail 与内容优先布局
- 统一的 maintenance 图表语义色板

## 4. TUI

当前 TUI 有四个 screen mode：

- `browser`
- `maintenance`
- `daemon`
- `settings`

### Browser

当前支持：

- 浏览与搜索
- transcript 分页 / role 过滤 / query 搜索
- suggest / apply / freeze / manual rename
- batch dirty preview / apply

### Maintenance

当前支持：

- runtime 摘要
- dirty preview 刷新
- requeue basis 切换
- since 时间编辑与 requeue 执行

### Daemon

当前支持：

- daemon start / stop
- runtime 状态刷新
- controller 与 heartbeat 联动显示

### Settings

当前支持：

- 配置字段编辑
- prompt preview
- provider test
- import Codex provider
- 保存设置

### 常用快捷键

代表性快捷键如下：

- `,`：在 `browser → maintenance → daemon → settings` 间切换
- `s / a / r / f`：suggest / apply / rename / freeze
- `p / A`：刷新 preview / 批量 apply dirty
- `R`：刷新当前 maintenance / daemon / settings 视图
- `T / I`：在 settings 里 test provider / import Codex provider

当前不存在：

- `m` manual override toggle
