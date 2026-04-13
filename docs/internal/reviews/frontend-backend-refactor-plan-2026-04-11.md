# 前后端重构与交互优化执行计划

日期：`2026-04-11`

状态：`planning only`

这份文档记录的是**后续准备执行的重构与优化计划**，不是“当前代码已经这样运行”的事实说明。

如果要确认现在系统到底怎么跑，请优先看：

- `README.md`
- `docs/spec/system-design.md`
- `docs/spec/web-tui-local-api-design.md`
- `docs/spec/cli-api-ui.md`
- `docs/internal/spec/status-and-pipeline-review.md`

---

## 1. 这份计划的目标

这轮计划不再讨论“产品要不要做这些能力”，而是聚焦四件事：

1. 把前端页面职责收紧，避免继续把交互、数据、流程控制堆进单页大文件。
2. 把后端核心模块拆回清晰边界，避免 `manager / provider / database / config` 继续膨胀。
3. 把用户交互逻辑改成更稳定、可预测、任务导向的结构。
4. 把 Web 视觉系统收敛成一套更统一的控制台语言，而不是页面各自长成不同气质。

---

## 2. 已确认的硬约束

下面这些不是待讨论项，而是本轮后续执行必须遵守的前提。

### 2.1 自动改名主判定逻辑不改

当前自动改名判定继续只看：

- `dirty`
- `idle`
- `frozen`
- `cooldown`
- `max_auto_renames_per_session`

这部分行为已经定了，后续重构不应重新引入旧 gate，也不应把已移除的旧字段重新接回主判定。

### 2.2 旧配置不再兼容

已经移除的旧配置语义，不再保留“可读但不推荐”的兼容层。

后续所有文档、UI、配置写入、运行时视图，都按最新模型工作。

### 2.3 `Transcript` 默认只看 `user` 是刻意设计，保留

这一点已经明确：

- `Transcript` 默认 role 过滤为 `user`
- 设计目的不是“完整追踪”，而是更快区分不同会话在说什么
- 因此它**不应**被当成当前问题项来改掉

后续如果要优化 transcript，方向应是：

- 保留默认 `user`
- 再补更顺手的快捷切换，例如 `User focus / Full trace`
- 或把当前过滤状态做得更明显，避免用户误解

而不是直接把默认值改成 `all`

### 2.4 这轮不把 CLI smoke tests 作为主线

CLI 可以继续维持当前状态。

后续阶段的验证仍以：

- `npm run lint`
- `npm run build`
- `npm run build:runtime`
- `npm run web:build`
- `npm test`

为主，不把 CLI 冒烟补齐作为本轮阻塞项。

---

## 3. 当前问题总图

## 3.1 前端结构问题

当前 Web 端已经出现明显的中心化膨胀：

- `packages/web/src/App.tsx`
- `packages/web/src/useControlDeckState.ts`
- `packages/web/src/useControlDeckResources.ts`
- `packages/web/src/SettingsPanel.tsx`
- `packages/web/src/RenameOpsPanel.tsx`
- `packages/web/src/SessionBrowser.tsx`

主要问题不是“代码风格不好”，而是职责混在一起：

- 壳层布局
- tab 切换
- pane 管理
- 拉数
- 轮询
- action 编排
- error / notice
- 页面业务逻辑
- 视觉输出

都同时存在。

结果就是：

- 后续每加一个交互，都会优先改大文件
- 页面越来越依赖全局状态中心
- 单点回归风险越来越高

## 3.2 后端结构问题

当前后端的主要膨胀点：

- `packages/core/src/manager.ts`
- `packages/core/src/provider.ts`
- `packages/core/src/database.ts`
- `packages/core/src/config.ts`
- `packages/api/src/app.ts`

它们各自已经跨了不止一层职责。

例如：

- `manager.ts` 同时做扫描、命名编排、维护、概览、provider 测试、配置更新、后台 sweep
- `provider.ts` 同时做 prompt 构建、provider 解析、HTTP 调用、stream 解析、诊断
- `database.ts` 同时做 repository、统计查询、维护状态管理
- `config.ts` 同时做默认值、normalize、merge、write、view
- `api/app.ts` 同时写所有路由和参数解析

## 3.3 交互逻辑问题

当前最值得优化的不是某个按钮文案，而是三类逻辑边界：

1. **搜索与筛选的边界**
   - API 已支持较完整筛选
   - Web sessions 目前仍偏前端本地过滤
   - 前后端职责不够统一

2. **刷新与同步的边界**
   - 页面轮询和事件刷新存在叠加
   - 后续资源更多时，请求会变得不稳定

3. **设置编辑与即时预览的边界**
   - settings 里的 prompt preview 和 provider test 已经有价值
   - 但“编辑态”和“验证态”还没有彻底分开

## 3.4 视觉问题

当前 Web 的暖色调方向本身没问题，但页面风格还没有完全统一：

- sidebar 偏深色工作台
- settings 偏 hero 化 control surface
- rename ops 偏 observability dashboard
- daemon 页又带一点运行时说明页气质

这会让整体更像几个还算顺眼的子系统拼在一起，而不是一个统一的产品界面。

---

## 4. 执行原则

后续真正开工时，统一按下面几条推进。

### 4.1 先拆边界，再改样式

优先级顺序：

1. 先把职责拆开
2. 再把交互整理清楚
3. 最后再统一视觉细节

不要一边保留大文件结构，一边往上叠 UI polish。

### 4.2 先做“最能减少膨胀”的改动

优先做会降低后续维护成本的工作：

- 拆大文件
- 抽公共状态层
- 明确 API / UI 边界
- 抽公共视图模型

不要先做边缘的色彩或微动画调整。

### 4.3 每一阶段都要能单独验证

每个阶段要尽量做到：

- 改动边界清楚
- 可以独立 review
- 可以单独回滚
- 可以单独通过验证命令

### 4.4 保留已有正确设计，不为了“看起来更标准”乱改

例如：

- `Transcript` 默认 `user`
- 自动改名主判定逻辑
- 去掉旧配置兼容

这些已经确认，就不因为“常见做法”而回退。

---

## 5. 总体工作流拆分

建议把后续工作拆成 6 条主线，每条主线可以再拆成独立 JJ change。

1. Web 壳层与状态拆分
2. Sessions 交互与搜索边界整理
3. Settings / Rename Ops / Daemon 页面拆分
4. Core 服务边界重构
5. Local API 路由拆分
6. 视觉系统统一与前端性能收敛

下面按阶段展开。

---

## 6. Phase 1：Web 壳层与状态拆分

目标：先把 Web 的大壳拆开，让后面的交互优化有稳定落点。

### 6.1 要解决的问题

当前：

- `App.tsx` 同时承担 sidebar、pane、tab、lazy panel、notice、copy action、尺寸持久化
- `useControlDeckState.ts` 同时承担动作编排和跨页面 UI 状态
- `useControlDeckResources.ts` 同时承担资源加载、轮询、事件同步、选择逻辑修正

### 6.2 预期结果

把 Web 拆成三层：

#### A. shell 层

只负责：

- app frame
- sidebar rail
- tab 容器
- pane resize / collapse
- notice banner

建议新增目录：

- `packages/web/src/app-shell/`

建议拆出的组件：

- `AppShell.tsx`
- `SidebarRail.tsx`
- `TopNoticeBanner.tsx`
- `PaneLayout.tsx`

#### B. state / resources 层

只负责：

- URL state
- selected session / workspace / request log
- resources cache
- refresh / poll / event invalidation

建议新增目录：

- `packages/web/src/state/`
- `packages/web/src/resources/`

建议拆出的模块：

- `useAppUiState.ts`
- `useSessionResources.ts`
- `useSettingsResources.ts`
- `useRuntimeResources.ts`
- `useEventsInvalidation.ts`

#### C. actions 层

只负责：

- suggest / apply / freeze
- save config
- replay requeue
- daemon start / stop

建议新增目录：

- `packages/web/src/actions/`

### 6.3 这一阶段的文件落点

重点会改：

- `packages/web/src/App.tsx`
- `packages/web/src/useControlDeckState.ts`
- `packages/web/src/useControlDeckResources.ts`
- `packages/web/src/control-deck-model.ts`

重点会新增：

- `packages/web/src/app-shell/*`
- `packages/web/src/state/*`
- `packages/web/src/resources/*`
- `packages/web/src/actions/*`

### 6.4 阶段完成标准

- `App.tsx` 变成接近纯装配层
- resource hooks 不再同时承担太多页面逻辑
- action 编排与资源拉取分离
- 行为不变

---

## 7. Phase 2：Sessions 交互与搜索边界整理

目标：把 sessions 页改成更稳定的浏览流，但保留 `Transcript` 默认 `user` 这一设计。

### 7.1 要解决的问题

#### 问题 A：搜索边界不统一

当前 sessions 搜索更偏前端本地过滤，而 API 自身已经具备更完整的筛选能力。

这会导致：

- 用户理解成本高
- URL 状态不稳定
- 会话规模增大后前端成本升高

#### 问题 B：`Transcript` 默认过滤虽合理，但需要降低误解

因为默认是 `user`，后续需要让用户更容易看懂：

- 这是“聚焦模式”而不是“完整 trace”
- 怎样快速切到全量视图

### 7.2 计划动作

#### A. 统一 sessions 搜索和筛选边界

建议把 sessions 页改成：

- Web 负责输入、debounce、URL
- API 负责搜索、筛选、排序
- 页面只负责渲染和交互反馈

这部分需要同步审视：

- `packages/web/src/SessionBrowser.tsx`
- `packages/web/src/useControlDeckResources.ts`
- `packages/web/src/control-deck-model.ts`
- `packages/web/src/api.ts`
- `packages/api/src/app.ts`

#### B. 保留 transcript 默认 `user`，补一层显式模式说明

这一项不是改默认值，而是补足语义表达。

建议方向：

- 把当前 role 过滤包装成更容易理解的模式入口
- 例如：
  - `User focus`
  - `Full trace`
- 或保留 role chips，但在默认态显式标出当前是 `user`

#### C. 整理 sessions 详情区的信息优先级

建议重新收紧右侧顺序：

1. session title + metadata
2. primary action
3. transcript / naming 切换
4. transcript 或 rename history 主体

避免 header 区塞太多并列按钮和状态标签。

### 7.3 阶段完成标准

- sessions 搜索边界清楚
- URL 可以稳定表达当前 sessions 视图
- transcript 默认 `user` 仍保留
- 但用户不再容易误以为系统只加载了 `user`

---

## 8. Phase 3：Settings / Rename Ops / Daemon 页面拆分

目标：把三个大页面从“单文件大面板”改成“任务导向的 section 组合”。

## 8.1 Settings

### 当前问题

- `SettingsPanel.tsx` 超大
- 同时包含 hero、导航、draft、provider test、prompt preview、runtime summary、各 section UI
- 编辑和验证逻辑耦合很紧

### 计划动作

建议拆成：

- `features/settings/SettingsPage.tsx`
- `features/settings/sections/OverviewSection.tsx`
- `features/settings/sections/NamingSection.tsx`
- `features/settings/sections/AiProviderSection.tsx`
- `features/settings/sections/SchedulerSection.tsx`
- `features/settings/sections/RuntimeSection.tsx`
- `features/settings/hooks/useSettingsDraft.ts`
- `features/settings/hooks/usePromptPreviewController.ts`

### 额外优化点

- 区分“编辑态”和“验证态”
- prompt preview 改成更稳的刷新策略
- provider test 保持显式触发，不做隐式过度联动

## 8.2 Rename Ops

### 当前问题

- `RenameOpsPanel.tsx` 同时承担概览、图表、请求日志、详情、doctor 信息
- 首屏还是偏复杂
- 图表和日志的存在感高于“下一步动作”

### 计划动作

把页面改成三层：

1. `summary strip`
   - 是否在跑
   - 积压是否异常
   - rule backlog
   - AI 请求异常

2. `primary actions`
   - 去 requeue
   - 刷新 runtime
   - 载入候选名
   - 打开请求详情

3. `advanced diagnostics`
   - 图表
   - request logs
   - raw doctor

建议拆分：

- `features/runtime/RenameOpsPage.tsx`
- `features/runtime/sections/OpsSummarySection.tsx`
- `features/runtime/sections/OpsActionsSection.tsx`
- `features/runtime/sections/OpsChartsSection.tsx`
- `features/runtime/sections/RequestLogsSection.tsx`
- `features/runtime/sections/RequestLogDetail.tsx`
- `features/runtime/sections/DoctorSection.tsx`

## 8.3 Daemon

### 当前问题

- `DaemonPanel.tsx` 已经比以前更聚焦，但仍混有较多解释性文案
- 技术信息和用户关心的信息还没有完全分层

### 计划动作

把 daemon 页固定成：

1. 运行态摘要
2. 当前队列摘要
3. 启停动作
4. 技术细节折叠区

建议拆分：

- `features/daemon/DaemonPage.tsx`
- `features/daemon/sections/DaemonStatusCard.tsx`
- `features/daemon/sections/DaemonQueueCard.tsx`
- `features/daemon/sections/DaemonTechnicalDetails.tsx`

### 阶段完成标准

- 这三个页面不再依赖单个 1500+ 行组件
- 首屏更任务导向
- 页面间 header / section / disclosure 结构统一

---

## 9. Phase 4：Core 服务边界重构

目标：把核心逻辑从几个大总管文件拆回明确服务。

## 9.1 `manager.ts`

### 当前职责过多

当前已经覆盖：

- scan
- suggest / apply / rename
- overview / doctor
- config update
- provider test
- prompt preview
- requeue
- auto sweep

### 计划拆法

先把 `manager.ts` 降级为 façade，内部组合以下服务：

- `SessionScanService`
- `RenameCommandService`
- `RenameMaintenanceService`
- `RuntimeOverviewService`
- `ConfigRuntimeService`
- `PromptPreviewService`

## 9.2 `provider.ts`

建议拆成：

- `provider/prompt-builder.ts`
- `provider/profile-resolver.ts`
- `provider/http-transport.ts`
- `provider/stream-parser.ts`
- `provider/provider-probe.ts`

## 9.3 `database.ts`

建议拆成：

- `repository/session-repository.ts`
- `repository/rename-repository.ts`
- `repository/request-log-repository.ts`
- `repository/maintenance-state-repository.ts`
- `query/overview-query-service.ts`

## 9.4 `config.ts`

建议拆成：

- `config/defaults.ts`
- `config/normalize.ts`
- `config/load.ts`
- `config/write.ts`
- `config/view.ts`

### 阶段完成标准

- 各核心文件职责下降
- 主要逻辑仍然可通过现有测试验证
- 结构上更贴近 `docs/spec/repo-layout-and-standards.md` 的目标边界

---

## 10. Phase 5：Local API 路由拆分

目标：把 `packages/api/src/app.ts` 从单文件路由中心拆成模块化 router。

### 10.1 当前问题

`app.ts` 里已经同时定义：

- sessions
- transcript
- batch apply
- overview
- daemon
- config
- provider
- maintenance
- doctor
- prompt preview

### 10.2 计划拆法

建议目录：

- `packages/api/src/routes/sessions.ts`
- `packages/api/src/routes/providers.ts`
- `packages/api/src/routes/config.ts`
- `packages/api/src/routes/runtime.ts`
- `packages/api/src/routes/maintenance.ts`
- `packages/api/src/routes/daemon.ts`
- `packages/api/src/lib/query.ts`
- `packages/api/src/lib/errors.ts`

### 10.3 完成标准

- `buildApiServer()` 只做 app 装配和依赖注入
- query parse / error mapping / route registration 分离
- API 契约不变

---

## 11. Phase 6：视觉系统统一与前端性能收敛

目标：在边界已经拆清后，再做统一视觉和 bundle 收敛。

## 11.1 视觉统一

建议统一的不是“风格口号”，而是以下几件具体东西：

### A. 页面 header 规格

统一：

- kicker
- h2 / h3 层级
- summary 文案长度
- action 按钮密度

### B. 卡片与 section 规格

统一：

- border radius
- shadow
- padding
- section gap
- disclosure 展开方式

### C. 文案语气

需要清掉的方向：

- 过度设计说明感
- 不稳定的品牌化旁白
- 太像设计稿/作品集的副标题

重点要保留的方向：

- 状态
- 风险
- 结果
- 下一步动作

### D. 字体策略

建议最终方向：

- UI 主字体用正常 sans
- monospace 只保留给 ID、payload、日志、代码、表格中需要对齐的字段

## 11.2 性能收敛

当前 `web:build` 仍有大 chunk warning。

这部分建议在前面结构拆分完成后再处理：

- 更细的 lazy import
- 图表区按需加载
- request log detail 延迟加载
- settings 的 prompt / raw payload / diagnostics 区域只在需要时装载

### 完成标准

- 主页面风格统一
- 首屏信息密度更稳
- 大 chunk 警告下降或至少显著缓解

---

## 12. 建议的 JJ change 切分

为了保证 review 和回滚都可控，建议后续按下面的 change 粒度推进。

### Change 1：Web shell / state 拆分

只做：

- `App.tsx`
- `useControlDeckState.ts`
- `useControlDeckResources.ts`
- 新增 shell / state / resources / actions 目录

### Change 2：Sessions 交互整理

只做：

- `SessionBrowser.tsx`
- `TranscriptPanel.tsx`
- sessions search / URL / API 对齐

注意：

- 保留 transcript 默认 `user`

### Change 3：Settings 拆分

只做：

- `SettingsPanel.tsx`
- settings 子 section
- prompt preview 控制器

### Change 4：Rename Ops / Daemon 拆分

只做：

- `RenameOpsPanel.tsx`
- `DaemonPanel.tsx`
- 对应子 section / advanced disclosure

### Change 5：Core 服务边界重构（第一轮）

只做：

- `manager.ts`
- `provider.ts`
- `database.ts`
- `config.ts`

优先拆出服务与子模块，不在这一轮顺手改产品行为。

### Change 6：API 路由拆分

只做：

- `packages/api/src/app.ts`
- `packages/api/src/routes/*`
- 共用 parse / error helper

### Change 7：视觉系统与性能收敛

只做：

- `styles.css`
- 页面 header / card 统一
- 更细粒度 lazy load
- bundle 观察

---

## 13. 每阶段验证标准

每个 change 完成后都至少跑：

```bash
npm run lint
npm run build
npm run build:runtime
npm run web:build
npm test
```

说明：

- 当前不把 CLI smoke tests 作为这轮阻塞项
- 如果某个 change 只是文档或纯样式，也至少应跑与该 change 相符的最小必要验证
- 只有在阶段性的稳定点，才跑完整链路

---

## 14. 暂不做的事情

下面这些不作为本轮主计划的一部分：

- 重新设计自动改名语义
- 恢复任何旧配置兼容
- 把 Local API 改成远程多用户服务
- 给 Web 强行补手动 rename 主按钮
- 把 Transcript 默认值改成 `all`
- CLI 大范围重写

---

## 15. 最终验收口径

这轮全部完成后，理想状态应该是：

### 结构上

- Web 不再依赖几个超大页面和超大 hooks
- Core 不再由 `manager / provider / database / config` 四个大文件继续吸纳职责
- API 层成为装配层，不再是超大单文件路由中心

### 交互上

- sessions 浏览逻辑更稳定
- settings 编辑与验证更清楚
- rename ops / daemon 更任务导向
- transcript 默认 `user` 设计被保留，但表达更清晰

### 视觉上

- 页面风格统一
- header / section / card 规格统一
- 文案从“设计说明”收敛到“状态与动作”

### 工程上

- 每个阶段都能独立 review 和回滚
- 完整验证链可持续通过
- 后续继续加功能时，不再只能往大文件里堆

