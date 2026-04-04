# 触发与生命周期

## 问题定义

自动 rename 不能太频繁，也不能长期不触发。

在不使用 wrapper、不依赖常驻 app-server 连接的前提下，外置项目默认只能可靠观察：

- rollout 文件内容变化
- `session_index.jsonl` 变化
- 可选的 TUI session log

因此默认策略必须建立在“内容更新 + idle finalize”之上，而不是假定自己一定能捕获每次 `/clear` 和 `/exit`。

## 触发源

### 默认触发源

- rollout 文件 size 增长
- rollout 文件 mtime 变化
- 新增 `task_complete`
- `last_agent_message` 变化
- `session_index.jsonl` 被外部更新
- 定时 sweep

### 可选增强触发源

用户启用 `CODEX_TUI_RECORD_SESSION=1` 时，可从 session log 获得：

- `clear_ui`
- `new_session`
- `session_end`

增强用途：

- 提前 finalize
- 更准确地推断 clear / exit 边界

## 实质更新定义

满足任一项即判定为 material change：

- `task_complete_count` 增加至少 1
- `last_agent_message` 指纹变化
- rollout 文件新增字节超过 `min_rollout_growth_bytes`
- `last_user_message` 变化且长度超过最小阈值

不构成 material change 的情况：

- 只出现零散 streaming delta，但没有新的完成结果
- 只是官方 name 被别人改了
- 只有文件 touch，没有内容增量

## 生命周期状态

### `discovered`

- 首次发现 rollout
- 还没有足够内容生成有意义名字

### `active`

- 最近仍有 rollout 增长
- 或最近 `candidate_idle_seconds` 内发生过 material change

### `candidate_ready`

- 最近发生过 material change
- 且已空闲超过 `candidate_idle_seconds`
- 可以生成候选 name

### `finalize_ready`

- dirty
- 已空闲超过 `finalize_idle_seconds`
- 不在 rename cooldown 中
- 未 frozen
- 未 manual override

### `applied`

- 当前 revision 已经对应一个正式应用的 name

### `frozen`

- 用户明确不允许自动覆盖

## 默认参数

建议 v1 默认值：

- `scan_interval_seconds = 300`
- `candidate_idle_seconds = 120`
- `finalize_idle_seconds = 600`
- `rename_cooldown_seconds = 900`
- `min_rollout_growth_bytes = 4096`
- `min_task_complete_delta = 1`
- `max_auto_renames_per_session = 2`

## 自动 rename 状态机

```text
rollout update
    |
    v
material change? -- no --> keep current state
    |
   yes
    |
    v
mark dirty
    |
    v
idle >= candidate_idle ? -- no --> active
    |
   yes
    |
    v
generate candidate
    |
    v
idle >= finalize_idle ? -- no --> candidate_ready
    |
   yes
    |
    v
manual_override/frozen/cooldown/max_apply hit?
    |                     |
   yes                    no
    |                     |
    v                     v
  skip                 apply rename
                          |
                          v
                     write session_index
```

## apply 规则

只有满足全部条件才正式 apply：

- `dirty_since_rename = true`
- 候选 name 非空
- 候选 name 与当前官方 name 不同
- 不处于 cooldown
- `auto_apply_count < max_auto_renames_per_session`
- 非 frozen
- 非 manual override

## manual override 规则

判定逻辑：

- 读取 `session_index.jsonl` 最新官方 name
- 如果最新官方 name 不等于 `last_applied_name`
- 且也不等于我们当前候选 name
- 则标记为 `manual_override = true`

默认行为：

- 停止自动 apply
- 仍允许继续生成建议

## freeze 规则

用户手动 freeze 后：

- 不再自动 apply
- 仍可手动 suggest
- 仍可手动 apply

## clear / exit 处理

### 默认模式

默认不把 clear / exit 当成唯一信号，而是用 idle finalize 吸收。

理由：

- 外置工具默认无法稳定知道当前 TUI 是否刚执行 `/clear` 或 `/exit`
- 但 idle finalize 已足够覆盖最终命名需求

### 增强模式

若发现 session log：

- `clear_ui` -> 立即把旧活跃 session 提升为 `finalize_ready`
- `session_end` -> 尝试立即 finalize 当前候选

## sweep 机制

daemon 每 `scan_interval_seconds` 运行一次 sweep：

- 补偿遗漏的 fs event
- 更新 dirty 状态
- 推进 candidate / finalize 状态
- 检查 compact 建议

## 批量 rename dirty sessions

语义定义：

- dirty session = `current_revision != last_applied_revision`

批量命令的执行逻辑：

1. 选出 dirty sessions
2. 排除 frozen / manual override
3. 生成候选
4. 展示预览
5. 用户确认后 apply

这样可以稳定实现“rename 所有上次 rename 以后更改的”。
