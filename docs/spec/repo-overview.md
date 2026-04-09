# 仓库总览

更新时间：`2026-04-09`

## 1. 仓库定位

`CodexNamer` 是一个独立于 `openai/codex` 的本地 session 管理器。

它通过读取 rollout、维护本地 SQLite、并向 `session_index.jsonl` 追加 rename 记录来工作，不修改 Codex 源码。

## 2. Monorepo 结构

- `packages/core`
- `packages/shared`
- `packages/api`
- `packages/cli`
- `packages/daemon`
- `packages/web`
- `packages/tui`
- `test`
- `docs`

## 3. 各 package 职责

### `packages/core`

负责：

- 扫描 rollout 并做增量 ingest
- 维护 SQLite 状态与 cursor
- 生成 rename candidate
- 处理 suggest / apply / manual rename / freeze
- 执行 batch dirty apply / auto-rename sweep / requeue
- 生成 overview / doctor / provider diagnostics / prompt preview
- 维护 AI request logs

### `packages/shared`

负责共享类型与 schema：

- config DTO
- session / overview DTO
- request log DTO
- daemon DTO

### `packages/api`

暴露本地 Fastify API。

入口 `packages/api/src/index.ts` 现在会在 API 进程启动后，默认自动拉起一个 controller-managed daemon。

当前主要路由：

- `/api/v1/health`
- `/api/v1/events/since`
- `/api/v1/sessions`
- `/api/v1/sessions/:id`
- `/api/v1/sessions/:id/transcript`
- `/api/v1/sessions/:id/history`
- `/api/v1/sessions/:id/suggest`
- `/api/v1/sessions/:id/apply`
- `/api/v1/sessions/:id/rename`
- `/api/v1/sessions/:id/freeze`
- `/api/v1/sessions/:id/unfreeze`
- `/api/v1/sessions/batch/suggest`
- `/api/v1/sessions/batch/apply`
- `/api/v1/overview`
- `/api/v1/auto-rename/preview`
- `/api/v1/ai/prompt-preview`
- `/api/v1/ai/request-logs`
- `/api/v1/ai/request-logs/:id`
- `/api/v1/providers`
- `/api/v1/providers/test`
- `/api/v1/providers/parse-codex`
- `/api/v1/config`
- `/api/v1/doctor`
- `/api/v1/maintenance/compact-index`
- `/api/v1/maintenance/requeue-renames`
- `/api/v1/daemon`
- `/api/v1/daemon/start`
- `/api/v1/daemon/stop`

当前不存在的旧路由：

- `manual-override`
- `clear-manual-override`
- `naming-style`

### `packages/cli`

当前命令：

- `list`
- `show`
- `suggest`
- `apply`
- `rename`
- `history`
- `freeze`
- `unfreeze`
- `batch apply --dirty`
- `compact-index`
- `doctor`
- `config print`
- `provider test`

### `packages/web`

当前 Web 有五个主视图：

- `Sessions`
- `Settings`
- `状态 / Rename Ops`
- `Requeue`
- `Daemon`

当前覆盖：

- workspace 维度浏览
- session 列表与详情
- transcript 分页 / 搜索 / role 过滤
- suggest / apply / freeze
- rename history
- settings 写回
- provider diagnostics
- prompt preview
- overview 图表
- requeue preview / execute
- AI request logs
- daemon start / stop / next scheduled sweep countdown / log tail

说明：

- Web 当前没有单独的手动 rename 按钮
- 手动 rename 仍可通过 CLI / API / TUI 使用

### `packages/tui`

当前覆盖：

- browser / settings 双主界面
- session 列表、详情、transcript
- 搜索
- suggest / apply / freeze / manual rename
- batch dirty apply
- prompt preview
- settings 编辑

## 4. 当前核心数据流

### 读路径

1. 扫描 `~/.codex/sessions/**/rollout-*.jsonl`
2. 增量 ingest rollout
3. 计算 revision 与 dirty
4. 写入本地 SQLite
5. 读取 `~/.codex/session_index.jsonl`
6. 结合 accepted official name 规则归一化 official name / dirty

### 命名路径

1. 构建 rename context
2. heuristic 或 AI 生成结构化候选
3. 按 builder 组装最终标题
4. 执行重名规避
5. apply 时向 `session_index.jsonl` 追加一行
6. 同步写 rename history / rename_state / AI request logs / overview 所需状态

### 自动化路径

1. API 默认托管一个 daemon 子进程，或用户单独启动 standalone daemon
2. daemon 触发 `runAutoRenameSweep()`
3. 先重新 `scan()`，再筛出当前 dirty sessions
4. 对 dirty sessions 运行 `evaluateAutoRename()`
5. 输出 `skip / suggest / apply`
6. 若运行态允许且命中 `apply`，执行真正写回
7. 写 `daemon_runtime` 与 recent sweep summary

### 队列语义

当前没有独立持久化任务队列表。

真正承担“待处理队列”语义的是 dirty session 集合：

- `dirty_since_rename = 1`
- 或 `force_rewrite = 1`

requeue 的本质也是把一批 session 重新打成 dirty，并清掉旧 candidate。

## 5. 当前功能矩阵

| 能力 | 当前状态 | 主要入口 |
|---|---|---|
| rollout 扫描与增量 ingest | 已实现 | core |
| SQLite 状态库 | 已实现 | core |
| `session_index.jsonl` 追加写回 | 已实现 | core |
| `session_index.jsonl` compact | 已实现 | core / CLI / API / Web |
| 单个 suggest / apply / manual rename | 已实现 | CLI / API / TUI |
| Web 会话级 suggest / apply / freeze | 已实现 | Web |
| freeze / unfreeze | 已实现 | CLI / API / Web / TUI |
| dirty 批量 apply | 已实现 | CLI / API / Web / TUI |
| auto-rename preview | 已实现 | core / API / Web / TUI |
| idle finalize auto-apply | 已实现 | daemon / core |
| prompt preview | 已实现 | core / API / Web / TUI |
| AI request logs | 已实现 | core / API / Web |
| request logs 后端分页 | 已实现 | core / API / Web |
| transcript 分页过滤 | 已实现 | core / API / Web / TUI |
| 按规则签名重新归队 | 已实现 | core / API / Web |
| API 默认自动拉起 daemon | 已实现 | API |
| daemon 控制面板与倒计时 | 已实现 | API / Web |

## 6. 当前行为约束

- 保护态只保留 `freeze`
- `brief / detailed` 已不再是当前配置行为
- accepted official rename source 只认 `ai` 和 `manual`
- overview 的 rename 统计按会话去重
- 请求日志状态页每页显示 10 条，但 API 缺省页大小仍是 40
- 请求日志成功时会显式展示输出命名
