# 状态页说明（Rename Ops / 运行态）

这份文档专门解释 WebUI 里的 **“状态”** 页，也就是 `Rename Ops / 运行态` 面板。

对应实现主要在：

- `packages/web/src/RenameOpsPanel.tsx`
- `packages/web/src/useControlDeckResources.ts`
- `packages/core/src/manager.ts`
- `packages/core/src/auto-rename.ts`
- `packages/core/src/database.ts`
- `packages/daemon/src/index.ts`

---

## 1. 这个页面到底在看什么

这页不是“配置页”，也不是“单会话详情页”。

它主要回答 4 个问题：

1. **后台 daemon 现在到底有没有真的在自动应用 rename**
2. **当前有哪些会话会被 skip / suggest / apply**
3. **最近 rename 活动和 AI 请求健康不健康**
4. **如果我刚改了命名规则，怎么把旧会话重新打回队列**

一句话概括：

> 这是一个把“自动命名调度状态 + 后台执行状态 + 请求日志 + 重放入口”放在一起的运行态控制面板。

---

## 2. 数据从哪来

状态页主要读 4 组数据：

1. `overview`
   - 入口：`manager.overview()`
   - 作用：汇总 runtime、pipeline、rename history、activity、replay
2. `preview`
   - 入口：`manager.previewAutoRename()`
   - 作用：给出当前即时评估的 `skip / suggest / apply`
3. `ai request logs`
   - 来源：AI 请求表 `ai_request_logs`
   - 作用：看最近模型请求是否在跑、慢在哪、错在哪
4. `doctor`
   - 入口：`manager.doctor()`
   - 作用：看底层原始诊断 JSON

### 2.1 页面刷新机制

进入“状态”页后，前端会加载：

- `overview`
- `doctor`
- `ai-request-logs`
- `preview`

并且在“状态”页停留时，默认会 **每 5 秒自动刷新一次**。

另外，前端还有事件轮询；只要后端有变更事件，也会触发当前视图刷新。

### 2.2 一个很重要的区别

状态页里同时存在两类“队列信息”：

- **后台 daemon 上一轮 sweep 的快照**
  - 来自 `daemon_runtime`
  - 是“后台上一次真的跑了什么”
- **当前页面触发的即时评估 preview**
  - 来自 `previewAutoRename()`
  - 是“如果现在立刻重新评估，会得到什么”

这两者**不保证相同**。

---

## 3. 页面结构总览

主内容区从上到下大致分成：

1. 自动重命名运行态（顶部大卡）
2. 4 张图表
3. 状态说明
4. 待处理队列
5. 规则变更后的重新入队（Replay）
6. 模型请求日志
7. 运行时原始信息（doctor JSON）

左侧边栏是全局壳层，不是状态页专属，但在状态页里也会同时出现。

---

## 4. 左侧边栏里和状态页最相关的部分

状态页左边栏底部会显示几个全局指标：

- **可见**
  - 当前 session 列表里可见的会话数量
- **应用队列**
  - 当前 preview 里 `apply` 的数量
- **建议队列**
  - 当前 preview 里 `suggest` 的数量
- **当前选择**
  - 当前选中的 workspace
- **上次同步**
  - 前端最近一次刷新 session 列表的时间

这里的“应用队列 / 建议队列”用的是 **当前 preview**，不是 daemon 上一轮 sweep。

---

## 5. 顶部：自动重命名运行态

这是页面最重要的一块。

它由 3 层组成：

1. 标题 + 解释文案 + 操作按钮
2. 一排 runtime badges
3. 一排 KPI 卡片

### 5.1 右上角两个按钮

#### 刷新

重新拉取整个状态页相关资源：

- overview
- doctor
- ai request logs
- preview

#### 按需载入候选名

这是一个很容易误解的按钮。

它的真实含义是：

> 在只看状态的 preview 基础上，额外为 `suggest / apply` 项真正生成候选名。

几个关键点：

- 默认状态页只拉 `skip / suggest / apply + reason`
- **不会默认生成候选名**
- 点击后才会为可行动项去跑命名生成
- 这可能触发 AI 命名请求
- 生成出来的候选名还会被保存为当前 candidate

这样做是为了避免：

> 页面一打开就对整批会话发 AI 请求，造成“维护页看起来一直在跑命名”。

还有一个实现细节：

- 只看状态时，状态页默认最多拉较大的 preview 集合
- 点击“按需载入候选名”时，前端会把请求限制得更保守（当前实现默认 100 条）

所以你可能看到：

- “仅状态”时队列很多
- “含候选名”时只展示前一部分

这是设计使然，不是数据丢了。

### 5.2 顶部说明文案

这里的核心提醒是：

> `finalize_ready` 只表示“允许应用”，不表示“已经自动落盘”。

也就是说：

- `apply` 是调度动作
- “真的写回到 `session_index.jsonl`” 还要看后台 daemon 是否在 auto-apply

---

## 6. Runtime badges：一排状态徽章

### 6.1 实际执行（Execution）

字段：`overview.runtime.actualExecution`

只有两种值：

- `preview-only`
- `auto-apply`

含义：

- `preview-only`
  - 当前系统只是评估，不会自动写回
- `auto-apply`
  - 当前后台 daemon 最近一次 sweep 确实是按自动应用模式跑的

### 6.2 配置策略（Configured policy）

字段：`overview.runtime.configuredAutoApply`

它显示的是配置里的 `rename.autoApply`，比如：

- `disabled`
- `idle-finalize`

注意：

> 这里只表示“配置允许不允许”，不表示后台现在真的在执行。

### 6.3 Daemon 状态

字段：`overview.runtime.daemonStatus`

可能值：

- `running`
- `stale`
- `not_seen`

含义：

- `running`
  - 最近 sweep 心跳存在，且进程还活着
- `stale`
  - 有旧心跳，但太久没更新，或者记录里的进程已经不在了
- `not_seen`
  - 还没记录过 daemon sweep

注意一个非常关键的点：

> 你在页面里手动点 preview，不会把自己算成 daemon 心跳。

也就是说，**页面轮询 preview 不会把 daemon 状态伪装成 running**。

### 6.4 Daemon 自动应用

字段：`overview.runtime.daemonAutoApply`

这是真正回答“后台自动应用有没有生效”的布尔值。

它为 `true` 的条件比“配置开了”更严格：

- daemon 最近在运行
- 最近一轮 sweep 的执行模式是 `auto-apply`

### 6.5 最近一轮 Sweep

字段：`overview.runtime.lastSweepAt`

表示 daemon 最近一次 sweep 的时间戳。

### 6.6 最近应用

字段：`overview.renameHistory.lastAppliedAt`

表示最近一次正式命名落盘的时间。

这里统计的“正式命名”当前只认：

- AI 应用
- 手动命名

### 6.7 最近重入队

字段：`overview.replay.lastRunAt`

表示最近一次执行 replay 的时间。

### 6.8 活跃 AI 请求

字段：`aiRequestLogs.activeCount`

表示当前 `ai_request_logs` 里状态还是 `running` 的请求数量。

### 6.9 最近 AI 完成

字段：`aiRequestLogs.lastFinishedAt`

表示最近一条完成的 AI 请求时间。

---

## 7. KPI 卡片：每张卡是什么意思

### 7.1 上一轮后台 Sweep

字段：`overview.runtime.lastSweepSummary`

这张卡回答的是：

> 后台 daemon 上一轮 sweep 扫了多少 dirty session，其中多少被判成 suggest / apply / skip。

子字段含义：

- `total`
  - 上一轮 sweep 实际评估的总数
- `suggest`
  - 被判成 `suggest` 的数量
- `apply`
  - 被判成 `apply` 的数量
- `skip`
  - 被判成 `skip` 的数量

注意：

> 这里的 `apply` 不是“已经写回”，而是“上一轮判断为可以应用”。

### 7.2 Sweep 落盘结果

同样来自 `lastSweepSummary`

它回答的是：

> 在上一轮后台 sweep 里，真正发生了多少次写回。

子字段：

- `autoApplied`
  - 真正写回成功的自动应用次数
- `unchanged`
  - 进入 apply 流程了，但最终名字没变化，所以没有真的追加写回
- `execution`
  - 那一轮 sweep 的执行模式：`preview-only` 或 `auto-apply`

### 7.3 总 Token

字段：`overview.workload.totalTokens`

表示当前被索引会话的 token 总量。

副文案里的“来自 dirty 会话”：

- 字段：`overview.workload.dirtyTokens`
- 表示当前仍需处理或待重写会话的 token 总量

这张卡主要是压力感知，不是命名动作本身。

### 7.4 任务完成数

字段：`overview.workload.totalTasks`

表示从 rollout 中抽出来的 `task_complete_count` 总和。

副文案：

- `averageTokensPerSession`
- 即平均每个会话消耗多少 tokens

### 7.5 已应用重命名

字段：`overview.renameHistory`

显示：

- 总正式应用数 `applied`
- 其中自动应用数 `autoApplied`
- 其中手动应用数 `manualApplied`

注意：

当前“正式命名”只统计：

- `source = ai`
- `source = manual`

旧 heuristic 之类不会算进这个卡片。

### 7.6 平均标题字数

字段：`overview.workload.averageTitleLength`

表示当前正式标题的平均长度。

副文案里的样本量：

- `overview.sessions.named`
- 也就是参与统计的正式标题数量

### 7.7 当前即时评估

字段来自当前 `preview`

它回答的是：

> 如果现在立刻重新评估一次，当前队列里有多少 `suggest / apply` 项。

显示的是：

- `apply + suggest` 总和
- 以及两者分别多少

这张卡是**页面即时评估**，不是 daemon 上一轮结果。

### 7.8 最近 AI 请求

字段来自 `aiRequestLogs.items[0]`

它显示最新一条 AI 请求的：

- 耗时 `durationMs`
- 传输方式 `transport`
- 状态 `status`

如果还没有请求日志，就显示占位文案。

---

## 8. 四张图表分别怎么看

### 8.1 会话阶段分布

图表名：**会话阶段分布**

来源：`overview.pipeline`

它不是看 preview，而是看 **全体已索引会话** 当前处于哪一阶段。

当前图上展示 5 个阶段：

- 刚发现（`discovered`）
- 活跃中（`active`）
- 候选就绪（`candidate_ready`）
- 可终稿（`finalize_ready`）
- 已应用（`applied`）

它要回答的是：

> 现在整体会话主要卡在“内容还在更新”、还是“已经能建议”、还是“已经可以正式应用”。

注意：

`overview.pipeline` 里其实还有：

- `idle`
- `archivedHint`
- `missing`

但当前图表没有把这几类画出来。

### 8.2 原因到动作的流向

图表名：**原因到动作的流向**

这是一个 Sankey 图。

来源：当前 `preview.items`

计算方式很简单：

- 每个 preview item 都有一个 `reason`
- 每个 preview item 都有一个最终 `status`
- 前端把它聚合成 `reason -> action`

例如：

- `手动覆盖保护 -> 跳过`
- `已冻结 -> 跳过`
- `已达到候选建议阈值 -> 建议`
- `已达到最终应用阈值 -> 应用`
- `仍在活跃更新 -> 跳过`

所以这张图回答的是：

> 当前队列里，系统为什么把这些会话导向 skip / suggest / apply。

这张图不是历史统计，只看**当前 preview 队列**。

### “原因到动作”的底层判定流

底层逻辑在 `evaluateAutoRename()`。

先算内容阶段：

- 没有足够内容 -> `discovered`
- 还在活跃更新 -> `active`
- 达到候选空闲阈值 -> `candidate_ready`
- 达到终稿空闲阈值 -> `finalize_ready`

再叠加 guard：

1. `manual_override`
2. `frozen`
3. `max_auto_renames_reached`
4. `rename_cooldown`

最后映射成动作：

- `candidate_ready -> suggest`
- `finalize_ready -> apply`
- 其他或被 guard 挡住 -> `skip`

可以把它记成一条线：

> 会话状态 / 保护原因 -> `evaluateAutoRename()` -> `skip | suggest | apply`

### 8.3 近期重命名活动

图表名：**近期重命名活动**

来源：`overview.activity`

时间窗口：最近 14 天。

这张图当前画 3 条线：

- 已应用
- 仅预览
- 已跳过

它回答的是：

> 最近两周，系统更多是在真正落盘，还是更多停留在 preview，还是经常因为各种原因被 skip。

注意：

- 底层数据里还有 `failed / autoApplied / manualApplied / aiApplied`
- 但当前图只画了 `applied / previewOnly / skipped`

### 8.4 应用来源分布

图表名：**应用来源分布**

来源：`overview.renameHistory.aiApplied` 和 `manualApplied`

它表示当前正式命名中，来源是：

- AI
- 手动

这张图**不是最近 14 天**，而是当前 overview 里的累计正式应用分布。

如果还没有数据，会显示“暂无数据”。

---

## 9. 状态说明卡片

这块只有 3 张卡：

- 跳过
- 建议
- 应用

来源：

- 当前 `preview` 的三类计数

它不是在重新判断，而是在把当前 preview 的三种动作语义翻成人话：

### 跳过

说明当前会话因为下面这类原因暂时不动：

- 活跃中
- 冻结
- 手动覆盖
- 冷却中
- 达到自动命名次数上限

### 建议

说明会话已经到 `candidate_ready`

含义：

> 可以先产出候选名，但还不到正式落盘的时候。

### 应用

说明会话已经到 `finalize_ready`

含义：

> 从调度上允许正式应用；如果 daemon 正在 auto-apply，就可能自动写回。

---

## 10. 待处理队列（Action queue）

这块经常和“上一轮后台 Sweep”混淆。

它顶部已经明确提示：

> 这里是当前页面触发的即时评估，不是 daemon 上一轮 sweep 的快照。

### 10.1 右上角状态：仅状态 / 含候选名

这个小标签表示当前 preview 里有没有带 `candidateName`：

- **仅状态**
  - 只有 `threadId + status + reason`
- **含候选名**
  - 已经为可行动项生成过候选名

### 10.2 顶部 4 个小统计

它们分别是：

- 建议数：当前 preview 里的 `suggest`
- 应用数：当前 preview 里的 `apply`
- 跳过数：当前 preview 里的 `skip`
- AI 应用：累计正式 AI 应用数

注意最后一个 **AI 应用** 是历史汇总，不是当前队列大小。

### 10.3 列表主体

这里只显示当前 preview 里**可行动**的会话，也就是：

- `suggest`
- `apply`

不会展示 `skip` 项。

每行显示：

- 主标题
  - 有候选名就显示候选名
  - 没有候选名就退回显示 `threadId`
- 副标题
  - `threadId`
- 右侧动作标签
  - 建议 / 应用

当前前端最多显示前 16 条，主要用于快速扫一眼，不是完整队列表。

### 10.4 跳过摘要：为什么没进队

这里会把所有 `skip` 项按 reason 聚合。

常见原因包括：

- 手动覆盖保护
- 已冻结
- 达到自动命名上限
- 处于重命名冷却期
- 内容不足
- 仍在活跃更新

这块回答的是：

> 为什么有些会话没有进入建议/应用队列。

---

## 11. 规则变更后的重新入队（Replay）

这块是给“我改了命名规则，想让旧会话重新算一遍”的。

### 11.1 它到底做什么

Replay **不会改配置**，也不会直接改正式标题。

它做的是：

1. 选出命中时间范围的会话
2. 清空旧 candidate
3. 把这些会话重新标成待命名 / 待重写
4. 让后续 sweep 再次评估它们

底层入口：

- `queueRenameReplaySince()`

它会把对应会话的：

- `dirty_since_rename = 1`
- `force_rewrite = 1`
- 当前 candidate 清空

### 11.2 起始时间（Since）

就是 replay 的时间下限。

### 11.3 基准（Basis）

有两个选项：

#### 按会话更新时间

底层条件：

> `COALESCE(updated_at, created_at) >= since`

适合：

- 最近改过内容的会话，重新参与命名

#### 按上次正式命名时间

底层条件：

> `last_applied_at >= since`

适合：

- 想把最近一段时间已经命过名的会话全部重新跑一遍

### 11.4 最近记录 / 最近一轮清空 candidate

显示最近 replay 执行历史。

当前实现里：

- `clearedCandidates` 通常和 `queued` 一样大

### 11.5 下方 replay 历史列表

每一条会显示：

- 基准类型
- 起始时间
- 入队多少个会话
- 清空多少个 candidate
- 这次 replay 的执行时间

---

## 12. 模型请求日志（AI request logs）

这是状态页里最偏“运维日志”的部分。

它主要回答 3 个问题：

1. 现在有没有 AI 请求卡住
2. 最近慢的是哪一条
3. 失败发生在什么传输层

### 12.1 顶部过滤器

支持按下面维度过滤：

- 搜索词
- 状态
- 传输方式

搜索会匹配：

- project
- threadId
- model
- backend
- transport
- baseUrl
- error
- metadata

### 12.2 顶部汇总 chips

会显示：

- 当前筛选结果数
- 进行中数量
- 成功数量
- 失败数量
- 最近完成时间

### 12.3 表格每一列含义

#### 时间

- 第一行：开始时间
- 第二行：结束时间

#### 项目

- 第一行：projectName
- 第二行：backend（`codex` / `openai-compatible`）

#### Thread

- 会话 threadId

#### 模型

- 第一行：model
- 第二行：providerRef

#### 状态

- `running`
- `succeeded`
- `failed`

#### 耗时

- `durationMs`
- 如果是最新一条，会额外标记 `最新`

#### 字符

显示：

- `promptChars / responseChars`

注意这是**字符数**，不是 token 数。

#### 传输

第一行是 transport：

- `responses`
  - 走 `/v1/responses`
- `chat_completions`
  - 走 `/v1/chat/completions`
- `codex-exec`
  - 走本地 `codex exec`

第二行通常是：

- `requestedBackend`
- 或回退显示 `backend`

所以你会看到一种很典型的情况：

- transport = `responses`
- secondary = `codex`

这表示：

> 虽然逻辑后端是 codex，但当前实际传输走的是直连 HTTP Responses API，而不是 `codex exec`。

#### 接口

显示 `baseUrl`。

对 `codex-exec` 来说，这里可能没有值。

#### 信息

- 如果请求失败，第一行显示 error，第二行显示“错误”
- 如果没失败，第二行通常显示 profile

---

## 13. 运行时原始信息（Raw runtime details）

这块是一个收起的 `details` 面板。

内容就是 `/api/v1/doctor` 的原始 JSON。

它更像底层诊断备份，不是主要阅读入口。

通常包含：

- `codexHomeExists`
- `sessionsDirExists`
- `sessionIndexReadable`
- `sessionIndexWritable`
- `dbPath`
- `dbExists`
- `stats`
- `autoRename`
- `provider`

适合：

- 排查文件权限
- 查 DB 路径
- 看 provider 解析原始值
- 做低层 debug

不适合：

- 日常看队列
- 判断 daemon 是否真的在应用

因为这些信息上面已经被加工成更易读的 runtime 面板了。

---

## 14. 关键术语速查

### `skip / suggest / apply`

这是状态页里最核心的三个动作标签：

- `skip`
  - 当前不动
- `suggest`
  - 到了 `candidate_ready`
- `apply`
  - 到了 `finalize_ready`

### `candidate_ready`

会话已经空闲到足够生成候选名，但还没到正式落盘时机。

### `finalize_ready`

会话已经空闲到足够正式应用。

但是否真的自动落盘，还要再看 daemon runtime。

### 上一轮后台 Sweep

指的是：

> 后台 daemon 最近一次 `runAutoRenameSweep()` 的结果汇总。

不是页面即时 preview。

### 按需载入候选名

指的是：

> 只在你明确点击时，才为 `suggest / apply` 项真正生成候选名。

不是普通刷新。

### 原因到动作的流向

指的是：

> 当前 preview 队列里，每个 reason 最后被导向了哪个动作。

本质上就是 `reason -> skip|suggest|apply` 的聚合图。

### Replay / 重新入队

指的是：

> 把旧会话重新标成待命名，让新规则重新评估它们。

不是直接重写正式标题。

---

## 15. 最容易混淆的几个点

### 15.1 `apply` 不等于“已经应用”

在状态页里：

- `apply` 常常只是“允许应用”
- 是否真的写回，要看：
  - `actualExecution`
  - `daemonStatus`
  - `daemonAutoApply`
  - `lastSweepSummary.autoApplied`

### 15.2 `idle-finalize` 不等于“后台已经在自动应用”

`idle-finalize` 只是配置层允许。

如果：

- daemon 没启动
- 心跳过期
- 最近 sweep 仍是 preview-only

页面依然会显示系统实际没有在 auto-apply。

### 15.3 “当前即时评估”不等于“上一轮后台 Sweep”

两者来源不同：

- 即时评估：页面现在拉的 preview
- 上一轮后台 Sweep：daemon 上次真实执行快照

### 15.4 “按需载入候选名”不是纯展示按钮

它会真正触发候选名生成。

也就是说：

- 可能发 AI 请求
- 可能写 candidate 缓存

### 15.5 图表有“当前队列视角”和“历史视角”两种

- 当前队列视角
  - 原因到动作的流向
  - 待处理队列
  - 跳过摘要
- 历史视角
  - 近期重命名活动
  - 应用来源分布
  - 最近应用时间

---

## 16. 如果你只想快速读懂这页，记住这几条就够了

1. **先看“实际执行 / Daemon 状态 / Daemon 自动应用”**
   - 这三项决定后台有没有真的在自动落盘
2. **再看“上一轮后台 Sweep”**
   - 看后台上次真实跑出了多少 suggest / apply / skip
3. **再看“当前即时评估”**
   - 看如果现在重算，队列长什么样
4. **如果想知道为什么没进队，看“原因到动作的流向”和“跳过摘要”**
5. **如果想知道 AI 后端有没有出问题，看“模型请求日志”**
6. **如果刚改了规则，去用“重新入队（Replay）”**

---

## 17. 代码对照表

- 页面主体：
  - `packages/web/src/RenameOpsPanel.tsx`
- 状态页资源加载与自动刷新：
  - `packages/web/src/useControlDeckResources.ts`
- 状态页加载哪些资源：
  - `packages/web/src/control-deck-model.ts`
- 自动命名动作判定：
  - `packages/core/src/auto-rename.ts`
- overview 汇总：
  - `packages/core/src/manager.ts`
  - `packages/core/src/database.ts`
- daemon sweep 与 runtime 心跳：
  - `packages/daemon/src/index.ts`
  - `packages/core/src/manager.ts#runAutoRenameSweep`
- replay：
  - `packages/core/src/database.ts#queueRenameReplaySince`
- AI 请求日志：
  - `packages/core/src/provider.ts`
  - `packages/core/src/database.ts`
