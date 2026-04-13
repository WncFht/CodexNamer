# 前后端剩余重构与前端第二轮优化计划

日期：`2026-04-11`

状态：`implemented on 2026-04-11`

## 实施结果摘要

这份剩余计划已经按原分期落地，当前代码状态对应如下：

- **Phase A：Web 资源刷新收口**  
  `packages/web/src/useControlDeckResources.ts` 已降成 façade，资源刷新拆到 `packages/web/src/resources/*`，不再保留 tab 级和 events 级双 `5s` 主路径。

- **Phase B：Sessions / Sidebar / Transcript 收口**  
  `packages/web/src/SessionBrowser.tsx` 已降到 `219` 行，拆出：
  - `packages/web/src/features/sessions/SessionListPane.tsx`
  - `packages/web/src/features/sessions/SessionDetailHeader.tsx`
  - `packages/web/src/features/sessions/RenameHistoryPanel.tsx`

  同时 sidebar 宽度、密度、footer stats 已继续收轻；transcript 保留默认 `user focus`，但模式提示更明确。

- **Phase C：Settings 改成 edit-save-verify**  
  `packages/web/src/SettingsPanel.tsx` 已移除 hero 化首屏和输入时自动 prompt preview 刷新，改成紧凑 header + summary strip + 手动 preview 刷新控制器。

- **Phase D：Maintenance / Daemon 改成 action-first**  
  maintenance 首屏已改成 attention summary + actions first；图表下沉到折叠区。daemon 首屏已移除 hero，改成 runtime-first header + summary strip。

- **Phase E：Core manager / database 边界收口**  
  - `packages/core/src/manager.ts`：`1281 -> 570` 行  
    新增：
    - `packages/core/src/manager/session-scan-service.ts`
    - `packages/core/src/manager/rename-command-service.ts`
    - `packages/core/src/manager/maintenance-service.ts`
    - `packages/core/src/manager/runtime-overview-service.ts`
    - `packages/core/src/manager/config-runtime-service.ts`
    - `packages/core/src/manager/prompt-preview-service.ts`
    - `packages/core/src/manager/shared.ts`
  - `packages/core/src/database.ts`：`953 -> 396` 行  
    新增：
    - `packages/core/src/database/session-repository.ts`
    - `packages/core/src/database/rename-repository.ts`
    - `packages/core/src/database/maintenance-state-repository.ts`
    - `packages/core/src/database/overview-query-service.ts`
    - `packages/core/src/database/shared.ts`

- **Phase F：最终视觉统一**  
  settings / maintenance / daemon 三个后台页的 header 宽度、内容容器、summary 节奏进一步统一；首屏 badge / chip 用量继续下降。

上面这部分是当前已落地的状态摘要。

下面保留的是 **2026-04-11 当天实施前写下的原始剩余计划正文**，作为归档和对照材料：

- 如果正文里出现“还没做完 / 还没收口 / 建议后续改”的表述，它们描述的是**实施前状态**
- 当前真实状态以上面的“实施结果摘要”和仓库里的现行代码为准

这份文档原本只处理一件事：

- **上一份计划里还没有完全落地的部分，接下来应该怎么收尾**

它不是对当前实现的重新介绍，也不是新一轮“从零开始的大规划”。

如果要先看已经落地了什么，请先看：

- `docs/internal/reviews/frontend-backend-refactor-plan-2026-04-11.md`
- `docs/spec/web-tui-local-api-design.md`
- `docs/internal/spec/status-and-pipeline-review.md`

---

## 1. 实施前的原始结论（归档）

上一轮重构已经完成了第一大步，但还没有把整份计划完全做完。

当前状态更准确地说是：

- **API 路由拆分：基本完成**
- **Web 页面第一轮拆分：大部分完成**
- **视觉与性能第一轮收敛：大部分完成**
- **Core 第二轮服务边界重构：还没完成**
- **Web 资源刷新模型、Settings 编辑节奏、Sessions 产品化、Maintenance / Daemon 首屏任务化：还没完全收口**

这份文档的目的不是继续“加功能”，而是把剩下这些没收尾的结构和交互问题做完。

---

## 2. 这轮继续执行时必须保持不变的前提

### 2.1 自动改名主判定逻辑不改

主判定继续只看：

- `dirty`
- `idle`
- `frozen`
- `cooldown`
- `max_auto_renames_per_session`

后续重构不得把旧 gate 再接回主判定。

### 2.2 旧配置不再兼容

旧字段已经退出当前模型，后续不再为了“兼容旧配置”把它们保留成隐性有效输入。

### 2.3 Transcript 默认 `user` 保留

`Transcript` 默认只看 `user` 是刻意设计，不在后续计划里推翻。

后续如果还要优化 transcript，只能朝下面两个方向走：

- 更明确地提示当前处于 `user focus`
- 更顺手地切到 `full trace`

不能把默认值直接改成 `all`。

### 2.4 CLI smoke tests 继续不是主线

本轮收尾仍然以这条验证链为准：

- `npm run lint`
- `npm run build`
- `npm run build:runtime`
- `npm run web:build`
- `npm test`

---

## 3. 上一份计划里，哪些已经做了，哪些还没做完

## 3.1 已做完或基本做完

### A. API 路由拆分

当前：

- `packages/api/src/app.ts` 只有 `61` 行
- 路由已经拆到：
  - `packages/api/src/routes/sessions.ts`
  - `packages/api/src/routes/providers-config.ts`
  - `packages/api/src/routes/runtime.ts`
  - `packages/api/src/routes/maintenance.ts`
  - `packages/api/src/routes/daemon.ts`
  - `packages/api/src/routes/ai.ts`
  - `packages/api/src/routes/events.ts`

这部分已经可以视为完成，不再是剩余主问题。

### B. Web 页面第一轮拆分

当前：

- `packages/web/src/App.tsx`：`263` 行
- `packages/web/src/SettingsPanel.tsx`：`266` 行
- `packages/web/src/RenameOpsPanel.tsx`：`339` 行
- `packages/web/src/DaemonPanel.tsx`：`170` 行

并且已经拆出了：

- `packages/web/src/app-shell/*`
- `packages/web/src/actions/*`
- `packages/web/src/resources/*`
- `packages/web/src/features/settings/*`
- `packages/web/src/features/maintenance/*`
- `packages/web/src/features/daemon/*`

说明第一轮“大页面切块”已经做了，但这不等于展示层和资源层都已经彻底收口。

### C. 视觉与构建体积第一轮收敛

当前：

- `packages/web/src/styles.css` 已经把 UI 主字体改成 sans
- 维护页高级诊断已经 lazy load
- `packages/web/vite.config.ts` 已经做 chunk 收敛
- `npm run web:build` 已经没有此前的大 chunk warning

这说明“先把页面从粗糙 demo 拉到可用产品态”这一轮已经见效，但还没到可长期稳定维护的成熟状态。

## 3.2 还没做完的核心部分

### A. 资源刷新边界还没有收口

当前证据：

- `packages/web/src/useControlDeckResources.ts` 仍有 `595` 行
- `packages/web/src/useControlDeckResources.ts:429-455` 里仍对 `maintenance / requeue / daemon` 做 `5s` 定时轮询
- `packages/web/src/resources/useEventsInvalidation.ts:13-32` 里又额外每 `5s` 拉 `/events`
- `packages/web/src/useControlDeckResources.ts:507-540` 收到 event 后又会整组 `refreshCurrentView()`

这表示当前还是：

- 固定轮询一套
- event invalidation 再刷新一套

刷新策略重复，后续资源再加多之后会继续乱。

### B. Sessions 产品化还不够

当前证据：

- `packages/web/src/SessionBrowser.tsx` 仍有 `662` 行
- `packages/web/src/app-shell/SidebarRail.tsx` 仍然保留深色大 rail + 多行统计 footer
- `packages/web/src/control-deck-model.ts` 里 `SESSION_FILTERS_ENABLED = false`
- `packages/web/src/TranscriptPanel.tsx` 现在已经把 `user focus / full trace` 提示做出来了，这点是对的，但 Session 浏览页整体仍偏信息密集

当前不是“功能不能用”，而是：

- 会话列表元信息仍偏多
- 左侧 rail 仍偏重
- 搜索/筛选模型还留着半截历史设计
- 页面首屏主任务不够干净

### C. Settings 的编辑态和验证态还没彻底分开

当前证据：

- `packages/web/src/SettingsPanel.tsx:84-96` 仍然在 draft 变化后 `300ms` 自动刷新 prompt preview
- `packages/web/src/SettingsPanel.tsx` 顶部仍然是明显的 `settings-hero`
- 本地截图也说明 Settings 首屏还是“说明 + 指标 + 配置面”的组合，而不是一个更稳定的编辑面

这会导致：

- 用户改字段时，界面一直在“边编辑边验证”
- 编辑节奏偏粘手
- 首屏还是更像被美化过的配置台，而不是一个沉稳的设置界面

### D. Maintenance / Daemon 首屏还不够任务导向

当前证据：

- `packages/web/src/RenameOpsPanel.tsx` 虽然拆出来了，但当前首屏仍是 summary + chart first
- `packages/web/src/DaemonPanel.tsx` 仍然以 `DaemonHero` 开头
- 本地截图能看到：维护页首屏先给 sweep 指标和图，daemon 页首屏还是大标题 + 状态卡

这和 `better-frontend` 里后台/控制台页的要求还有差距：

- 首屏应该先回答“现在哪里有问题，我该点哪里”
- 图表应该是二级信息，不该天然占据首屏主位

### E. Core 第二轮分层还没做完

当前证据：

- `packages/core/src/manager.ts`：`1281` 行
- `packages/core/src/database.ts`：`953` 行
- `packages/core/src/provider.ts` 已经缩到 `270` 行
- `packages/core/src/config.ts` 已经缩到 `14` 行

说明：

- `provider / config` 第一轮已经基本收口
- 但 `manager / database` 仍然是两个继续吸纳职责的大中心

后续如果不继续拆：

- rename 编排、runtime 汇总、scan 流程还会继续堆到 `manager.ts`
- repository、统计查询、maintenance state 还会继续堆到 `database.ts`

---

## 4. 用 better-frontend 再看一轮，当前前端最值得继续优化的点

这一节不是泛泛说“还可以更好看”，而是按 `better-frontend` 的后台/控制台规则重新审一遍当前 Web。

核心判断：

- 当前前端已经脱离最粗糙的 demo 状态
- 但仍然有比较明显的 **hero 化后台、统计卡优先、badge 偏多、首屏任务线不够直、导航偏重** 的问题

## 4.1 Settings 仍然太像“带 hero 的高级配置面”

证据：

- `packages/web/src/SettingsPanel.tsx` 顶部仍然使用 `settings-hero`
- 页面首屏是：标题 + 说明文案 + 多个指标 + section 导航 + 配置面
- 本地截图中，真正的高频任务其实是改 naming / provider / scheduler，但首屏先给了一段较长说明和一排指标卡

问题：

- 后台设置页不需要 hero
- 用户的真实任务是“改配置、保存、验证”，不是先阅读一段页面叙述
- 统计卡在这里是辅助信息，不应该抢走首屏结构权重

建议：

- 把 Settings 顶部改成 **紧凑标题栏**：标题、保存状态、保存/重载按钮
- 把 overview 指标降成一行轻量 stat strip，或移到二级区域
- 命名策略区直接成为首屏主体

## 4.2 Maintenance 页仍然是图表先于动作

证据：

- `packages/web/src/RenameOpsPanel.tsx` 首屏主结构还是 overview + primary charts
- 本地截图中，两张大图直接占据首屏视觉中心

问题：

- 对真实用户来说，首要问题不是“趋势图长什么样”，而是：
  - 有没有 backlog
  - 有没有失败请求
  - 哪类 session 现在需要处理
  - 我要去 refresh preview、看日志，还是去 requeue
- 当前页面更像“可视化诊断板”，而不是“维护操作入口”

建议：

- 首屏改成 **attention summary + primary actions**
- 图表下沉到折叠区或二屏
- 首屏只保留少量真正支持决策的数字，不再默认两张大图开场

## 4.3 Daemon 页仍然带明显 hero 感

证据：

- `packages/web/src/DaemonPanel.tsx` 顶部还是 `DaemonHero`
- 本地截图中，标题区仍然占据明显视觉权重

问题：

- daemon 页本质是运行态页，不需要“先有大标题，再往下读”
- 用户真正需要的是：
  - daemon 是否在跑
  - 下一轮什么时候
  - backlog 是多少
  - 最近 sweep 是否正常
  - 启停按钮在哪里

建议：

- 改成 **status header**，而不是 hero
- 首屏横向排列：状态、下一轮、积压、启停按钮
- 技术细节与 PID 放到折叠区

## 4.4 左侧 Sidebar rail 依然偏重

证据：

- `packages/web/src/app-shell/SidebarRail.tsx` 仍然是深色整栏 + tab 按钮 + workspace 列表 + footer stats
- 本地截图中，左侧的视觉存在感仍然较强

问题：

- 它仍在和主内容争注意力
- footer stats 和 tab 区一起堆在 rail 内，让导航既像导航、又像监控栏

建议：

- 再收窄 rail 宽度
- footer stats 缩成更轻的两到三项，其他信息移出 sidebar
- tab 按钮压缩为更接近正常控制台导航的密度

## 4.5 Session 列表依然偏密

证据：

- `packages/web/src/SessionBrowser.tsx` 仍有 `662` 行
- 现有 session card 依然承载较多状态、时间、workspace、dirty 等元信息
- 旧审查 `docs/internal/reviews/frontend-design-audit-2026-04-05.md` 也已经指出 session 卡片重复和元信息密度过高

问题：

- 用户最关心的是：这条 session 是什么、需不需要处理、最近有什么变化
- 但卡片当前仍会让元信息比内容更抢眼

建议：

- 去掉默认重复 subtitle
- 把低价值 meta 收成单行 secondary text
- 用选中态和 dirty/frozen tone 表达状态，不靠更多行文字补偿

## 4.6 Badge / chip 仍然有点多

证据：

- maintenance、daemon、transcript、settings 里都大量使用 chip / badge / kind-pill
- 样式上虽然已经比之前稳，但“哪里都能看到 pill”这一点仍然存在

问题：

- 控制台页如果 badge 太多，会很容易产生 dashboard kit 感
- 很多状态其实可以由位置、颜色和简短文案承担，不一定都要再包一层 pill

建议：

- 只保留真正需要快速扫读的状态 badge
- 把纯说明性的 chip 降成次级文本
- transcript 里减少 `kind-pill` 的视觉重量

## 4.7 内容容器仍然偏宽，留白节奏还不够稳

证据：

- `packages/web/src/styles.css:1065-1128` 里 Settings 已经限制到 `1180px`
- 但本地截图里，页面右侧主体仍然偏宽，尤其 Settings 和 Daemon 页会显得“上方内容很实，下方内容很空”

问题：

- 并不是越宽越高级
- 控制台页如果主任务不够集中，过宽会把信息拉散

建议：

- Settings 主编辑区进一步收窄或采用更稳定的主列 + 次列结构
- Daemon / Maintenance 首屏用更强的内容对齐，减少“上面信息块，下面大片空白”的观感

---

## 5. 剩余实现计划

下面这部分是**真正建议继续执行的剩余 plan**。

## 5.1 Phase A：收口 Web 资源层和刷新模型

目标：先把“刷新逻辑重复”这个结构问题彻底解决。

### 当前问题

- `useControlDeckResources.ts` 还承担了太多资源协调职责
- tab 轮询与 `/events` 轮询并存
- 收到 event 后仍然做整组刷新

### 执行方向

1. 把 `useControlDeckResources.ts` 再拆一轮，至少拆成：
   - `useSessionResourceStore`
   - `usePanelResourceStore`
   - `usePromptPreviewResource`
   - `useRefreshCoordinator`
2. 明确刷新模型，只保留一套主路径：
   - **以 event invalidation 为主**
   - 固定轮询只作为兜底，不再每个 tab 都 `5s` 整页拉数
3. 把“当前页面需要哪些资源”的声明继续收口，避免 `loadResources()` 继续成长成万能入口
4. 对 prompt preview 做单独节流，不再混入通用刷新路径

### 预期结果

- `useControlDeckResources.ts` 不再是 `595` 行的大中心
- 页面刷新来源可解释：是事件驱动，还是兜底刷新
- maintenance / daemon / requeue 不再和 events 形成双刷新

### 通过标准

- 不再存在“tab 定时刷新 + events 定时刷新”双 `5s` 重叠路径
- `useControlDeckResources.ts` 收敛到明显更小，或只保留 façade
- `sessions / overview / daemon / doctor / ai-request-logs / preview / prompt-preview` 各自有更清晰的资源边界

## 5.2 Phase B：把 Sessions 做成更成熟的工作台入口

目标：不是再加更多筛选，而是把 sessions 入口做得更像真实工作区。

### 当前问题

- 会话列表仍偏密
- sidebar 仍偏重
- `SESSION_FILTERS_ENABLED = false` 说明旧筛选模型还留着半截

### 执行方向

1. 把 `SESSION_FILTERS_ENABLED` 这类半停用状态清掉，明确当前支持的过滤模型：
   - `search`
   - `workspace`
   - `selected session`
   - `show hidden transcript`
2. 继续精简 `SessionBrowser.tsx`：
   - 抽出 `SessionListPane`
   - 抽出 `SessionDetailHeader`
   - 抽出 `RenameHistoryPanel`
3. 精简 session card：
   - 标题优先
   - secondary text 只保留一行
   - dirty/frozen/selected 主要靠 tone、icon、位置表达
4. 收窄 `SidebarRail`：
   - 减少 footer stats
   - 降低视觉对比
   - 让主内容更像真正的第一焦点
5. `TranscriptPanel` 保持默认 `user`，但进一步强化当前模式提示

### 预期结果

- Web 首屏更像“浏览和处理 session 的入口”
- 导航和统计不再压住主内容
- session 列表信息密度更合理

### 通过标准

- `SessionBrowser.tsx` 明显继续缩小，或转成 façade
- 默认列表卡片不再出现多行重复 meta
- sidebar footer 不再像一个小型监控面板

## 5.3 Phase C：把 Settings 从“解释型配置页”收成“编辑-保存-验证”界面

目标：让 Settings 更像正式产品设置页，而不是 hero 化 control surface。

### 当前问题

- 页面顶部仍然 hero 化
- prompt preview 还在跟着输入自动刷
- 指标卡和文案仍然占首屏较大面积

### 执行方向

1. 去掉 `settings-hero` 结构，改成 **紧凑 header**：
   - 标题
   - 当前 dirty 状态 / last saved
   - 保存 / 重载
2. 引入专门的 `usePromptPreviewController`：
   - 编辑阶段只维护 draft
   - 手动刷新 preview
   - 或在明确停顿后再刷新，但不再所有改动都自动触发
3. 把 Settings 按用户任务重排：
   - `Naming` 作为主入口
   - `AI Provider` 放在次一级
   - `Scheduler / Runtime / Overview` 下沉为 supporting sections
4. 减少首屏指标卡，把 overview 降级为次级信息
5. 对 provider test / prompt preview / parse codex provider 做更明确的“验证动作区”

### 预期结果

- 用户感知变成：先改，再保存，再验证
- 页面不再像配置说明页
- 首屏直接服务高频设置任务

### 通过标准

- `SettingsPanel.tsx` 不再渲染 hero 化首屏
- prompt preview 刷新逻辑和普通 draft 编辑逻辑分开
- 大屏下内容宽度和节奏更稳定

## 5.4 Phase D：把 Maintenance / Daemon 改成 action-first，而不是 chart-first

目标：把“运维可视化面板”改成“可直接采取动作的维护页”。

### 当前问题

- Maintenance 首屏先给图
- Daemon 首屏先给 hero
- 真正的动作入口还不够集中

### 执行方向

1. Maintenance 页首屏重排成：
   - `需要关注的事项`
   - `主动作入口`
   - `关键状态摘要`
   - 图表下沉到二级区
2. 主动作入口明确化：
   - 刷新 preview
   - 打开 request logs
   - 去 requeue
   - 打开 doctor
3. Daemon 页首屏改成：
   - 运行状态
   - 下一轮时间
   - backlog / pending
   - 启停按钮
4. 把 `DaemonTechnicalDetails` 与高级诊断进一步压到折叠区
5. 图表只保留真正支持决策的那几张，不再把“有图就摆出来”当默认策略

### 预期结果

- 维护页更像处理问题的工作台
- daemon 页更像运行态控制页
- 用户看完首屏就知道下一步去哪里

### 通过标准

- maintenance 首屏不再默认两张大图占主要视觉面积
- daemon 首屏不再使用 hero 结构
- 高级诊断默认不抢首屏

## 5.5 Phase E：做 Core 第二轮边界收口

目标：把还在继续膨胀的 `manager / database` 收回来。

### 当前问题

- `manager.ts` 仍然 `1281` 行
- `database.ts` 仍然 `953` 行

### 执行方向

1. `manager.ts` 至少拆成：
   - `session-scan-service.ts`
   - `rename-command-service.ts`
   - `runtime-overview-service.ts`
   - `maintenance-service.ts`
   - `manager.ts` 只保留 façade 和装配
2. `database.ts` 至少拆成：
   - `session-repository.ts`
   - `rename-repository.ts`
   - `maintenance-state-repository.ts`
   - `overview-query-service.ts`
3. 把“写模型”和“报表查询”进一步分开，避免 repository 和 report 混在一起继续长
4. 控制 façade 文件体量，只负责导出和装配

### 预期结果

- core 的大文件不再继续充当系统垃圾桶
- 后续加维护逻辑或新统计项，不需要直接进 `manager.ts` / `database.ts`

### 通过标准

- `manager.ts` 和 `database.ts` 都明显缩小
- 新增职责落到对应 service / repository / query 模块，而不是继续回流到 façade

## 5.6 Phase F：做最后一轮视觉统一

目标：不是再追求“更像设计稿”，而是把现有产品态收成更稳定的控制台语言。

### 当前问题

- settings / maintenance / daemon 仍各有一套首屏节奏
- chip / badge 仍偏多
- sidebar 仍偏重
- 页面内容宽度与留白节奏还不够统一

### 执行方向

1. 统一所有后台页 header 规格：
   - 标题层级
   - 工具按钮位置
   - 简短状态说明
2. 收紧 radius / shadow / surface 层级，不让每个页面都像单独设计过
3. 减少 badge / chip 的默认使用频率
4. 收窄主内容宽度，让重要信息更聚焦
5. 让“状态色”和“布局位置”承担更多分层职责，少靠 pill 堆信息

### 通过标准

- settings / maintenance / daemon 三个页面的 header 节奏统一
- 首屏都能在不依赖大段副文案的前提下成立
- sidebar 与主内容之间的主次关系更稳定

---

## 6. 建议的 JJ change 切分

为了避免又做成一个巨型 change，建议按下面切：

1. `refactor(web): split resources and unify refresh invalidation`
2. `refactor(web): simplify session browser and sidebar density`
3. `refactor(web): turn settings into edit-save-verify surface`
4. `refactor(web): make maintenance and daemon action-first`
5. `refactor(core): split manager services and runtime helpers`
6. `refactor(core): split database repositories and report queries`
7. `style(web): converge console headers spacing and chip usage`
8. `docs: refresh specs after remaining refactor work`

规则：

- 每个 change 都要有清晰验证边界
- 先做结构，再做视觉
- 不要把 core 拆分和大面积 CSS 调整混在同一个 change 里

---

## 7. 这轮剩余计划的验证要求

## 7.1 命令验证

每个准备 push 的阶段都要跑：

- `npm run lint`
- `npm run build`
- `npm run build:runtime`
- `npm run web:build`
- `npm test`

## 7.2 视觉验证

继续至少做这些页面截图检查：

- Sessions 首屏
- Settings 首屏
- Maintenance 首屏
- Daemon 首屏

检查点不是“好不好看”这么空，而是：

- 是否还存在 hero 化后台首屏
- 首屏是否先给动作和状态，而不是先给装饰和图表
- sidebar 是否仍然压主内容
- session card 是否仍然元信息过密
- settings 是否仍然像边编辑边自动验证

## 7.3 结构验证

每完成一个阶段，都要检查对应大文件是否真的变小、边界是否真的变清楚。

建议作为软目标观察：

- `useControlDeckResources.ts`：降到 `300` 行以内或转成 façade
- `SessionBrowser.tsx`：降到 `450` 行以内或转成 façade
- `manager.ts`：降到 `900` 行以内或转成 façade
- `database.ts`：降到 `700` 行以内或转成 façade

这些数字不是绝对法律，但如果做完后体量还和现在几乎一样，通常就说明拆分并没有真正完成。

---

## 8. 最终验收口径

只有同时满足下面这些条件，这份“剩余计划”才算真正做完：

1. Web 不再同时依赖两套并行的 `5s` 刷新主路径
2. Sessions 首屏变成更成熟的工作台入口，而不是高密度信息列表
3. Settings 不再是 hero 化配置页，而是更明确的编辑-保存-验证界面
4. Maintenance / Daemon 首屏都先给动作和状态，不再先给大图或大标题
5. `manager.ts / database.ts` 不再继续充当职责垃圾桶
6. 三个主要后台页在 header、密度、badge 使用、内容宽度上有统一语言

做到这一步，才可以说：

- 上一份计划剩余未落地的部分，已经基本收尾
- 前端已经从“第一轮可用产品态”，进入“更成熟、更稳定的长期维护态”
