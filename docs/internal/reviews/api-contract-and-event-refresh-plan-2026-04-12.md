# API 契约与事件刷新收口计划

日期：`2026-04-12`

状态：`completed`

## 实施结果

本轮计划已经全部落地，完成情况如下：

### 已完成 1：共享 API 输入 schema

已在 `packages/shared/src/types.ts` 与 `packages/shared/src/schemas.ts` 补齐本轮需要的 query/body 类型与 schema，覆盖：

- sessions list / detail / transcript
- rename body / batch apply body
- prompt preview body
- AI request logs query
- config update body
- rename replay body
- daemon start body

Local API 路由现在已开始复用这些 shared schema：

- `packages/api/src/routes/sessions.ts`
- `packages/api/src/routes/ai.ts`
- `packages/api/src/routes/providers-config.ts`
- `packages/api/src/routes/maintenance.ts`
- `packages/api/src/routes/daemon.ts`

### 已完成 2：core 收回 sessions 查询编排

已把 sessions 过滤 / 排序 / limit / total 语义收回到 core：

- 新入口：`CodexNamer.querySessions()`
- 核心实现：`packages/core/src/manager/session-scan-service.ts`

现在：

- `packages/api/src/routes/sessions.ts` 不再直接访问 `manager.db`
- sessions API 的 `total` 已修正为“过滤后总数”
- `limit` 只裁剪 `items`，不再错误影响 `total`

### 已完成 3：Web 事件刷新收窄

已增加 event → resource 映射，并把 events 刷新从整页刷新改成按事件类型定向刷新：

- 资源规划：`packages/web/src/control-deck-model.ts`
- 资源执行：`packages/web/src/useControlDeckResources.ts`
- coordinator：`packages/web/src/resources/useRefreshCoordinator.ts`

当前行为：

- 收到 API events 后，优先只刷新受影响资源
- sessions tab 下，如果当前选中会话被事件命中，会额外刷新 detail
- stale fallback 和异常 fallback 仍保留整页刷新

### 已完成 4：测试与验证

已更新：

- `test/api.test.ts`
- `test/use-control-deck-state.test.ts`

新增覆盖点包括：

- `/api/v1/sessions?limit=1` 时 `total` 仍为过滤后总数
- 非法 `limit=0` 返回 `400`
- settings / maintenance 场景下的 event-driven resource planning

最终验证：

- `npm run validate:full` ✅

## 本轮目标

这轮不做大规模重写，只做一组可以完整落地的前后端收口：

1. 把 Local API 的关键 query/body 输入收成共享 schema，减少 route 层手写断言。
2. 把 sessions 列表查询正式收回 core，去掉 API route 直接访问 `manager.db` 的边界泄漏。
3. 把 Web 的 events 刷新从“来事件就整页重刷”改成“按事件类型收窄刷新资源”，保留 stale fallback。

## 不在本轮范围内

下面这些问题本轮明确不做，只记录为后续候选：

- cursor pagination
- SQLite FTS / 全文索引
- sessions 列表的前端分页 UI
- Settings / Maintenance / Requeue 的第二轮大拆分
- daemon / event log 的持久化消息总线

## 交付项

### 1. 共享 API 输入 schema

新增或补齐 shared schema / type，覆盖本轮会改到的接口输入：

- `GET /api/v1/sessions`
- `GET /api/v1/sessions/:id`
- `GET /api/v1/sessions/:id/transcript`
- `POST /api/v1/sessions/:id/rename`
- `POST /api/v1/sessions/batch/apply`
- `POST /api/v1/ai/prompt-preview`
- `GET /api/v1/ai/request-logs`
- `PUT /api/v1/config`
- `POST /api/v1/maintenance/requeue-*`
- `POST /api/v1/daemon/start`

完成标准：

- route 不再依赖散落的 `Record<string, unknown>` + 大量手写字段判断
- 关键 query/body 改成 shared schema 驱动
- 非法输入保持现有 `400` 风格

### 2. core 收回 sessions 查询编排

新增 core 侧的 sessions 查询入口，负责：

- dirty / frozen / status / project / provider / workspace / search 过滤
- sort / order / limit
- `total` 语义修正为“过滤后总数”，不是“limit 后条数”
- `workspaces` 与 `counts` 继续按当前 API 语义返回

完成标准：

- `packages/api/src/routes/sessions.ts` 不再直接访问 `manager.db`
- 原先 API 层的 sessions 过滤逻辑移到 core
- 现有 Web / TUI 调用不需要改交互语义

### 3. Web 事件刷新收窄

把 Web 的 events 响应处理改成按事件类型决定刷新资源，而不是有事件就直接 `refreshCurrentView()`。

本轮目标：

- 为 `scan.completed`
- `session.suggested`
- `session.applied`
- `session.renamed`
- `session.freeze.changed`
- `batch.apply.completed`
- `config.updated`
- `maintenance.rename_requeued`
- `maintenance.compact.completed`

建立事件到资源的映射。

完成标准：

- `useRefreshCoordinator` 收到 event 后走“定向刷新”
- `staleRefresh` 与异常 fallback 仍保留整页刷新
- sessions tab 里如果当前选中会话被事件命中，detail 也会刷新

### 4. 验证与文档回填

需要一起完成：

- 更新 `test/api.test.ts`
- 更新 `test/use-control-deck-state.test.ts`
- 必要时补充 core 相关回归测试
- 跑通 `npm run validate:full`
- 把本文件状态改成 `completed`，并补上实际落地结果

## 实施顺序

1. 先补 shared query/body schema
2. 再把 sessions 查询收回 core
3. 再改 API route 使用新 schema 和新 core 入口
4. 最后改 Web event-driven refresh，并补测试

## 验收口径

本轮完成后，至少满足：

- `/api/v1/sessions?limit=1` 的 `total` 仍表示过滤后的总数
- sessions route 不再出现 `manager.db.getSessionDetail(...)`
- route query/body 解析主要由 shared schema 驱动
- Web 收到 event 时不会无条件整页刷新当前 tab 的所有资源
- `npm run validate:full` 通过
