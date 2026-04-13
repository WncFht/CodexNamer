 # Biome 全量迁移计划与落地记录

 日期：`2026-04-13`

 状态：`implemented`

 `2026-04-13` 这次迁移已经执行完成。

 当前真实状态仍然是：

 - 根仓库通过 `biome.json` 使用 Biome
 - `npm run format` 通过 `biome format --write .` 提供
 - `npm run lint` / `npm run lint:fix` 通过 Biome 提供
 - pre-commit 仍通过 `lefthook` 触发 `npm run lint`
 - `eslint.config.mjs` 已删除

 如果只想确认“现在仓库是怎么工作的”，请优先看：

 - `package.json`
 - `biome.json`
 - `lefthook.yml`

 下文保留的是这次迁移在执行前形成的计划与判断过程，作为维护记录，不再代表仓库当前状态。

 ---

 ## 1. 迁移目标

 这次迁移的目标不是“顺便换个工具”，而是把仓库的代码质量入口统一成一套更简单的链路：

 1. 用 **Biome** 同时承担 formatter、imports 整理、lint 检查。
 2. 完整移除 **ESLint** 及其相关依赖和配置文件。
 3. 保留现有对外命令习惯：
    - `npm run lint`
    - `npm run lint:fix`
    - `npm run validate:full`
 4. 让 Web、TUI、Node runtime、测试文件都进入同一套检查口径。
 5. 在不降低现有 TypeScript 严格度的前提下，减少维护两套风格工具的成本。

 这次迁移的最终目标是**完全切换到 Biome**，而不是长期维持 ESLint + Biome 混合模式。

 ---

 ## 2. 非目标

 下面这些不属于这次迁移的直接目标：

 - 不改 TypeScript 编译选项，不放宽 `strict` 系列约束
 - 不改 `build` / `test` / `web:build` 的构建流程
 - 不顺手重构业务代码边界
 - 不因为参考仓库使用了 Husky，就强制把当前的 Lefthook 一并替换掉
 - 不把“修全部历史风格问题”当成独立目标，优先通过 Biome 自动修复和小范围人工收口完成迁移

 换句话说，这次要改的是**代码质量基础设施**，不是整个工程工作流。

 ---

 ## 3. 当前仓库状态摘要

 基于当前仓库现状，迁移前的事实大致如下：

 ### 3.1 根脚本

 当前根 `package.json` 里：

 - `lint = eslint . --cache --max-warnings=0`
 - `lint:fix = eslint . --cache --fix`
 - `validate:full` 会先跑 `npm run lint`

 这意味着 lint 已经是 CI 级入口，而不是可选附加命令。

 ### 3.2 现有 ESLint 规则职责

 当前 `eslint.config.mjs` 主要承担这些职责：

 - JS / TS / TSX 的基础语义检查
 - React hooks 规则
 - browser / node / test globals 区分
 - TypeScript unused vars 检查
 - `consistent-type-imports`
 - 若干有意放宽的例外，例如：
   - `@typescript-eslint/no-explicit-any = off`
   - `no-control-regex = off`
   - `react-hooks/exhaustive-deps` 只在 Web 包开启

 ### 3.3 Hook 流程

 当前 `lefthook.yml`：

 - `pre-commit` 跑 `npm run lint`
 - `pre-push` 跑 `npm run validate:full`

 也就是说，迁移后不能只保证“本地能跑”，还要保证 hook 口径仍成立。

 ### 3.4 风格工具现状

 当前仓库没有独立的 Prettier 配置，格式化职责并没有被一套统一工具显式接管。

 这也是 Biome 值得引入的重要原因之一：它不是只替掉 ESLint，而是顺手补齐 formatter 入口。

 ---

 ## 4. 参考仓库口径：借鉴什么，不借鉴什么

 本轮会参考 `niracler/bokushi` 的方向，但不机械照抄。

 可以借鉴的点：

 - 用 `biome check .` 作为主 lint 入口
 - 用 `biome format --write .` 作为主 format 入口
 - 用单一工具统一格式化和 lint

 不应直接照搬的点：

 - bokushi 是 Astro 站点，当前仓库是 TypeScript monorepo
 - bokushi 使用 4 空格缩进；当前仓库约定是 2 空格
 - bokushi 的 CSS / Astro / Tailwind 语境和当前仓库不同
 - bokushi 用 Husky / lint-staged；当前仓库已经有 Lefthook，是否切换应单独决定

 本项目要借鉴的是**工具统一思路**，不是逐行复制它的 `biome.json`。

 ---

 ## 5. 迁移后的目标形态

 执行完成后，仓库应收敛到下面这个状态：

 ### 5.1 根配置

 根目录新增：

 - `biome.json`

 根目录移除：

 - `eslint.config.mjs`

 ### 5.2 根脚本

 根 `package.json` 预期收敛为类似下面的口径：

 - `format = biome format --write .`
 - `lint = biome check .`
 - `lint:fix = biome check --write .`

 说明：

 - `lint` 继续保留只读检查语义
 - `lint:fix` 统一承担自动修复 + 格式化 + import 整理
 - `validate:full` 仍然从 `npm run lint` 进入，不改外部调用习惯

 ### 5.3 Hook 入口

 第一阶段默认**保留 Lefthook**，只把它调用的命令切换到 Biome 体系。

 也就是说，目标不是这次同时把 hook 框架一起改掉，而是：

 - pre-commit 仍保留 `npm run lint`
 - pre-push 仍保留 `npm run validate:full`

 等完整迁移稳定后，再单独评估是否要把 pre-commit 改成 staged-only 检查。

 ### 5.4 规则覆盖面

 迁移后需要至少覆盖：

 - JS / TS / TSX lint
 - React hooks 基础规则
 - hooks 依赖检查
 - type import 风格
 - unused imports / unused variables
 - JSON / CSS / 配置文件格式化
 - imports organize

 ---

 ## 6. 需要显式处理的兼容点

 完全切 Biome 不是“把命令替掉就行”，下面几个点必须在执行时明确收口。

 ### 6.1 React hooks 规则要统一覆盖 Web 和 TUI

 当前 ESLint 的 `react-hooks/exhaustive-deps` 只对 `packages/web/src/**/*.{ts,tsx}` 开启。

 迁移后建议明确目标：

 - `rules-of-hooks` 等价能力覆盖 Web + TUI
 - `exhaustive-deps` 等价能力也覆盖 Web + TUI

 理由不是“为了更严格”，而是 TUI 里同样存在大量 hooks；如果已经决定切到单一 lint 体系，就不应该把 TUI 永久留在更松的口径里。

 ### 6.2 `_unused` 风格的未使用变量豁免

 当前 ESLint 显式允许：

 - 参数名以 `_` 开头
 - 变量名以 `_` 开头

 执行迁移时必须先确认 Biome 是否能无损表达这一策略；如果不能，需要在执行前先选定一种收口方式：

 1. 改写代码，减少这类变量
 2. 用更小范围的 suppression 替代全局豁免
 3. 临时调整相关规则级别，但只作为过渡措施

 原则上不建议为了迁移方便，直接把 unused-vars 全局放宽到几乎无效。

 ### 6.3 `any` 的当前放宽策略

 当前仓库存在少量刻意保留的 `any`，主要集中在图表与第三方运行时边界。

 迁移时建议保持与当前行为一致：

 - 第一阶段不要把 `noExplicitAny` 直接升成阻塞项
 - 先以“行为等价”为优先
 - 等迁移完成后，再决定是否做单独的 `any` 清理专题

 ### 6.4 `no-control-regex` 的现有例外

 当前 ESLint 把 `no-control-regex` 关掉了。

 迁移时要明确两件事：

 1. Biome 的对应规则默认是否会报错
 2. 当前仓库里是否真有依赖这个例外的实现

 如果有，优先考虑精确重写具体代码，再决定要不要保留全局例外。

 ### 6.5 Test globals / runtime globals

 当前 ESLint 已经显式区分：

 - Node globals
 - browser-like globals
 - test globals（`describe` / `it` / `expect` / `vi` 等）

 执行迁移时，`test/**/*.test.ts`、`packages/web/**`、`packages/tui/**` 的环境差异必须由 Biome override 明确承接，不能默认假设所有目录都共享同一套 global。

 ### 6.6 type import 一致性

 当前 ESLint 把 `@typescript-eslint/consistent-type-imports` 设为 error。

 迁移时应把这类约束映射到 Biome 的 type import 规则，并允许执行一次自动修复，把仓库统一到同一风格。

 ---

 ## 7. 建议的执行顺序

 下面是后续真正开工时建议遵循的顺序。

 ### 阶段 0：冻结目标与边界

 先确认下面几件事：

 - 本轮目标是**完全切换到 Biome**，不是长期双栈
 - 本轮默认保留 Lefthook，不把 Husky 迁移混进同一 change
 - 允许一次性进行全仓自动格式化
 - 允许为 Biome 适配做少量代码级清理

 这一步不改代码，只锁决策。

 ### 阶段 1：落地 Biome 配置，但暂不删 ESLint

 预期动作：

 - 安装 `@biomejs/biome`
 - 新增根 `biome.json`
 - 在配置里先对齐仓库既有风格：
   - 2 spaces
   - double quotes
   - semicolons
 - 给 test / web / tui / config 文件预留 override 结构

 这一步的目的不是马上切换，而是先把目标配置跑起来。

 ### 阶段 2：把现有 ESLint 约束翻译到 Biome 口径

 这一阶段要做的不是“尽量像”，而是逐项判断：

 - 哪些规则有直接等价物
 - 哪些规则要通过 override 表达
 - 哪些规则需要先局部豁免或改代码
 - 哪些旧例外应该趁迁移一起清掉

 特别要优先验证：

 - hooks 规则
 - type import 规则
 - unused vars 策略
 - test globals

 ### 阶段 3：跑一次全仓自动修复

 建议通过 Biome 统一执行：

 - formatting
 - organize imports
 - 可安全自动修复的 lint

 这一步预计会产生较大 diff，但应该尽量集中在一个独立 change 中，避免与业务逻辑修改混在一起。

 ### 阶段 4：收口无法自动修复的诊断

 重点清理：

 - hooks 依赖问题
 - test globals / 环境误报
 - `_unused` 命名策略冲突
 - `any` / regex 相关边角问题

 这一步的目标是把 `npm run lint` 真正打绿。

 ### 阶段 5：切换根脚本与 hook 入口

 当 Biome 已经可以稳定跑绿后，再切：

 - `package.json` 的 `lint` / `lint:fix`
 - `validate:full` 的 lint 入口
 - `lefthook` 相关命令调用

 只有到这一步，仓库的默认 lint 入口才真正从 ESLint 切到 Biome。

 ### 阶段 6：删除 ESLint 残留

 最后再删除：

 - `eslint.config.mjs`
 - `eslint`
 - `@eslint/js`
 - `typescript-eslint`
 - `eslint-plugin-react-hooks`

 以及所有只为 ESLint 服务的说明文字。

 顺序上一定要把“删旧工具”放在最后，避免迁移中间失去安全网。

 ---

 ## 8. 预期需要变动的文件

 真正执行时，大概率会涉及这些文件：

 - `package.json`
 - `package-lock.json`
 - `biome.json`（新增）
 - `eslint.config.mjs`（删除）
 - `lefthook.yml`
 - `README.md`
 - `docs/spec/repo-layout-and-standards.md`
 - 以及被 Biome 自动修复到的 TS / TSX / CSS / JSON 文件

 如果执行中发现还需要批量 touch 其它文件，应优先确认那是不是 formatter 扩散，而不是无意改了业务逻辑。

 ---

 ## 9. 验收标准

 迁移完成后，至少应满足下面这些条件：

 1. `npm run lint` 仅通过 Biome 即可跑绿
 2. `npm run lint:fix` 可完成仓库标准化修复
 3. 仓库中不再依赖 ESLint 及其配置文件
 4. `npm run validate:full` 行为保持成立
 5. `npm run build`
 6. `npm run build:runtime`
 7. `npm run web:build`
 8. `npm test`

 上述命令都应继续通过。

 额外要求：

 - Web 与 TUI 的 hooks 规则口径一致
 - JSON / CSS / TS / TSX 都进入统一 formatter 入口
 - 文档中不再把 ESLint 当成当前标准流程描述

 ---

 ## 10. 风险与控制措施

 ### 10.1 风格 diff 一次性过大

 风险：

 - formatter 全仓改写会带来很大的 review 噪音

 控制：

 - 把自动格式化 change 与规则修复 change 分开
 - 不夹杂业务逻辑修改

 ### 10.2 hooks 规则收紧后引出真实问题

 风险：

 - TUI 在纳入依赖检查后，可能暴露一批之前没被发现的问题

 控制：

 - 接受这会带来额外修复成本
 - 不为了保住迁移速度而轻率关掉规则

 ### 10.3 Biome 与当前例外策略不完全等价

 风险：

 - `_unused`、test globals、`no-control-regex` 等策略可能不能一比一迁移

 控制：

 - 执行前先做针对性验证
 - 优先局部修代码，不优先扩大豁免范围

 ### 10.4 Hook 耗时体验变差

 风险：

 - 全仓 `biome check .` 可能仍然偏慢

 控制：

 - 本轮先完成“完全切到 Biome”
 - staged-only 优化作为后续独立优化项，不和主迁移绑死

 ---

 ## 11. 后续可选优化

 完成全量迁移后，可以再单独评估这些增强项：

 1. pre-commit 改成 staged-only
 2. 是否引入 `lint-staged`
 3. 是否把 `format` 加入更明确的开发者工作流说明
 4. 是否逐步收紧 `noExplicitAny`
 5. 是否清掉剩余局部 suppressions

 这些都应该在主迁移完成后再讨论，而不是提前混进同一轮 change。

 ---

 ## 12. 当前结论

 对这个仓库来说，最合理的方向不是继续打磨现有 ESLint，而是：

 - 明确以 **Biome 作为唯一 lint / format 入口**
 - 保留现有脚本名和 hook 对外行为
 - 先完成等价迁移，再做 staged-only 和规则收紧

 也就是说，后续执行时应以“**完整替换**”为目标，但实现上要遵守“**先建新链路，再删旧链路**”的顺序，避免在迁移中间把仓库带进半成品状态。
