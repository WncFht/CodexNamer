# 触发与生命周期

更新时间：`2026-04-09`

## 问题定义

自动 rename 既不能太频繁，也不能长期没有结果。

当前实现建立在：

- rollout 文件内容变化
- `session_index.jsonl` 同步
- 周期性 sweep

而不是依赖 wrapper 或对 `/clear`、`/exit` 的强感知。

## 当前运行模型

当前系统不是维护一张独立任务队列表，而是：

1. 先持续维护每个 session 的本地状态
2. 用 dirty session 集合作为“软队列”
3. 让 sweep 每一轮重新计算这些会话应当 `skip / suggest / apply`

当前 dirty 语义来自：

- `rename_state.dirty_since_rename`
- `rename_state.force_rewrite`

只要任一为真，这个 session 就会被视为 dirty。

## 生命周期状态

### `discovered`

- 首次发现 rollout
- 还没有足够内容生成有意义名字

### `active`

- 距最近更新时间还没到 `candidate_idle_seconds`

### `candidate_ready`

- 仍然 dirty
- 已空闲超过 `candidate_idle_seconds`
- 可生成 candidate

### `finalize_ready`

- 仍然 dirty
- 已空闲超过 `finalize_idle_seconds`
- 已到可正式 apply 的阶段

### `applied`

- 当前 revision 与最近一次正式应用的 revision 对齐

### `frozen`

- 用户明确不允许自动流程继续处理这个会话

## daemon 与 sweep

daemon 的职责只是持续触发 sweep：

1. 启动时立即跑一轮
2. rollout / `session_index.jsonl` 文件变化后，1 秒 debounce 再跑一轮
3. 按 `scan_interval_seconds` 周期性再跑一轮

现在 `npm run api` 启动 Local API 时，会默认自动拉起一个 controller-managed daemon。

## 当前评估顺序

`evaluateAutoRename()` 先调用 `estimateSessionStatus()` 算内容阶段，再叠加 guard。

### 1. `estimateSessionStatus()`

判定顺序：

1. 没有 `firstUserMessage` 且没有 `lastAgentMessage` -> `discovered`
2. `dirty = false` -> `applied`
3. 距 `updatedAt` 未到 `candidate_idle_seconds` -> `active`
4. 未到 `finalize_idle_seconds` -> `candidate_ready`
5. 否则 -> `finalize_ready`

### 2. guard 顺序

当前固定为：

1. `frozen`
2. `max_auto_renames_reached`
3. `rename_cooldown`

### 3. 动作映射

- `candidate_ready` -> `suggest`
- `finalize_ready` -> `apply`
- 其他或命中 guard -> `skip`

## apply 规则

只有满足全部条件才会在 auto-apply 中真正落盘：

- 会话仍然 dirty
- 评估结果为 `apply`
- 当前未 frozen
- 不处于 cooldown
- `auto_apply_count < max_auto_renames_per_session`
- 最近 daemon sweep 正在运行
- `rename.auto_apply = "idle-finalize"`

## freeze 规则

用户手动 freeze 后：

- 自动 rename 会直接 `skip`
- 仍然允许手动 `suggest`
- 仍然允许手动 `apply`
- `unfreeze` 后恢复正常调度

## dirty 批量 apply

`batch apply` 当前只支持 dirty 会话。

执行逻辑：

1. 选出 dirty sessions
2. 排除 frozen
3. 生成候选名
4. `--preview` 时只返回预览
5. 否则按顺序执行真正 apply

## requeue 规则

当前 requeue 的目标不是插入一条后台任务，而是把一批 session 重新打成 dirty。

执行 preview 时，会按规则签名比较：

- `last_applied_rule_signature != current_rule_signature` -> 需要重评估
- `current_revision != last_applied_revision` -> 内容已变，仍然需要重评估
- 没有历史规则签名 -> 视为 legacy，默认重评估
- 已按当前规则签名正式命名且内容没变 -> 直接跳过

真正执行 requeue 时，会：

- 把 `dirty_since_rename` 设为 `1`
- 把 `force_rewrite` 设为 `1`
- 清掉旧 candidate 与 candidate 对应的规则签名

## 关于外部改名

当前实现不再把“外部改名”落成独立的 `manual override` 保护态。

现在的处理方式是：

- 正式名只接受 `ai` 和 `manual`
- 非 accepted source 的官方名会被视为“待重写的过渡态”
- overview / dirty / official-name 统计都会据此做归一化
