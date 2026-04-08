# 触发与生命周期

更新时间：`2026-04-09`

## 问题定义

自动 rename 既不能太频繁，也不能长期没有结果。

当前实现建立在：

- rollout 文件内容变化
- `session_index.jsonl` 同步
- 周期性 sweep

而不是依赖 wrapper 或对 `/clear`、`/exit` 的强感知。

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
- daemon 正在运行
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

## 关于外部改名

当前实现不再把“外部改名”落成独立的 `manual override` 保护态。

现在的处理方式是：

- 正式名只接受 `ai` 和 `manual`
- 非 accepted source 的官方名会被视为“待重写的过渡态”
- overview / dirty / official-name 统计都会据此做归一化
