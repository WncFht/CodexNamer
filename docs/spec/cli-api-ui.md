# CLI / API / UI 设计

> 状态说明：这份文档保留了较早期的语义草案，其中部分命令名、页面拆分和批量操作已经被当前实现调整。阅读时请优先结合 [仓库总览](./repo-overview.md)、[WebUI / TUI / Local API 详细设计](./web-tui-local-api-design.md) 和实际代码。

## 目标

- 所有操作先定义语义，再决定界面表现
- CLI、WebUI、TUI 复用同一套后端 API
- 先把批量管理设计清楚，再开始实现界面

## 本地 API

推荐提供本地 HTTP API，默认只监听 `127.0.0.1` 或 Unix socket。

### 核心资源

- `/sessions`
- `/sessions/:id`
- `/sessions/:id/suggest`
- `/sessions/:id/apply`
- `/sessions/:id/rename`
- `/sessions/:id/freeze`
- `/sessions/:id/unfreeze`
- `/sessions/batch/suggest`
- `/sessions/batch/apply`
- `/config`
- `/providers`
- `/maintenance`

## API 语义

### `GET /sessions`

支持过滤：

- `dirty=true|false`
- `frozen=true|false`
- `manualOverride=true|false`
- `cwd=...`
- `provider=...`
- `updatedAfter=...`
- `search=...`

返回：

- session 摘要列表
- 计数统计

### `GET /sessions/:id`

返回：

- session 详情
- 候选名
- rename 历史
- revision 信息

### `POST /sessions/:id/suggest`

请求：

- `mode = heuristic|ai|hybrid`
- `force = true|false`

返回：

- 候选名
- 来源
- 摘要字段

### `POST /sessions/:id/apply`

语义：

- 把当前候选名写入 `session_index.jsonl`
- 更新本地 `rename_state`
- 写历史

### `POST /sessions/:id/rename`

语义：

- 用户手工传入最终名字
- 直接 apply
- 标记 `manual_override = true`

### `POST /sessions/batch/suggest`

输入：

- `filter`
- `ids`
- `mode`

语义：

- 生成批量候选名，但不落盘

### `POST /sessions/batch/apply`

输入：

- `ids`
- `source = candidate|manualMap`

语义：

- 批量 apply
- 可跳过 frozen / manual override / unchanged

### `POST /maintenance/compact-index`

语义：

- 离线 compact `session_index.jsonl`
- 产生备份
- 回写 compact 历史

## CLI 设计

### daemon

```bash
codex-session-daemon --once
```

### 查询

```bash
codex-session list
codex-session list --dirty
codex-session show --id <thread-id>
```

### 单个 rename

```bash
codex-session suggest --id <thread-id>
codex-session apply --id <thread-id>
codex-session rename --id <thread-id> --name "..."
codex-session freeze --id <thread-id>
codex-session unfreeze --id <thread-id>
```

### 批量 rename

```bash
codex-session batch apply --dirty
codex-session batch apply --dirty --preview
```

说明：

- CLI 里单独的 `batch suggest` 当前没有独立命令入口。
- `batch apply` 当前只支持 dirty 批处理，不支持显式 `--ids` 列表。

### 维护

```bash
codex-session compact-index
codex-session doctor
codex-session config print
codex-session provider test
```

### 界面

当前开发入口是：

```bash
npm run web
npm run tui
```

## WebUI 信息架构

### 页面 1: Sessions

表格列：

- 选择框
- 当前官方 name
- 候选 name
- dirty
- frozen
- manual override
- project
- provider
- updated_at
- task_complete_count

动作：

- 批量 suggest
- 批量 apply
- 批量 freeze
- 批量取消 freeze
- 只看 dirty

### 页面 2: Session Detail

展示：

- 元数据
- 首条用户消息
- 最新用户消息
- 最新 agent 摘要
- revision
- rename 历史
- 当前规则渲染结果

动作：

- 手工 rename
- AI rename
- apply candidate
- freeze / unfreeze

### 页面 3: Batch Rename

展示：

- 当前 dirty sessions
- 每条的旧名字与新候选名对比
- 可勾选跳过个别项

### 页面 4: Rules

展示：

- preset 选择
- 模板编辑
- 长度限制
- 变量预览
- 最近 sessions 的实时预览

### 页面 5: Providers

展示：

- 当前 AI backend
- provider profiles
- 继承 Codex 配置结果
- 连接测试

### 页面 6: Maintenance

展示：

- `session_index.jsonl` 大小与行数
- 唯一 thread 数
- 重复记录数
- compact 建议
- 备份列表
- 最近 maintenance 记录

## TUI 设计

### 主界面

- 左侧：session 列表
- 右侧：详情预览
- 底部：快捷键和过滤状态

### 快捷键

- `j/k`: 移动
- `space`: 选择
- `d`: 切换 dirty 过滤
- `f`: freeze/unfreeze
- `r`: 手工 rename
- `s`: suggest
- `a`: apply
- `A`: batch apply
- `/`: 搜索
- `p`: 预览模板
- `c`: compact-index

## 统一原则

- 所有 rename 操作都先经过同一套后端校验
- WebUI/TUI 不允许自己绕过状态机直接写 index
- CLI 若绕过 daemon 直写，也必须调用同一 writer 模块
