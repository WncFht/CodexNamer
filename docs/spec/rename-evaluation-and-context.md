# Auto Rename 评估与 Context 构建

更新时间：`2026-04-09`

## 1. 目的

这份文档描述当前两条核心逻辑：

1. `evaluateAutoRename()`
   - 负责把会话判成 `skip / suggest / apply`
2. `buildRenameContext()`
   - 负责决定 rename 时到底读取哪些会话内容

## 2. 当前代码入口

- [packages/core/src/auto-rename.ts](../../packages/core/src/auto-rename.ts)
- [packages/core/src/rename-context.ts](../../packages/core/src/rename-context.ts)
- [packages/core/src/naming.ts](../../packages/core/src/naming.ts)
- [packages/core/src/provider.ts](../../packages/core/src/provider.ts)
- [packages/core/src/manager.ts](../../packages/core/src/manager.ts)

## 3. 命名结构现状

当前最终标题结构是 **builder-first**：

- AI 或 heuristic 先产出结构化信息
- 后端再按 `naming.builder` 拼装最终标题

当前不再维护的活跃语义：

- `brief / detailed`
- `naming.default_style`
- 单会话 style 切换

兼容说明：

- DB / DTO 里仍保留 legacy `style` 字段
- 当前代码会继续读写这些字段以兼容旧数据
- 但它们不再决定实际命名策略

## 4. `evaluateAutoRename()`

### 4.1 `estimateSessionStatus()`

输入：

- `updatedAt`
- `firstUserMessage`
- `lastAgentMessage`
- `dirty`
- `watch.candidateIdleSeconds`
- `watch.finalizeIdleSeconds`

判定顺序：

1. 没有 `firstUserMessage` 且没有 `lastAgentMessage` -> `discovered`
2. `dirty = false` -> `applied`
3. 未到 `candidate_idle_seconds` -> `active`
4. 未到 `finalize_idle_seconds` -> `candidate_ready`
5. 否则 -> `finalize_ready`

### 4.2 guard 顺序

当前固定顺序：

1. `frozen`
2. `max_auto_renames_reached`
3. `rename_cooldown`

### 4.3 动作映射

- `candidate_ready` -> `suggest`
- `finalize_ready` -> `apply`
- 其他 -> `skip`

### 4.4 `apply` 的真实含义

这里的 `apply` 表示：

> 从调度语义上已经允许正式应用

它**不等于已经落盘**。

真正是否写回，要同时看：

- `rename.auto_apply`
- daemon 是否在运行
- runtime `actualExecution`

## 5. `buildRenameContext()`

### 5.1 输入

- `MaterializedSession`
- 当前生效配置
- 必要时的 transcript

### 5.2 输出

- `requestedStrategy`
- `strategy`
- `text`
- `segments`
- `summarySignals`
- `selectedChars`
- `truncated`
- `fallbackReason`

### 5.3 当前 context strategy

- `summary-signals`
- `last-user-last-assistant`
- `user-assistant-transcript`
- `user-only-transcript`
- `assistant-only-transcript`
- `user-transcript-last-assistant`
- `paired-user-turns`

### 5.4 transcript 读取

需要 transcript 的策略会由 manager 在需要时读取 rollout transcript。

当前 transcript API 还支持：

- 分页
- role 过滤
- 搜索
- `includeHidden`

## 6. 运行态面板约定

Web 的 `Rename Ops / 状态` 面板只消费统一后的评估结果，不再自己推断状态。

它会同时展示：

- 当前 `skip / suggest / apply`
- daemon runtime
- overview 图表
- replay
- AI request logs

默认策略：

- 页面首次只加载状态级 preview
- 只有用户显式按需载入候选名时，才会为 actionable item 补生成 candidate

## 7. AI request logs 现状

当前请求日志只记录：

- `responses`
- `openai-compatible`

不再把下列旧传输当作当前实现：

- `chat_completions`
- `codex-exec`

状态页请求日志当前是：

- 后端分页
- 每页 10 条
- 支持搜索、项目、状态、传输过滤
- 支持直接跳页

## 8. overview 统计口径

当前 overview 对 rename history 做了按会话去重：

- `renameHistory.applied / aiApplied / manualApplied / autoApplied`
  - 取每个 thread 最新一条 accepted applied 记录
- `activity.buckets`
  - 取每个 thread 最新一条 rename activity

因此：

- 同一会话多次命名不会在状态页图表里重复累计

## 9. 当前测试关注点

- `test/auto-rename-evaluation.test.ts`
- `test/auto-rename-apply.test.ts`
- `test/auto-rename-preview.test.ts`
- `test/overview-dedup.test.ts`

当前不再维护：

- `test/naming-style.test.ts`
