# 前端设计系统重构计划（Niracler / Bokushi 参考）

日期：`2026-04-13`
状态：`implemented + reviewed on 2026-04-13`
参考：

- 外部设计稿：`docs/research/niracler-design.md`
- 当前前端截图：
  - `docs/reviews/assets/frontend-sessions-2026-04-05.png`
  - `docs/reviews/assets/frontend-settings-2026-04-05.png`
- 现有前端结构说明：
  - `docs/reviews/frontend-design-audit-2026-04-05.md`
  - `docs/reviews/frontend-backend-refactor-plan-2026-04-11.md`
  - `docs/reviews/frontend-backend-remaining-plan-2026-04-11.md`

## 1. 目标

这轮不是继续做一层“暖色皮肤”，而是把 Web 前端真正切到一套统一、可维护、可扩展的视觉系统。

目标风格来自 `docs/research/niracler-design.md`：

- 暖纸感、内容优先、低噪音
- 语义化 token，而不是零散硬编码颜色
- 统一的 card / pill / icon button / section label 语言
- 更强的阅读宽度控制与留白节奏
- light / dark / system 三态主题
- hover 以边框、色彩、阴影微调为主，不做浮夸位移动画

这轮只重构 `packages/web` 的展示层，不改变后端接口、资源刷新模型和共享 DTO。

## 2. 当前代码的真实落点

### 2.1 入口与页面壳层

- `packages/web/src/main.tsx`
  - 入口，挂载 `App`
  - 引入全局 `styles.css`
- `packages/web/src/App.tsx`
  - 顶层壳层
  - 负责 `SidebarRail`、分栏宽度、tab lazy load、notice banner、sessions/settings/maintenance/requeue/daemon 五个主视图切换
- `packages/web/src/app-shell/SidebarRail.tsx`
  - 当前左 rail 的品牌、tab、workspace 列表、footer 统计
- `packages/web/src/app-shell/TopNoticeBanner.tsx`
  - 顶部提示
- `packages/web/src/app-shell/usePaneLayoutState.ts`
  - sidebar / session pane 的折叠与拖拽宽度状态

### 2.2 主要页面

- Sessions
  - `packages/web/src/SessionBrowser.tsx`
  - `packages/web/src/features/sessions/SessionListPane.tsx`
  - `packages/web/src/features/sessions/SessionDetailHeader.tsx`
  - `packages/web/src/features/sessions/RenameHistoryPanel.tsx`
  - `packages/web/src/TranscriptPanel.tsx`
- Settings
  - `packages/web/src/SettingsPanel.tsx`
  - `packages/web/src/features/settings/shared.tsx`
  - `packages/web/src/features/settings/sections/*`
- Maintenance
  - `packages/web/src/RenameOpsPanel.tsx`
  - `packages/web/src/features/maintenance/*`
- Requeue
  - `packages/web/src/RequeuePanel.tsx`
- Daemon
  - `packages/web/src/DaemonPanel.tsx`
  - `packages/web/src/features/daemon/*`

### 2.3 当前样式结构

所有视觉规则目前仍集中在：

- `packages/web/src/styles.css`

本轮会在保留 `styles.css` 作为原始基线的同时，新增一层：

- `packages/web/src/design-system.css`

它现在同时承担：

- 根 token
- 按钮 / 表单 / disclosure / modal
- shell / sidebar / session list / transcript
- settings / maintenance / requeue / daemon
- responsive 断点
- view transition 动画

这份文件已经能支撑产品可用，但不再适合继续堆叠第二轮系统级重构。

### 2.4 与视觉强相关的联动点

- `packages/web/src/features/maintenance/charting.tsx`
  - 当前从 CSS 读取 `--text-secondary`、`--text-muted`、`--border-strong`、`--bg-secondary`、`--bg-elevated`、`--accent`、`--success`、`--warning`、`--danger`、`--manual`
  - 这意味着图表配色必须与新的 token 体系同步升级
- `packages/web/src/view-transitions.tsx`
  - 当前只是透传 React 19 ViewTransition 能力
  - 视觉系统升级时要保留现有导航切换手感，但统一动画时长与 easing

## 3. 当前前端的主要问题

### 3.1 不是“丑”，而是语言不统一

当前页面已经不是 demo，但仍然存在三套同时并存的视觉语言：

1. 深色 sidebar 控制台语言
2. 暖色 settings / maintenance 卡片语言
3. transcript / detail 面板的半日志阅读语言

结果是：

- 页面能用，但不是一个完整产品
- 首屏气质仍像内部工具面板
- 同一类信息在不同页面上的视觉优先级不一致

### 3.2 样式 token 还是仓库私有命名，难以扩展主题

当前根变量以 `--bg`、`--text`、`--accent` 为主。

问题：

- 语义层次不够细
- dark theme 没有正式落点
- 后续如果加 theme toggle，会继续补丁式扩展

### 3.3 sidebar 仍然过重

`SidebarRail` 当前是高对比深色块，和主内容的暖纸背景不是同一套语气。

实际影响：

- 视觉焦点先落到 rail，而不是内容
- sessions/settings 页的主区更像“右侧工作区”，不是整个产品主舞台

### 3.4 sessions 页仍偏“运维式浏览”

问题主要在：

- session list 卡片元信息偏密
- toolbar / meta strip / message card 的层级还不够克制
- tool / system 消息虽然已做区分，但在视觉上仍然偏吵

### 3.5 settings / maintenance / daemon 各自已经变好，但还没完全统一

它们现在共享部分结构，但还有各自的专属视觉规则：

- `settings-summary-metric`
- `detail-panel`
- `ops-attention-card`
- `daemon-summary-metric`

这些组件在语义上已经很接近，应该进一步统一到一套 surface card 语言里。

## 4. 设计稿落地后的目标形态

## 4.1 新的视觉系统骨架

将引入一套新的语义 token，并保留必要的兼容别名，避免一次性推翻全部 class：

### 颜色

以 `docs/research/niracler-design.md` 为主：

- `--color-bg-page`
- `--color-bg-surface`
- `--color-bg-muted`
- `--color-text-primary`
- `--color-text-secondary`
- `--color-text-muted`
- `--color-accent`
- `--color-link`
- `--color-border`
- `--color-border-soft`
- `--color-border-strong`
- `--color-success`
- `--color-warning`
- `--color-danger`
- `--color-note`
- `--color-code-bg`

同时为现有样式与图表保留兼容映射：

- `--bg -> --color-bg-page`
- `--bg-secondary -> --color-bg-muted`
- `--bg-elevated -> --color-bg-surface`
- `--text -> --color-text-primary`
- `--text-secondary -> --color-text-secondary`
- `--text-muted -> --color-text-muted`
- `--accent -> --color-accent`
- 其余 success/warning/danger/manual 同步映射

### 排版

会引入 design.md 的排版约束：

- `--font-ui` 切到 `jf-openhuninn-2.0` 优先的栈，保留系统 fallback
- `--font-size-base = 17px`
- body `letter-spacing: 0.01em`
- 标题与元信息层级拉开
- 继续保留 monospace 给日志 / JSON / 命令

### 尺寸 / 间距 /圆角 / 阴影 / 动画

引入：

- `--space-1 ~ --space-12`
- `--radius-sm / md / lg / full`
- `--shadow-soft / --shadow-strong`
- `--transition-fast / base / slow / slower`
- `--layout-max-width: 72rem`
- `--measure: 68ch`
- `--measure-wide: 72ch`

## 4.2 组件语言统一

将收敛到以下通用视觉原语：

- `surface-card`
- `pill`
- `icon-btn`
- `eyebrow`
- `focus-accent`

实际做法不是强行一次性把所有 JSX class 名都重写，而是：

1. 先建立新的基础原语
2. 再让现有类名映射到统一风格
3. 对最关键的顶层组件再补少量 JSX 调整

## 4.3 主题系统

新增正式主题能力：

- `system`
- `light`
- `dark`

实现方式：

- 在 `document.documentElement` 上写入 `[data-theme]`
- 使用 CSS variables 驱动全部颜色切换
- 用 `localStorage` 持久化 theme mode
- 监听 `prefers-color-scheme`，在 `system` 模式下自动切换

## 5. 具体改哪些文件

## 5.1 样式与主题基础层

### `packages/web/src/design-system.css`

这是本轮新的主样式层，放在 `styles.css` 之后加载。

会改：

- 新的语义 token
- light / dark theme token
- 现有 class 的统一覆盖层
- shell / sidebar / sessions / transcript / settings / maintenance / requeue / daemon 的统一节奏
- responsive 规则同步调整

### `packages/web/src/styles.css`

这份文件本轮不再继续直接堆第二套视觉规则，而是保留为现有兼容基线。

会改：

- 只保留被新设计系统需要复用的原有 class 基础

不会改：

- 路由或数据逻辑
- API 调用方式

### 新增主题逻辑文件

计划新增：

- `packages/web/src/app-shell/useThemePreference.ts`
- `packages/web/src/app-shell/ThemeToggle.tsx`

职责：

- 管理 `system | light | dark`
- 写入 `[data-theme]`
- 对外提供切换按钮

## 5.2 App 壳层与导航

### `packages/web/src/App.tsx`

会改：

- 接入全局 theme hook
- 将 theme 信息传给 `SidebarRail`

### `packages/web/src/app-shell/SidebarRail.tsx`

会改：

- 重新组织 header 区
- 加入 theme toggle
- 弱化当前深色重 rail
- 让 tab / workspace / footer stats 的视觉层级更克制

原则：

- 不改它的核心职责
- 只改展示结构和视觉语言

## 5.3 Sessions 页面

### `packages/web/src/features/sessions/SessionListPane.tsx`

会改：

- 减少 session 卡片冗余元信息
- 在 workspace 已固定时，避免重复显示 workspace label
- 让列表标题、subtitle、meta 的优先级更清楚

### `packages/web/src/features/sessions/SessionDetailHeader.tsx`

会改：

- 标题区与动作区层级收敛
- action button 视觉样式统一
- meta bar 改成更轻的 pill / muted 文本组合

### `packages/web/src/TranscriptPanel.tsx`

会改：

- toolbar / filter chip / meta strip 的间距与层级
- message card 的 role 区分方式
- tool / system 的噪音进一步降权
- transcript 正文阅读宽度与留白控制

### `packages/web/src/SessionBrowser.tsx`

原则上尽量少改逻辑，只让：

- 分栏体验更像“阅读面 + 浏览面”
- 空状态、切换、focus mode 与新样式对齐

## 5.4 Settings 页面

### `packages/web/src/SettingsPanel.tsx`

会改：

- header 节奏
- summary strip 的产品化表达
- settings shell 的宽度与栅格关系

### `packages/web/src/features/settings/shared.tsx`

会改：

- `SettingsNav`
- `SettingsSummaryMetric`
- `SettingsSectionFrame`

目标：

- 让 settings 形成统一章节节奏
- 不再像一组“好看但各自独立”的后台卡片

### `packages/web/src/features/settings/sections/*`

主要以样式收敛为主，但会根据需要做少量结构修剪：

- `OverviewSection.tsx`
- `NamingSection.tsx`
- `AiProviderSection.tsx`
- `SchedulerSection.tsx`
- `RuntimeSection.tsx`

重点：

- 卡片头部结构统一
- disclosure / JSON / 运行态字段统一
- tag preset modal 与 builder area 更贴近新设计系统

## 5.5 Maintenance / Requeue / Daemon

### `packages/web/src/RenameOpsPanel.tsx`
### `packages/web/src/features/maintenance/*`

会改：

- overview / action / chart / logs / diagnostics 统一为一套 surface-card 语言
- 减少“不同模块不同皮肤”现象
- 图表卡、attention card、log panel 的边框/阴影/背景统一

### `packages/web/src/RequeuePanel.tsx`

会改：

- summary card 与 action area 的风格统一
- 表单区与高级区的卡片语言统一

### `packages/web/src/DaemonPanel.tsx`
### `packages/web/src/features/daemon/*`

会改：

- header / summary strip / advanced disclosure 与 settings / maintenance 保持同一设计语气
- 进程和日志块保持技术信息完整，但视觉更克制

## 5.6 图表主题

### `packages/web/src/features/maintenance/charting.tsx`

会改：

- 图表读取新的 CSS token
- dark theme 下图表背景、文字、边框保持一致
- 不改 chart option 数据逻辑，只改 theme source

## 6. 这轮不改什么

以下内容默认不动：

- `packages/core`
- `packages/api`
- `packages/daemon`
- `packages/cli`
- Web 的资源刷新策略与状态机
- transcript 接口协议
- settings model 序列化逻辑

除非为前端样式重构所必须，否则不借机改业务逻辑。

## 7. 实施顺序

1. 建立主题系统与根 token
2. 重做全局按钮 / card / input / pill / disclosure 语言
3. 重做 sidebar 与 app shell
4. 重做 sessions 页阅读节奏
5. 收敛 settings 章节与 surface card
6. 收敛 maintenance / requeue / daemon
7. 同步图表主题
8. 构建与截图验证

## 8. 验证标准

### 构建验证

至少执行：

- `npm run lint`
- `npm run web:build`

如果改动牵涉共享 TS 或导入结构，再补：

- `npm run build`
- `npm test`

### 视觉验证

必须做真实截图核对，而不是只看代码：

- 启动 web UI
- 打开 sessions 页截图
- 打开 settings 页截图
- 打开 maintenance / daemon 页截图（至少抽两页）
- 验证 light / dark theme 至少各一轮

## 9. 完成标准

只有满足以下条件，才算这轮完成：

1. `packages/web` 已切到新的视觉系统
2. sessions / settings / maintenance / daemon 风格一致
3. theme toggle 可用
4. 构建通过
5. 有真实浏览器截图作为视觉验证证据
6. 最终通过 `jj commit` 落盘

## 10. 本次实施产物

本次实际新增或修改的关键文件：

- `docs/research/niracler-design.md`
- `docs/reviews/frontend-design-system-adoption-2026-04-13.md`
- `packages/web/src/design-system.css`
- `packages/web/src/app-shell/useThemePreference.ts`
- `packages/web/src/app-shell/ThemeToggle.tsx`
- `packages/web/src/App.tsx`
- `packages/web/src/app-shell/SidebarRail.tsx`
- `packages/web/src/features/sessions/SessionListPane.tsx`
- `packages/web/src/TranscriptPanel.tsx`
- `packages/web/src/features/maintenance/charting.tsx`
- `packages/web/src/main.tsx`

本次截图验证产物：

- `docs/reviews/assets/frontend-sessions-niracler-explicit-light-2026-04-13.png`
- `docs/reviews/assets/frontend-settings-niracler-explicit-light-2026-04-13.png`
- `docs/reviews/assets/frontend-maintenance-niracler-explicit-light-2026-04-13.png`
- `docs/reviews/assets/frontend-daemon-niracler-explicit-light-2026-04-13.png`
- `docs/reviews/assets/frontend-sessions-niracler-dark-2026-04-13.png`
- `docs/reviews/assets/frontend-settings-niracler-dark-2026-04-13.png`

## 11. 当日收尾审查与二次修正

在首轮设计系统落地后，又针对真实页面做了一轮对照 `design.md` 的收尾审查。本轮不再扩大页面范围，重点修正了剩余的不一致项。

### 11.1 Sidebar 最终状态

最终左侧 rail 已进一步收敛：

- 保留品牌标题、主题按钮、tab 导航、workspace 列表
- 去掉了说明性副文案
- 去掉了 “当前选择” 面板
- 去掉了左栏底部统计块
- 去掉了 workspace sidebar 的折叠入口

对应代码：

- `packages/web/src/app-shell/SidebarRail.tsx`
- `packages/web/src/app-shell/usePaneLayoutState.ts`
- `packages/web/src/App.tsx`
- `packages/web/src/design-system.css`

说明：

- 不只是隐藏了按钮，而是把 `workspacePaneCollapsed` 的前端生效链路一起清掉
- 当前 sidebar 只保留 design.md 更鼓励的 content-first 导航结构

### 11.2 Settings / AI provider 的最终收敛

Settings 在首轮落地后仍有两类偏差：

1. 顶部与 section copy 偏说明型
2. AI provider 中部分字段重复出现

最终修正后：

- `Overview / Scheduler / Runtime` 的 section copy 已进一步缩短
- `AI provider` 收敛成三层：
  - 接入方式
  - 当前生效配置
  - 连通性回执
- 连通性卡片上方保留：
  - 状态
  - Ping
  - 测试时间
- 下方不再重复这三项，改为：
  - `baseUrl`
  - `model`
  - `transport`
  - `credential`

对应代码：

- `packages/web/src/SettingsPanel.tsx`
- `packages/web/src/features/settings/shared.tsx`
- `packages/web/src/features/settings/sections/AiProviderSection.tsx`
- `packages/web/src/features/settings/sections/OverviewSection.tsx`
- `packages/web/src/features/settings/sections/SchedulerSection.tsx`
- `packages/web/src/features/settings/sections/RuntimeSection.tsx`

### 11.3 图表配色统一结论

这轮额外修掉的不是“某个图太绿”，而是图表之间的语义色不一致。

最终统一后的图表语义：

- `accent`：主流程 / finalize-ready / apply queue
- `note`：suggest / candidate / pending
- `success`：已应用 / auto-applied / latest
- `warning`：dirty / active / unknown
- `danger`：failed / outdated
- `muted`：skip / discovered / neutral

额外修正点：

- `charting.tsx` 的 fallback 颜色改到 Bokushi token，不再回落到旧主题色
- `Rename activity` 的 applied area 改成 success tint
- `preview / suggest` 在多张图里统一到 `note`
- Sankey 的 apply / suggest 节点色也按相同语义统一

对应代码：

- `packages/web/src/features/maintenance/charting.tsx`
- `packages/web/src/features/maintenance/chart-options.ts`

### 11.4 二次验证结果

代码验证：

- `npm run lint`
- `npm run web:build`
- `npm test`
- `npm run build`

二次视觉验证截图：

- `docs/reviews/assets/settings-ai-light-review-2026-04-13.png`
- `docs/reviews/assets/settings-ai-dark-review-2026-04-13.png`
- `docs/reviews/assets/maintenance-light-full-review-2026-04-13.png`
- `docs/reviews/assets/maintenance-dark-full-review-2026-04-13.png`

最终结论：

- 当前前端已经基本收敛到 `docs/research/niracler-design.md` 的目标语气
- 剩余问题如果还有，也更偏局部组件 polish，而不是系统级风格分裂
