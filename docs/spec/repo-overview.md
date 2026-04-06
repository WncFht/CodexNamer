# 仓库总览

更新时间：`2026-04-08`

这份文档以当前代码为准，目标是回答四个问题：

1. 这个仓库里有哪些 package，各自负责什么。
2. 项目如何从 Codex rollout 读数据、在本地建状态、再写回官方 rename 层。
3. 当前 CLI、API、daemon、WebUI、TUI 到底做到什么程度。
4. 测试、维护、运行入口分别在哪里。

## 1. 仓库定位

`codex-session-manager` 是一个独立于 `openai/codex` 的本地 session 管理器。

它不接管 Codex 启动，也不修改 Codex 源码，而是：

- 读取 `~/.codex/sessions/**/rollout-*.jsonl`
- 维护自己的 SQLite 状态库
- 通过向 `~/.codex/session_index.jsonl` 追加 rename 记录写回最终名称
- 暴露统一的 CLI、Local API、daemon、WebUI、TUI 操作入口

## 2. Monorepo 结构

顶层目录：

- `packages/core`：核心领域模型与业务逻辑。
- `packages/shared`：共享类型、schema、常量与 UI 相关共享定义。
- `packages/api`：本地 Fastify HTTP API。
- `packages/cli`：命令行入口。
- `packages/daemon`：基于文件监听与定时 sweep 的后台进程。
- `packages/web`：React + Vite 的 Web 控制台。
- `packages/tui`：Ink + React 的终端界面。
- `test`：Vitest 测试。
- `scripts`：辅助启动脚本，目前主要是 UI 启动入口。
- `docs`：规格、设计、ADR、审查记录。

## 3. 各 package 职责

### `packages/core`

核心入口是 [manager.ts](/home/fanghaotian/Desktop/src/ai-tools/codex-session-manager/packages/core/src/manager.ts)。

它负责：

- 扫描 rollout 文件并做增量 ingest
- 维护 SQLite 状态与 cursor
- 读取、追加、compact `session_index.jsonl`
- 生成 rename candidate
- 处理手动 rename、freeze、manual override
- 执行批量 rename、auto-rename sweep、rename replay
- 生成 overview、doctor、provider diagnostics、prompt preview

配套模块：

- [config.ts](/home/fanghaotian/Desktop/src/ai-tools/codex-session-manager/packages/core/src/config.ts)：配置加载、继承、写回。
- [database.ts](/home/fanghaotian/Desktop/src/ai-tools/codex-session-manager/packages/core/src/database.ts)：SQLite 持久层。
- [rollout.ts](/home/fanghaotian/Desktop/src/ai-tools/codex-session-manager/packages/core/src/rollout.ts)：rollout 解析、transcript 提取、分页读取。
- [session-index.ts](/home/fanghaotian/Desktop/src/ai-tools/codex-session-manager/packages/core/src/session-index.ts)：官方 rename 层读写与 compact。
- [auto-rename.ts](/home/fanghaotian/Desktop/src/ai-tools/codex-session-manager/packages/core/src/auto-rename.ts)：状态估计与 auto-rename 评估。
- [rename-context.ts](/home/fanghaotian/Desktop/src/ai-tools/codex-session-manager/packages/core/src/rename-context.ts)：命名上下文构建。
- [provider.ts](/home/fanghaotian/Desktop/src/ai-tools/codex-session-manager/packages/core/src/provider.ts)：AI provider 解析、请求与 prompt 构造。
- [naming.ts](/home/fanghaotian/Desktop/src/ai-tools/codex-session-manager/packages/core/src/naming.ts)：标题结构化拼装与样式处理。

### `packages/shared`

定义全仓统一 DTO 与配置类型，减少 API、core、web、tui 之间的重复结构。

核心文件：

- [types.ts](/home/fanghaotian/Desktop/src/ai-tools/codex-session-manager/packages/shared/src/types.ts)
- [schemas.ts](/home/fanghaotian/Desktop/src/ai-tools/codex-session-manager/packages/shared/src/schemas.ts)
- [constants.ts](/home/fanghaotian/Desktop/src/ai-tools/codex-session-manager/packages/shared/src/constants.ts)

### `packages/api`

本地 API 由 [app.ts](/home/fanghaotian/Desktop/src/ai-tools/codex-session-manager/packages/api/src/app.ts) 构建，使用 Fastify。

当前主要资源：

- `/api/v1/health`
- `/api/v1/sessions`
- `/api/v1/sessions/:id`
- `/api/v1/sessions/:id/transcript`
- `/api/v1/sessions/:id/history`
- `/api/v1/sessions/:id/suggest`
- `/api/v1/sessions/:id/apply`
- `/api/v1/sessions/:id/rename`
- `/api/v1/sessions/:id/freeze`
- `/api/v1/sessions/:id/unfreeze`
- `/api/v1/sessions/:id/manual-override`
- `/api/v1/sessions/:id/clear-manual-override`
- `/api/v1/sessions/:id/naming-style`
- `/api/v1/sessions/batch/suggest`
- `/api/v1/sessions/batch/apply`
- `/api/v1/workspaces`
- `/api/v1/overview`
- `/api/v1/auto-rename/preview`
- `/api/v1/ai/prompt-preview`
- `/api/v1/ai/request-logs`
- `/api/v1/providers`
- `/api/v1/providers/test`
- `/api/v1/config`
- `/api/v1/doctor`
- `/api/v1/maintenance/stats`
- `/api/v1/maintenance/compact-index`
- `/api/v1/maintenance/requeue-renames`
- `/api/v1/events/since`

### `packages/cli`

命令行入口是 [index.ts](/home/fanghaotian/Desktop/src/ai-tools/codex-session-manager/packages/cli/src/index.ts)。

当前命令：

- `codex-session list`
- `codex-session show --id <thread-id>`
- `codex-session suggest --id <thread-id>`
- `codex-session apply --id <thread-id>`
- `codex-session rename --id <thread-id> --name "..."`
- `codex-session history --id <thread-id>`
- `codex-session freeze --id <thread-id>`
- `codex-session unfreeze --id <thread-id>`
- `codex-session manual-override --id <thread-id>`
- `codex-session clear-manual-override --id <thread-id>`
- `codex-session batch apply --dirty`
- `codex-session compact-index --dry-run`
- `codex-session doctor`
- `codex-session config print`
- `codex-session provider test`

注意：

- CLI 里的 `batch suggest` 还没有单独命令。
- `batch apply` 当前只支持 `--dirty`。

### `packages/daemon`

后台入口是 [index.ts](/home/fanghaotian/Desktop/src/ai-tools/codex-session-manager/packages/daemon/src/index.ts)。

行为：

- 启动时先跑一次 sweep
- 监听 `sessions/**/*.jsonl` 与 `session_index.jsonl`
- 有新增/变更时延迟触发 sweep
- 按固定间隔再次 sweep
- 根据 `rename.autoApply` 决定是 preview-only 还是真正 auto-apply

### `packages/web`

WebUI 是当前最完整的图形入口。

主要文件：

- [App.tsx](/home/fanghaotian/Desktop/src/ai-tools/codex-session-manager/packages/web/src/App.tsx)
- [SessionBrowser.tsx](/home/fanghaotian/Desktop/src/ai-tools/codex-session-manager/packages/web/src/SessionBrowser.tsx)
- [SettingsPanel.tsx](/home/fanghaotian/Desktop/src/ai-tools/codex-session-manager/packages/web/src/SettingsPanel.tsx)
- [RenameOpsPanel.tsx](/home/fanghaotian/Desktop/src/ai-tools/codex-session-manager/packages/web/src/RenameOpsPanel.tsx)
- [useControlDeckState.ts](/home/fanghaotian/Desktop/src/ai-tools/codex-session-manager/packages/web/src/useControlDeckState.ts)

当前覆盖：

- workspace 维度浏览 session
- session 列表与详情
- transcript 查看、分页与过滤
- suggest / apply / manual rename / freeze / manual override
- 批量 preview / apply dirty sessions
- 配置编辑与写回
- provider diagnostics
- prompt preview
- auto-rename preview
- doctor / compact / rename replay
- AI request logs
- overview 与运行态面板

### `packages/tui`

TUI 已经可用，不再只是规划项。

主要文件：

- [App.tsx](/home/fanghaotian/Desktop/src/ai-tools/codex-session-manager/packages/tui/src/App.tsx)
- [api.ts](/home/fanghaotian/Desktop/src/ai-tools/codex-session-manager/packages/tui/src/api.ts)
- [settings-model.ts](/home/fanghaotian/Desktop/src/ai-tools/codex-session-manager/packages/tui/src/settings-model.ts)
- [layout.ts](/home/fanghaotian/Desktop/src/ai-tools/codex-session-manager/packages/tui/src/layout.ts)

当前覆盖：

- browser / settings 双主界面
- session 列表、详情、transcript
- 搜索
- suggest / apply / freeze / manual override
- 批量 dirty apply
- prompt preview
- 配置编辑

## 4. 当前核心数据流

### 4.1 读路径

1. 扫描 `~/.codex/sessions/**/rollout-*.jsonl`
2. 增量 ingest rollout，提取 thread 基本事实、provider、cwd、消息摘要、token、task_complete
3. 计算 revision
4. 写入本地 SQLite
5. 读取 `~/.codex/session_index.jsonl`，刷新官方名称映射
6. 结合 rename state 计算 dirty / frozen / manual override / status estimate

### 4.2 命名路径

1. 为 session 构建 rename context
2. 根据配置选择 heuristic / AI / fallback
3. 生成结构化 rename candidate
4. 先做重名规避
5. 仅在 apply 时向 `session_index.jsonl` 追加一行
6. 同步写 rename history、rename_state、overview 所需统计

### 4.3 自动化路径

1. daemon 或 API 请求触发 `runAutoRenameSweep`
2. 对 dirty sessions 逐个运行 `evaluateAutoRename`
3. 输出 `skip / suggest / apply`
4. 若运行态允许且命中 `apply`，执行真正写回
5. 记录 daemon runtime 心跳、sweep summary、auto-apply 结果

## 5. 当前功能矩阵

| 能力 | 当前状态 | 主要入口 |
|---|---|---|
| rollout 扫描与增量 ingest | 已实现 | core |
| SQLite 状态库 | 已实现 | core |
| `session_index.jsonl` 追加写回 | 已实现 | core |
| `session_index.jsonl` compact | 已实现 | core / CLI / API / Web |
| 单个 suggest / apply / manual rename | 已实现 | CLI / API / Web / TUI |
| freeze / manual override | 已实现 | CLI / API / Web / TUI |
| naming style 切换 | 已实现 | API / Web |
| dirty 批量 apply | 已实现 | CLI / API / Web / TUI |
| auto-rename preview | 已实现 | core / API / Web |
| idle finalize auto-apply | 已实现 | daemon / core |
| provider test | 已实现 | CLI / API / Web |
| prompt preview | 已实现 | core / API / Web / TUI |
| AI request logs | 已实现 | core / API / Web |
| transcript 分页过滤 | 已实现 | core / API / Web / TUI |
| rename replay / requeue | 已实现 | core / API / Web |

## 6. 配置与状态文件

默认配置路径：

- 用户配置：`~/.config/codex-session-manager/config.toml`
- 项目级覆盖：`.codex-session-manager.toml`

主要状态文件：

- `~/.local/state/codex-session-manager/app.db`
- `~/.local/state/codex-session-manager/backups/`

依赖的 Codex 文件：

- `~/.codex/sessions/**/rollout-*.jsonl`
- `~/.codex/session_index.jsonl`
- `~/.codex/config.toml`
- `~/.codex/auth.json`

## 7. 测试布局

测试位于 `test/`，当前重点覆盖：

- 配置加载与写回
- rollout ingest
- revision / dirty tracking
- rename context
- provider 推理与请求日志
- session index 读写与 compact
- batch apply
- history / freeze / manual override
- auto-rename preview / apply / evaluation
- transcript 解析与分页
- API 路由
- Web/TUI 的局部状态模型与布局

常用命令：

```bash
npm test
```

## 8. 运行入口

开发时常用：

```bash
npm run api -- --host 127.0.0.1 --port 42110
npm run web
npm run tui
npm run daemon -- --once
```

构建：

```bash
npm run build
```

## 9. 阅读代码建议

如果你要理解完整主流程，建议按下面顺序看：

1. [packages/core/src/manager.ts](/home/fanghaotian/Desktop/src/ai-tools/codex-session-manager/packages/core/src/manager.ts)
2. [packages/core/src/database.ts](/home/fanghaotian/Desktop/src/ai-tools/codex-session-manager/packages/core/src/database.ts)
3. [packages/core/src/rollout.ts](/home/fanghaotian/Desktop/src/ai-tools/codex-session-manager/packages/core/src/rollout.ts)
4. [packages/core/src/session-index.ts](/home/fanghaotian/Desktop/src/ai-tools/codex-session-manager/packages/core/src/session-index.ts)
5. [packages/api/src/app.ts](/home/fanghaotian/Desktop/src/ai-tools/codex-session-manager/packages/api/src/app.ts)
6. [packages/web/src/useControlDeckState.ts](/home/fanghaotian/Desktop/src/ai-tools/codex-session-manager/packages/web/src/useControlDeckState.ts)

## 10. 文档使用约定

从现在开始，文档默认遵循：

- `README.md` 负责项目入口与快速上手。
- [docs/README.md](/home/fanghaotian/Desktop/src/ai-tools/codex-session-manager/docs/README.md) 负责整套文档导航。
- 本文件负责“当前代码仓库全景”。
- 设计约束放在 `docs/spec/`。
- 历史规划可以保留，但必须明确标注不是当前实现真相源。
