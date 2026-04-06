# Auto Rename 评估与 Context 构建

更新时间：`2026-04-06`

## 1. 目的

这份文档定义两个需要长期稳定维护的核心逻辑：

1. `evaluateAutoRename`
   - 用来判断一个 session 当前处于 `skip / suggest / apply` 哪个阶段
   - 是 auto-rename 调度与 preview 的统一判定基线
2. `buildRenameContext`
   - 用来构建 rename 时真正提供给 heuristic / AI 的上下文
   - 是“rename 到底读取哪些内容”的统一基线

后续如果改动下面任意一项，必须同步更新这份文档和对应测试：

- 状态判定顺序
- guard 优先级
- 命名风格版本
- 风格版本对应的历史维护方式
- transcript 过滤规则
- context 截断规则
- summary-signals 与 transcript 两种策略的语义

## 2. 当前代码入口

- `packages/core/src/auto-rename.ts`
  - `estimateSessionStatus`
  - `evaluateAutoRename`
- `packages/core/src/rename-context.ts`
  - `buildRenameContext`
- `packages/core/src/manager.ts`
  - `scan()` 中更新 `statusEstimate`
  - `suggest()` 中构建 rename context
  - `previewAutoRename()` 中调用 auto-rename 评估
- `packages/core/src/naming.ts`
  - heuristic rename 消费 `renameContext`
- `packages/core/src/provider.ts`
  - AI prompt 消费 `renameContext`
- `packages/web/src/SettingsPanel.tsx`
  - 默认命名风格配置
- `packages/web/src/SessionBrowser.tsx`
  - 单会话命名风格切换

## 2.1 命名风格版本

从 `2026-04-06` 起，rename 需要显式区分“命名风格版本”。

当前固定支持：

- `detailed`
  - 默认风格
  - 倾向保留“主子系统 + 实际动作 + 一个具体聚焦点”
- `brief`
  - 压缩风格
  - 只保留最核心的主子系统和动作

当前落地约定：

- 全局默认值由 `naming.default_style` 控制
- 单会话可保存 `preferred_style`
- 实际 suggestion 的风格解析顺序是：
  - 显式 style
  - `preferred_style`
  - `default_style`
- `rename_history` 每条记录都必须带 `style`
- `rename_state` 必须维护：
  - `current_candidate_style`
  - `last_applied_style`
  - `preferred_style`

## 3. `evaluateAutoRename`

### 3.1 输入

`evaluateAutoRename` 的输入由三部分组成：

- `SessionDetail`
- 当前生效配置 `EffectiveConfig`
- 可选运行时状态：
  - `now`
  - `renameState`

其中 `renameState` 主要提供这些守卫字段：

- `autoApplyCount`
- `lastAutoApplySuccessAt`

### 3.2 第一步：计算 `statusEstimate`

`estimateSessionStatus` 当前只负责 session 的内容阶段判断，不负责 policy guard。

判定顺序如下：

1. 如果 `firstUserMessage` 和 `lastAgentMessage` 都还没有，则为 `discovered`
2. 如果 `dirty = false`，则为 `applied`
3. 如果距 `updatedAt` 的空闲时间小于 `candidate_idle_seconds`，则为 `active`
4. 如果空闲时间已经达到 `candidate_idle_seconds`，但还没到 `finalize_idle_seconds`，则为 `candidate_ready`
5. 如果空闲时间达到 `finalize_idle_seconds`，则为 `finalize_ready`

注意：

- 这里的 `dirty` 仍然以 `current_revision != last_applied_revision` 为准
- 当前 `statusEstimate` 还没有消费 `growthBytes / taskCompleteDelta / lastAgentChanged` 这些增量信号

### 3.3 第二步：应用 guard

`evaluateAutoRename` 在 `statusEstimate` 之上叠加 guard。

当前 guard 优先级固定如下：

1. `manual_override`
2. `frozen`
3. `max_auto_renames_reached`
4. `rename_cooldown`
5. `candidate_ready`
6. `finalize_ready`
7. 其他状态直接 `skip`

对应动作如下：

- `manual_override` -> `skip`
- `frozen` -> `skip`
- `max_auto_renames_reached` -> `skip`
- `rename_cooldown` -> `skip`
- `candidate_ready` -> `suggest`
- `finalize_ready` -> `apply`
- `discovered / applied / active` -> `skip`

### 3.4 当前语义

这里的 `apply` 表示“从调度逻辑上允许正式 rename”。

当前项目里，这个评估结果会被两个入口复用：

- `previewAutoRename()`
  - 只暴露评估结果，不会自动落盘
- daemon `runAutoRenameSweep()`
  - 在 `rename.auto_apply = "idle-finalize"` 时
  - 会对 `apply` 状态的 session 真正调用 `apply()`

`previewAutoRename()` 现在直接暴露三种状态：
  - `skip`
  - `suggest`
  - `apply`
- `candidate_ready` 现在已经作为 `suggest` 通过 API/Web/TUI 显式展示
- `finalize_ready` 现在已经作为 `apply` 通过 API/Web/TUI 显式展示

也就是说，前端现在看到的是统一后的评估结果，不再需要自己二次推断；而 daemon 是否真的落盘，则由 `rename.auto_apply` 决定。

### 3.5 当前运行态面板约定

Web 当前把原先偏原始的 `Maintenance` 视图重构成了 `Rename Ops / 运行态` 面板。

这个面板的职责不是重新做 rename 判定，而是把下面几类信息放到一个地方：

- 当前实际执行模式
  - `actualExecution = "preview-only" | "auto-apply"`
  - `configuredAutoApply = rename.autoApply`
  - `daemonStatus = running | stale | not_seen`
  - `daemonAutoApply`
    - 只有最近 daemon 心跳存在，并且最近一轮 sweep 真正以 `auto-apply` 执行时才为 `true`
  - `lastSweepAt`
  - `lastSweepSummary`
- 近期 rename 活动
  - 区分 `applied / preview_only / skipped`
- 近期 AI 请求日志
  - 显示 `running / succeeded / failed`
  - 显示 `responses / chat_completions / codex-exec`
  - 显示线程、模型、耗时、错误
- 当前预览队列
  - 区分 `suggest / apply / skip`
- token 与工作区负载
  - 用来判断高消耗 session 主要集中在哪些目录

默认刷新策略也有一条固定约定：

- 运行态页默认只加载状态级 preview，不默认加载 `candidateName`
- 只有用户显式触发“按需载入候选名”时，才允许为 preview 队列补全候选名

这样做是为了避免页面一打开就触发整批 AI 命名，导致看起来像“维护页一直在刷新”。

### 3.6 daemon auto-apply 现状

当前 daemon 已经不再是纯 preview-only。

现状固定如下：

- daemon 每轮执行 `runAutoRenameSweep()`
- 这轮 sweep 会先统一评估 dirty session 的 `skip / suggest / apply`
- 如果 `rename.auto_apply = "idle-finalize"`
  - 则 `apply` 状态会真正调用 `manager.apply(threadId, { autoApply: true })`
- 如果 `rename.auto_apply = "disabled"`
  - 则仍然只保留 preview 结果，不自动落盘

当前 daemon 日志会同时输出：

- `previews`
- `applied`
- 汇总字段里的：
  - `suggest`
  - `apply`
  - `skip`
  - `autoApplied`
  - `unchanged`
  - `execution`

## 4. `buildRenameContext`

### 4.1 输入

`buildRenameContext` 接收：

- `MaterializedSession`
- 当前配置 `EffectiveConfig`
- 可选 `transcript`

输出是结构化 `RenameContext`，包含：

- `requestedStrategy`
- `strategy`
- `maxChars`
- `text`
- `segments`
- `truncated`
- `fallbackReason`
- `summarySignals`

其中：

- `requestedStrategy` 是配置里请求的策略
- `strategy` 是实际落地使用的策略
- 当 transcript 不可用时，允许从 `user-assistant-transcript` 回退到 `summary-signals`
- `buildRenameContext` 本身不直接决定 `brief / detailed`
  - 但它输出的内容会被后续命名风格消费
  - `detailed` 会在同一份 context 上额外尝试补一个“具体聚焦点”

## 5. 两种 Context 策略

### 5.1 `summary-signals`

这是轻量策略，只读取 3 个摘要信号：

- `firstUserMessage`
- `lastUserMessage`
- `lastAgentMessage`

输出顺序固定为：

1. `user(first)`
2. `user(last)`，但仅在它与 `firstUserMessage` 不同的时候保留
3. `assistant(last)`

输出文本类似：

```text
user(first): ...
user(last): ...
assistant(last): ...
```

### 5.2 `user-assistant-transcript`

这是完整 transcript 策略。

它要求上层提供 transcript；当前由 `manager.materializeSessionForSuggestion()` 在需要时读取 rollout transcript。

#### 过滤规则

只保留满足全部条件的 transcript item：

- `hidden = false`
- `kind = "message"`
- `role ∈ { user, assistant }`

这意味着默认会排除：

- bootstrap/system context
- tool call
- tool output
- reasoning
- 隐藏系统状态

#### 选择规则

当前 transcript context 由两部分组成：

1. `seed`
   - 始终优先保留首个用户目标
   - 优先使用 `session.firstUserMessage`
   - 如果没有，再从 transcript 里找第一条 `user` message
2. `recent`
   - 从最近的可见 `user/assistant` message 开始逆向回填
   - 在不超过 `context_max_chars` 的前提下尽量多保留
   - 最终再恢复为正序输出

输出文本类似：

```text
user(goal): ...
user: ...
assistant: ...
user: ...
assistant: ...
```

#### 去重规则

当前只做“相邻重复消息去重”：

- 如果两条相邻的可见 transcript message 在 `role + content` 上完全相同，则只保留一条

#### 截断规则

- `context_max_chars` 现在按配置值生效
- 仅保留一个很小的安全下限，避免出现完全不可用的 0 长度 context
- 当剩余预算不足时，对最后一个还能放入的 segment 做截断
- 如果有 segment 因预算不足未被纳入，`truncated = true`

## 6. 回退规则

当请求策略是 `user-assistant-transcript` 时：

- 如果根本没有传 transcript，则回退到 `summary-signals`
  - `fallbackReason = "missing_transcript"`
- 如果 transcript 存在，但过滤后没有任何可用 `user/assistant message`，则回退到 `summary-signals`
  - `fallbackReason = "empty_transcript"`

回退后：

- `requestedStrategy = "user-assistant-transcript"`
- `strategy = "summary-signals"`

这个差异是故意保留的，用于调试和后续 UI 透明化展示。

## 7. 谁会消费这个 Context

### 7.1 heuristic rename

heuristic 现在不再只盯三段摘要，而是优先消费 `renameContext`，并按“更具体但仍然可扫读”的目标生成名字。

当前 heuristic v2 的结构是：

- `kind`
  - 先对 `renameContext.text` 和关键 summary signal 做分类
  - 当前种类包括：
    - `feat`
    - `fix`
    - `debug`
    - `refactor`
    - `docs`
    - `research`
    - `review`
    - `design`
    - `migration`
    - `test`
    - `ops`
    - `chore`
- `scope`
  - 优先从 topic 规则里推断真实子系统，例如：
    - `settings`
    - `rename`
    - `naming`
    - `context`
    - `prompt`
    - `provider`
    - `web`
    - `tui`
    - `api`
    - `daemon`
  - 只有 topic 不明显时，才退回 project 名或目录名
- `summary`
  - 不再直接截一句最近消息
  - 现在会优先拼“动作 + 主话题 + 次话题”
  - `detailed` 还会额外尝试补一个“具体聚焦点”
  - `brief` 则只保留主结构，不补额外 focus
  - 典型形态例如：
    - `修复设置问题并梳理自动重命名逻辑`
    - `增强 rename context 并调整 AI prompt`
    - `修复设置问题并梳理自动重命名逻辑，聚焦中文切换与 inherit-codex`

目标不是把标题简单拉长，而是让标题更具体：

- 更清楚地表达子系统
- 更清楚地表达正在做的动作
- 在有两个紧密相关目标时允许一个短 secondary fragment

但是从当前版本开始，heuristic 结果不再算“正式命名来源”。

当前约定：

- 正式命名只接受：
  - `ai`
  - `manual`
- 任何非 `ai/manual` 的已应用名字，都会被系统视为“仍待 AI 重写”
- 这类名字在 UI 中会被当作“未命名”处理：
  - 不计入 `named`
  - 不出现在正式来源分布里
  - 会重新进入 dirty / preview / auto-rename 队列

这条约定的目的不是禁用 heuristic，而是把 heuristic 降级成：

- 候选名生成 fallback
- AI 正式命名前的过渡态

对应到配置界面上，Web Settings 已经不再暴露旧的 `rename.mode` 开关。

- `rename.mode` 仍作为兼容字段保留在配置解析层
- 但当前版本不再把它当作推荐给用户切换的正式模式
- 用户可见的主开关应理解为 `[ai].backend` 与 `rename.auto_apply`

### 7.1.1 正式名去重

从当前版本开始，rename 还增加了一层“正式名唯一化”约定：

- 无论名字来自：
  - AI apply
  - auto-apply
  - 手动 rename
- 在真正写入 `session_index.jsonl` 前，都要先做一次跨 session 重名检查

当前规则：

- 如果候选名与其他 session 的正式名重复
  - 保留先占用该名字的 session
  - 后写入的名字自动追加 ` (2) / (3) / ...` 后缀
- 如果历史上已经存在重复正式名
  - 保留该组里最早应用的那个名字
  - 后应用的重复项会被视为“待重写”
  - 它们会重新进入 dirty / preview / auto-rename 队列

这里“先后”的当前判定基准是：

- 优先按 `lastAppliedAt` 升序
- 时间相同或缺失时，再按 `threadId` 稳定排序

### 7.2 AI rename

AI prompt 现在会同时带上：

- 基础 session 元数据
- 三段 summary signal
- `requestedContextStrategy`
- `resolvedContextStrategy`
- `contextTruncated`
- `contextChars`
- `contextFallbackReason`
- `namingCompositionMode`
- `namingComponents`
- `componentSeparator`
- `Structured naming tags`
- `Rename context` 正文

这意味着 AI 命名已经真正区分：

- 只看摘要
- 使用 transcript 摘要化上下文

同时，AI prompt 也明确要求：

- 输出“简洁但具体”的名字，而不是泛泛短句
- 显式包含 `namingStyle = brief | detailed`
- 当 `namingStyle = detailed` 时：
  - 可以更充分使用长度预算
  - 可以带一个短 secondary focus
- 当 `namingStyle = brief` 时：
  - 更强调列表可扫读性
  - 避免无必要的第二子句
- 需要同时抓住“子系统 + 动作 / 问题 / 审查焦点”
- 如果会话里有两个高度相关的目标，可以保留一个短 secondary fragment

如果当前配置启用了 `prompt-override`，prompt 还会额外带上：

- `Custom naming override`
- 用户给出的整段覆写指令

语义是：

- `structured`
  - AI 需要尊重组件顺序来拼标题
  - tag 只在“命中且组件里包含 `tag`”时出现
- `prompt-override`
  - 结构化组件仍会保留在 prompt 里
  - 但 `custom_prompt` 会被声明为最高优先级命名约束

### 7.2.1 `brief / detailed` 与 `summary-signals / user-assistant-transcript` 的区别

这四个选项分成两层，不要混淆：

- `brief / detailed`
  - 这是“标题风格层”
  - 它决定 summary 要写得多具体、是否补 secondary focus、长度预算偏紧还是偏宽
- `summary-signals / user-assistant-transcript`
  - 这是“上下文取材层”
  - 它决定 prompt 和 heuristic 到底读哪一份会话内容

当前 prompt 里的具体差异是：

- `namingStyle = detailed`
  - prompt 明确要求“可更充分使用长度预算”
  - prompt 允许保留一个 concrete secondary focus
  - heuristic 会尝试额外补一个“聚焦 xxx”
- `namingStyle = brief`
  - prompt 明确要求“更短、更适合列表扫读”
  - heuristic 只保留主结构，不补 secondary focus
- `requestedContextStrategy = summary-signals`
  - prompt 里主要是 `firstUserMessage / lastUserMessage / lastAgentMessage`
  - renameContext 正文会更短、更稳
- `requestedContextStrategy = user-assistant-transcript`
  - prompt 会明确看到 transcript 版 `Rename context`
  - 会固定保留首个用户目标，再加入最近 user/assistant 消息
  - 更适合产出具体标题，但更容易受噪声影响

这也意味着，旧的 heuristic 官方名如果需要升级，会在后续调度里被重新送回 AI，而不是继续当作最终标题保留。

### 7.3 Prompt Preview

当前 `buildPromptPreview()` 也复用了同一套 context 构建结果。

它的职责是：

- 读取当前选中 session；如果没有选中 session，则构造 synthetic fallback session
- 复用 `buildRenameContext`
- 复用 `buildRenamePrompt`
- 把“真正要发给 AI 的 prompt”原样返回给上层 UI/API

目前可用入口：

- `GET /api/v1/ai/prompt-preview`
- Web `Settings`
- TUI `Settings`

维护要求：

- 任何 rename prompt 改动，都应该先看 prompt preview 是否仍然准确
- 不允许 UI 自己拼一份“看起来像 prompt 的展示文本”代替真实 prompt

## 8. 当前明确不读取的内容

在 rename context 里，当前明确不纳入：

- tool call 参数
- tool output 原文
- hidden bootstrap/system prompt
- reasoning 内容
- 目录文件内容
- 仓库源码内容
- shell 执行结果的完整长输出

原因是这些内容通常噪声大、体积大，而且容易把 session 标题带偏。

## 9. 后续演进边界

这份文档允许后续演进，但建议按下面顺序做：

1. 先保持 `evaluateAutoRename` 作为唯一 auto-rename 判定入口
2. 保持 `previewAutoRename` 和 daemon auto-apply 都建立在这个统一入口之上
3. 下一阶段优先考虑为真正 auto-apply 增加“候选稳定一轮 scan”之类的额外 gate
4. 再考虑是否把极短 tool 信号作为可选 context
5. 最后再考虑把 ingest 增量信号真正纳入 `statusEstimate`

不建议直接做的事情：

- 在 `manager.ts` 里重新手写一套 status / guard 判断
- 让 UI 各自拼自己的 rename context
- 在没有文档和测试的情况下修改 transcript 过滤规则

## 10. 维护要求

后续凡是修改下面任意项，必须同步更新：

- 本文档
- `test/auto-rename-apply.test.ts`
- `test/auto-rename-evaluation.test.ts`
- `test/auto-rename-preview.test.ts`
- `test/rename-context.test.ts`
- `test/api.test.ts`
- `test/naming.test.ts`
- `test/naming-style.test.ts`

如果未来新增：

- auto-apply 的稳定性 gate
- prompt preview 展示字段
- UI 语言影响的前端文案
- transcript 选择策略升级

也必须先在这份文档里写清楚新语义，再落代码。

## 11. 前端展示约定

### 11.1 自动命名状态展示

Web/TUI 当前统一遵守下面的状态映射：

- `skip`：当前不建议动作
- `suggest`：当前已达到 `candidate_ready`
- `apply`：当前已达到 `finalize_ready`

展示层只负责翻译和计数，不负责重新判断。

### 11.1.1 运行态页的额外展示约定

Web `Rename Ops / 运行态` 页当前还需要额外明确展示：

- `actualExecution`
- `configuredAutoApply`
- `daemonAutoApply`
- 最近一次成功应用时间
- 最近 14 天活动趋势
- 应用来源分布
- 工作区 token 压力

这里的重点是“解释现在系统到底有没有真正自动应用”，而不是只展示原始诊断 JSON。

当前约定：

- `actualExecution = "preview-only"`
  - 可能是以下几种情况之一：
    - `rename.auto_apply = "disabled"`
    - daemon 没有最近心跳
    - daemon 正在运行，但当前 sweep 仍是 preview-only
- `actualExecution = "auto-apply"`
  - 表示最近 daemon 心跳存在，并且会把 `finalize_ready` 自动写回

当前运行态页还必须明确区分两件事：

- “配置上允许 auto-apply”
- “后台 daemon 现在真的在跑，并且最近一轮 sweep 确实在处理 rename”

否则会出现“设置里开着 auto-apply，但其实根本没有 daemon 在跑”的误导。

### 11.1.2 命名风格版本展示

Web 当前还需要明确展示“这个会话正在用哪个命名风格版本”。

当前约定：

- `Settings`
  - 提供全局 `naming.default_style`
  - 当前只允许：
    - `detailed`
    - `brief`
- `Sessions`
  - 当前会话可手动切换：
    - `跟随默认`
    - `详细`
    - `简略`
  - 会话详情里至少展示：
    - `effectiveNamingStyle`
    - `officialNamingStyle`

当前还有两条额外约定：

- 如果切换会话风格后，旧 candidate 的 `candidate_style` 与当前 `effectiveNamingStyle` 不一致
  - 必须主动清空旧 candidate
  - 不能把旧风格候选名继续显示成当前候选
- 如果切换风格后再次 apply，但最终字符串与旧官方名一致
  - `session_index.jsonl` 不重复写
  - 但 `rename_history` 仍然要保留这次 `style` 记录
  - `rename_state.last_applied_style` 也必须刷新

### 11.2 UI 语言

Web/TUI 当前都通过配置项 `general.ui_language` 选择界面语言：

- `en-US`
- `zh-CN`

这个语言选项只影响界面展示文案与时间/数字格式，不改变 rename prompt 本身的语义。

### 11.3 Prompt Preview 展示

Web/TUI Settings 当前都需要展示下面这些最小信息：

- prompt 来源：当前 session 或 synthetic fallback
- threadId
- resolved context strategy
- prompt 正文

如果后续 UI 需要压缩展示，也不能省略 prompt 正文本体。
