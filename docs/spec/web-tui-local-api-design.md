# WebUI / TUI / Local API 详细设计

## 目标

为 `codex-session-manager` 定义一套可实施的前端与本地接口设计，满足：

- 浏览、筛选、搜索和排序本地 Codex sessions
- 查看 official name / candidate name / dirty / freeze / manual override / history
- 批量 rename dirty sessions
- 单个 session suggest / apply / manual rename / freeze / unfreeze
- 配置 AI backend、provider profile、命名规则、自动 rename 策略
- 执行 compact、doctor、maintenance 类操作

这份设计文档只定义契约与交互语义，不要求在当前阶段立刻实现完整 UI。

## 参考项目与取舍

### 1. TokenArena

参考仓库：
- `https://github.com/poco-ai/TokenArena`

借鉴点：
- parser / extractor / service 分层清晰
- daemon 模式和定时同步逻辑简洁
- CLI 与业务逻辑解耦

应用到本项目：
- 前端和本地 API 都不能直接碰 rollout 解析
- 所有 session 视图都只能消费 `SessionSummary` / `SessionDetail`
- daemon 与 UI 共享同一套 manager/service

不直接照搬的部分：
- TokenArena 偏统计与上传，不是会话 rename 管理器
- 没有围绕 `official name / candidate / freeze / manual override / history` 的 UI 语义

### 2. CLI History Hub

参考仓库：
- `https://github.com/nameIsNoPublic/cli-history-hub`

借鉴点：
- 本地 Web UI + Node 本地服务模式
- 会话列表、会话详情、搜索、时间线、统计这些浏览入口很完整
- 对 Codex `session_index.jsonl` 和 sidecar 元数据的区分比较明确

应用到本项目：
- WebUI 第一版可以走“本地 API + SPA”的轻量模式
- Session 列表页和详情页信息密度可以借鉴它的布局方式
- 会话元数据应与原始 JSONL 分层，展示上把 `official name` 和 `custom/project state` 区分开

不直接照搬的部分：
- CLI History Hub 约束自己不写原始 JSONL；我们需要正式写回 `session_index.jsonl`
- 它的 sidecar 是主用户态存储；我们这里主存储是 SQLite，sidecar 不是必须
- 它是浏览器优先，我们需要同时兼顾 CLI / daemon / TUI / WebUI

### 3. Codex Mate

参考仓库：
- `https://github.com/SakuraByteCore/codexmate`

借鉴点：
- 本地优先的 CLI + Web UI + 本地 API 组合
- 标签页式功能区划分：配置、会话、市场等
- provider 配置管理与 Web 表单交互经验

应用到本项目：
- 本地 API 应该成为 WebUI/TUI 的统一后端
- WebUI 应使用标签页/侧边导航，而不是把所有功能堆进一个会话页
- Provider 配置、Rules、Maintenance 适合做成独立一级页面

不直接照搬的部分：
- Codex Mate 的 session title 更偏“浏览导出/清理”，不是 rename 生命周期管理
- 它大量功能集中在单仓库大文件，我们不沿用这种实现方式
- 一些状态落在浏览器 `localStorage`；我们这里要尽量把会话管理状态放到后端 DB

## 产品形态

建议形态保持：

- `CLI`
  - 适合脚本、单次操作、批处理
- `daemon`
  - 适合扫描、增量 ingest、auto-rename preview/finalize
- `local API`
  - WebUI 和 TUI 的唯一后端入口
- `WebUI`
  - 适合可视化筛选、预览、批量处理、配置编辑
- `TUI`
  - 适合终端环境快速筛选、预览和批量 apply

不引入：

- 远程服务端
- 多用户共享状态
- 浏览器直接读本地文件

## 本地 API 总体约束

- 默认只监听 `127.0.0.1`
- 可选 Unix socket
- API 层不直接解析 rollout
- API 层只调用 `CodexSessionManager` 和后续 service
- 所有返回都基于共享 DTO
- 默认 JSON API；不做 GraphQL

## API 版本与基线路径

建议：

```text
GET  /api/v1/health
GET  /api/v1/sessions
GET  /api/v1/sessions/:id
GET  /api/v1/sessions/:id/history
POST /api/v1/sessions/:id/suggest
POST /api/v1/sessions/:id/apply
POST /api/v1/sessions/:id/rename
POST /api/v1/sessions/:id/freeze
POST /api/v1/sessions/:id/unfreeze
POST /api/v1/sessions/:id/manual-override
POST /api/v1/sessions/:id/clear-manual-override
POST /api/v1/sessions/batch/suggest
POST /api/v1/sessions/batch/apply
POST /api/v1/scan
GET  /api/v1/providers
GET  /api/v1/config
PUT  /api/v1/config
GET  /api/v1/maintenance/stats
POST /api/v1/maintenance/compact-index
GET  /api/v1/doctor
```

## API 资源设计

### `GET /api/v1/health`

返回：

```json
{
  "ok": true,
  "version": "0.1.0",
  "time": "2026-04-04T15:00:00Z"
}
```

### `GET /api/v1/sessions`

查询参数：

- `dirty=true|false`
- `frozen=true|false`
- `manualOverride=true|false`
- `status=active|candidate_ready|finalize_ready|applied`
- `project=...`
- `provider=...`
- `search=...`
- `sort=updatedAt|project|officialName`
- `order=asc|desc`
- `limit=...`
- `cursor=...`

返回：

```json
{
  "items": [
    {
      "threadId": "019d....",
      "projectName": "codex-session-manager",
      "updatedAt": "2026-04-04T14:20:00Z",
      "officialName": "旧名字",
      "candidateName": "0404-1420 feat: 新名字",
      "dirty": true,
      "frozen": false,
      "manualOverride": false,
      "taskCompleteCount": 3,
      "provider": "OpenAI",
      "model": "gpt-5.4",
      "statusEstimate": "finalize_ready"
    }
  ],
  "total": 281,
  "counts": {
    "dirty": 124,
    "frozen": 7,
    "manualOverride": 18
  },
  "nextCursor": null
}
```

### `GET /api/v1/sessions/:id`

返回：

- `SessionDetail`
- `renameHistory`
- `revisionMeta`
- `autoRenamePreview`

```json
{
  "threadId": "019d....",
  "rolloutPath": "/home/.../rollout-....jsonl",
  "cwd": "/home/fanghaotian/src/codex-session-manager",
  "projectName": "codex-session-manager",
  "createdAt": "2026-04-04T14:00:00Z",
  "updatedAt": "2026-04-04T14:20:00Z",
  "officialName": "旧名字",
  "candidateName": "0404-1420 feat: 新名字",
  "dirty": true,
  "frozen": false,
  "manualOverride": false,
  "taskCompleteCount": 3,
  "provider": "OpenAI",
  "model": "gpt-5.4",
  "firstUserMessage": "实现 session rename",
  "lastUserMessage": "顺便加 history 和 freeze 命令",
  "lastAgentMessage": "已经补完 manager 和 CLI 命令",
  "tokenTotal": 21984,
  "revision": "sha256:...",
  "lastAppliedAt": "2026-04-03T23:00:00Z",
  "lastAppliedRevision": "sha256:...",
  "renameHistory": [
    {
      "kind": "manual",
      "oldName": "旧名字",
      "newName": "我手动改的名字",
      "source": "manual",
      "status": "applied",
      "appliedAt": "2026-04-04T14:10:00Z",
      "operator": "cli"
    }
  ]
}
```

### `GET /api/v1/sessions/:id/history`

只返回 rename history，供轻量视图和 TUI 调用。

### `POST /api/v1/sessions/:id/suggest`

请求：

```json
{
  "mode": "heuristic"
}
```

说明：

- `mode` 可选；默认跟随后端当前配置
- 返回 suggestion，但不写 `session_index.jsonl`

### `POST /api/v1/sessions/:id/apply`

说明：

- 使用当前 candidate，若没有则先生成 suggestion
- 正式写回 `session_index.jsonl`
- 写入 history

### `POST /api/v1/sessions/:id/rename`

请求：

```json
{
  "name": "手动名字"
}
```

说明：

- 立即 apply
- 标记 `manual_override = true`

### `POST /api/v1/sessions/:id/freeze`

说明：

- 设置 `frozen = true`
- 不改变 official name

### `POST /api/v1/sessions/:id/unfreeze`

说明：

- 设置 `frozen = false`

### `POST /api/v1/sessions/:id/manual-override`

说明：

- 手工标记该 session 进入 manual control
- 适合用户不想被 auto-rename 打扰，但又不改 official name 的场景

### `POST /api/v1/sessions/:id/clear-manual-override`

说明：

- 清除人工覆盖标记

### `POST /api/v1/sessions/batch/suggest`

请求：

```json
{
  "filter": {
    "dirty": true,
    "frozen": false,
    "manualOverride": false
  }
}
```

返回：

- `previewItems`
- `skippedItems`

### `POST /api/v1/sessions/batch/apply`

请求：

```json
{
  "filter": {
    "dirty": true
  },
  "previewOnly": true
}
```

说明：

- `previewOnly=true` 时不写回
- `previewOnly=false` 时正式 apply

### `GET /api/v1/providers`

返回：

- 当前 `EffectiveConfig.ai`
- provider profile 列表
- inherited Codex provider 列表
- 当前可解析出的 default provider

### `GET /api/v1/config`

返回：

- 完整当前生效配置
- 区分 `userConfig` / `projectOverride` / `effectiveConfig`

### `PUT /api/v1/config`

说明：

- 写回 `~/.config/codex-session-manager/config.toml`
- 不写回 Codex 自身配置

### `GET /api/v1/maintenance/stats`

返回：

- `session_index` 大小、行数、唯一 thread 数、重复数
- `app.db` 大小
- 最近 compact 记录
- 最近 24h rename 统计

### `POST /api/v1/maintenance/compact-index`

请求：

```json
{
  "dryRun": true,
  "force": false
}
```

说明：

- 默认 `dryRun=true`
- WebUI 应要求二次确认

### `GET /api/v1/doctor`

返回：

- 当前 doctor 结果
- 可直接复用 CLI `doctor`

## WebUI 信息架构

### 顶层布局

建议用三段式：

- 左侧导航
- 中央主内容区
- 右侧上下文侧栏

左侧导航一级项：

- `Sessions`
- `Batch`
- `Rules`
- `Providers`
- `Maintenance`
- `Activity`

### 1. Sessions 页面

目标：

- 浏览会话
- 快速定位 dirty / frozen / manual override
- 执行单条操作

表格列建议：

- 选择框
- `Official Name`
- `Candidate`
- `State`
- `Project`
- `Updated`
- `Provider / Model`
- `Messages`
- `Actions`

`State` 用组合 badge 表示：

- `dirty`
- `frozen`
- `manual`
- `candidate_ready`
- `finalize_ready`

顶部工具栏：

- 搜索框
- 筛选：dirty / frozen / manual / provider / project / status
- 排序：更新时间 / 项目 / 名字
- 批量按钮：Preview / Apply / Freeze / Unfreeze

右侧上下文侧栏：

- session 摘要
- first/last message 片段
- official vs candidate diff
- 最近 5 条 rename history

### 2. Session Detail 页面

目标：

- 深入查看单条 session 的 rename 生命周期
- 给单条会话做精细控制

区块：

- `Overview`
  - official name
  - candidate name
  - dirty/frozen/manual badge
- `Source Signals`
  - first user
  - last user
  - last agent
  - task_complete_count
  - token_total
- `Revision`
  - current revision
  - last applied revision
  - changed since rename 的解释
- `History`
  - rename history 时间线
- `Actions`
  - Suggest
  - Apply
  - Manual Rename
  - Freeze / Unfreeze
  - Mark Manual Override / Clear Manual Override

### 3. Batch 页面

目标：

- 处理“rename 所有上次 rename 后又变化的会话”

子视图：

- `Dirty Queue`
- `Preview Result`
- `Apply Result`

核心交互：

1. 选过滤器
2. 点 `Preview`
3. 用户勾选 / 取消个别项
4. 点 `Apply`

表格列：

- 选择框
- threadId 短 ID
- old name
- new candidate
- reason / skip reason

### 4. Rules 页面

目标：

- 编辑命名模板
- 预览规则对真实 session 的效果

区域：

- `Preset`
- `Template Editor`
- `Variable Reference`
- `Recent Preview`

`Recent Preview` 建议显示最近 20 个 session 的：

- official name
- candidate under current rule
- delta

### 5. Providers 页面

目标：

- 管理 AI 命名 backend
- 管理 provider profiles

区域：

- `Backend Switcher`
  - none
  - codex
  - openai-compatible
- `Profile List`
- `Inherited Codex Providers`
- `Test Connection`

关键体验：

- 若选 `codex` backend，应明确显示“优先复用 Codex 的 provider/model/auth 直连 API，必要时才回退 `codex exec`”
- 若选 `openai-compatible`，应显示 `base_url / model / apiKeyRef / wire_api`
- 要能看到“当前 profile 是 explicit 还是 inherit-codex”

### 6. Maintenance 页面

目标：

- 管理 `session_index` 和本地 DB

区域：

- `Index Stats`
- `Compact Preview`
- `Backups`
- `Database`
- `Diagnostics`

按钮：

- `Compact Dry Run`
- `Compact Now`
- `VACUUM DB`
- `Export Diagnostics`

### 7. Activity 页面

目标：

- 看 daemon 的行为
- 了解最近自动候选、跳过原因、失败原因

内容：

- 最近 scan/sweep 时间
- 最近 50 条 rename event
- top skip reasons
- provider errors

## TUI 设计

TUI 不追求配置编辑全能，但要足够高效。

### 页面组织

- 主列表页
- 详情页
- Batch Preview 弹层
- Maintenance 面板

### 主列表页布局

- 左侧 70%：session 列表
- 右侧 30%：当前 session 摘要 + 历史

### 快捷键

- `j/k`：移动
- `space`：选择
- `enter`：详情
- `s`：suggest
- `a`：apply
- `r`：manual rename
- `f`：freeze / unfreeze
- `m`：toggle manual override
- `h`：show history
- `d`：只看 dirty
- `p`：batch preview dirty
- `A`：batch apply selected
- `/`：搜索
- `g/G`：头/尾

### TUI 视图重点

相较 WebUI，TUI 应强调：

- 快速筛选
- 快速批量 apply
- 轻量 history 查看
- 不做复杂表单编辑器

## WebUI 与 TUI 的状态共享

统一从本地 API 获取：

- `SessionSummary[]`
- `SessionDetail`
- `RenameHistoryRecord[]`
- `DoctorReport`
- `CompactIndexResult`

不允许：

- TUI 直接写 `session_index.jsonl`
- WebUI 直接改 SQLite
- 前端各自重复实现 rename 判定逻辑

## 前端缓存策略

建议：

- Session list：短缓存，`5-10s`
- Session detail：按 threadId 缓存，切换时失效
- Provider / config：手动刷新或写后失效
- Maintenance stats：`30s`

如果后续要做实时更新，可先加：

- `GET /api/v1/events/since?cursor=...`

而不是第一版就上 WebSocket。

## 安全与边界

- 监听 `127.0.0.1`，默认不暴露到局域网
- 页面上不显示 API key 明文
- 所有写操作都走 POST/PUT，不做 GET side effects
- `compact-index` 必须明确提示风险
- `manual override` 与 `freeze` 是高优先级保护状态，UI 要避免误触

## 错误体验

### Provider 失败

展示：

- 后端名称
- 失败原因摘要
- 是否已回退 heuristic

### Apply 失败

展示：

- 失败 thread
- 失败原因
- 是否已写入 history 失败记录

### Compact 失败

展示：

- 原文件未变
- 临时文件路径
- 备份状态

## 后续实现顺序

建议实现顺序：

1. Local API
2. 最小 WebUI：Sessions + Session Detail + Batch
3. Rules / Providers 页面
4. Maintenance 页面
5. TUI

原因：

- WebUI 先落地最容易暴露 API 契约问题
- TUI 放后面更适合在 API 稳定后复用

## 结论

本项目前端与本地接口层的取舍应是：

- 用 `TokenArena` 的分层纪律
- 用 `CLI History Hub` 的本地浏览器产品形态和 session 浏览经验
- 用 `Codex Mate` 的本地 API + Web 标签页组织方式

但最终状态管理和 rename 行为仍然坚持本项目自己的约束：

- 原始 rollout 不改
- official writeback 只写 `session_index.jsonl`
- SQLite 是本项目状态真源
- UI 只是状态与操作的表现层
