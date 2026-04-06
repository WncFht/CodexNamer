# 前端设计审查

日期：`2026-04-05`

范围：

- Web session 浏览页
- Web settings 页
- TUI browser
- TUI settings

参考目标：

- `docs/design/claude/DESIGN.md`

截图集合：

- `docs/reviews/assets/frontend-sessions-2026-04-05.png`
- `docs/reviews/assets/frontend-settings-2026-04-05.png`
- `docs/reviews/assets/tui-browser-2026-04-05.png`
- `docs/reviews/assets/tui-settings-2026-04-05.png`

## 摘要

产品已经不在最差状态：字体被收敛了，卡片的呼吸感比之前更好，运行态 JSON 也不再总是默认展开。但当前前端整体读感仍然更像一个内部运维控制台，而不是一个有编辑节奏的 control deck。

和 `DESIGN.md` 的核心偏差不只在颜色，更在节奏。Claude 的设计语言依赖衬线标题驱动的层级、受控的章节节奏和刻意保留的安静感。当前界面一次性暴露的控件、元信息和面板仍然过多。

## 截图

### Web Sessions 截图

![Web sessions](./assets/frontend-sessions-2026-04-05.png)

### Web Settings 截图

![Web settings](./assets/frontend-settings-2026-04-05.png)

### TUI Browser 截图

![TUI browser](./assets/tui-browser-2026-04-05.png)

### TUI Settings 截图

![TUI settings](./assets/tui-settings-2026-04-05.png)

## 发现

### 高严重度

#### 1. Settings 仍然更像表单堆叠，而不是有叙事结构的控制面

证据：

- `frontend-settings-2026-04-05.png`

偏差原因：

- 概览卡片有帮助，但页面下半部分仍把 `Naming`、`Scheduler`、`Provider`、`Maintenance`、`Runtime` 平铺成一个连续网格。
- Claude 风格强调章节推进和段落节奏，而这里几乎所有控件的视觉权重都接近。
- 页面仍然鼓励用户“扫字段”，而不是“理解系统”。

实际影响：

- 用户看不到明确的“先从哪里开始”。
- 高级 provider / maintenance 控件离日常命名控制太近。
- Settings 页更像运维表格而不是编辑型配置面。

建议下一步：

- 把 settings 重构成三层：
  - `Overview`
  - `Naming & Context`
  - `Automation & Providers`
- 把高级 provider/runtime 细节折叠起来，或者单独拆成子视图。

#### 2. Transcript 区域仍然过于偏向 tool event

证据：

- `frontend-sessions-2026-04-05.png`
- `tui-browser-2026-04-05.png`

偏差原因：

- 主阅读区默认仍会被 `tool_output`、shell 输出和运行日志主导。
- Claude 参考风格不是一个“极简日志查看器”，而是一个有阅读秩序的编辑式表面。
- 尽管现在支持 transcript 过滤，但默认组合仍然让 tool 层过于显眼。

实际影响：

- 用户如果想理解 session 的“内容”，而不是执行噪音，仍然需要主动对抗界面。
- 面向 rename 的浏览会被大量原始工具噪音埋掉。

建议下一步：

- 新增默认 transcript 模式，优先展示 `user + assistant`。
- 增加顶层切换，例如 `Conversation` / `Full trace`。
- 进一步降低 tool event 的视觉权重，例如更小的头部、更浅的对比度。

#### 3. TUI 仍然更像高密度调试器，而不是可长时间阅读的终端浏览器

证据：

- `tui-browser-2026-04-05.png`
- `tui-settings-2026-04-05.png`

偏差原因：

- browser 视图在同一个垂直切片里塞入了状态、transcript、rename history、底部快捷键和分栏指标。
- settings 视图本质上仍然是一串长字段列表，后面跟一个较原始的 provider 区块。
- 视觉色调虽然变暖了，但信息架构仍然是 CLI-first。

实际影响：

- 终端体验还不能算 Web 端的真正对应物。
- 它可以工作，但还不够安静，也不够适合长时间浏览。

建议下一步：

- 把 TUI 拆成更明确的模式：
  - `Browser`
  - `Transcript`
  - `Rename`
  - `Settings`
- 默认分栏里不要同时试图展示太多 session 信息和太多 transcript 内容。

### 中严重度

#### 4. 左侧 workspace rail 仍然偏重

证据：

- `frontend-sessions-2026-04-05.png`
- `frontend-settings-2026-04-05.png`

已有改善：

- 标题比例比之前小了。
- rail 不再因为过大的字重和字号压住主内容。

仍然存在的问题：

- 它仍然是一整块长期驻留的深色区域，而内容面更柔和、更轻。
- 在宽屏上，它对主区域的竞争仍高于 Claude 风格常见的侧导航。

建议下一步：

- 略微降低 rail 对比度，或者收紧内部留白。
- 默认宽度可以再窄一点，workspace badge 也可以更克制。

#### 5. Session 卡片仍重复了过多元信息

证据：

- `frontend-sessions-2026-04-05.png`

偏差原因：

- 某些行里仍然会重复近似的 title / subtitle。
- provider、task 数、状态、时间戳几乎在每张卡上都出现，而真正高价值的信息其实是 session 标题本身。

建议下一步：

- 当 candidate 与 official title 相同，隐藏重复 subtitle。
- 把低价值元信息收进 hover、选中态或更紧凑的次级行。

#### 6. Settings 列在大屏上过宽、过多

证据：

- `frontend-settings-2026-04-05.png`

偏差原因：

- 在宽屏上，settings 网格会被拉成非常宽的多列表单。
- Claude 的设计通常会约束容器宽度，不会让工具型表面无边界铺开。

建议下一步：

- 给 settings 增加最大内容宽度。
- 优先使用更少但更强的列结构，而不是很多窄小控件堆。

### 低严重度

#### 7. Web 排版已经改善，但整体层级仍稍显平均

证据：

- `frontend-sessions-2026-04-05.png`
- `frontend-settings-2026-04-05.png`

已有改善：

- 标题字号已经更合理。
- 卡片标题也不再过大。

剩余问题：

- 一些 metadata、控件和 label 之间的感知层级仍然太接近。
- 产品看起来仍更像“做过样式的 UI”，而不是一个完整的“编辑式系统”。

建议下一步：

- 进一步拉开下面三层的差异：
  - 衬线标题
  - 无衬线工具文本
  - 降低对比度的元信息

## 与 Design MD 的对齐矩阵

### 已经比较对齐的部分

- 暖色羊皮纸背景已经有了。
- 主要标题已经使用衬线字体。
- 陶土色强调已经比较克制，不再刺眼。
- 边框和 ring 的处理也更接近参考风格。

### 仍未对齐的部分

- 章节节奏仍然偏密。
- 一次性可见的控件仍过多。
- transcript 默认视图还不是“以意义为先”。
- TUI 的结构仍然更多受实现便利驱动，而不是阅读节奏驱动。

## 重构顺序建议

### 第 1 阶段

- 给 `Settings` 增加受限最大宽度布局。
- 把 Web settings 拆成 `Core` 和 `Advanced`。
- 移除重复的 session subtitle。
- 增加默认 `Conversation` transcript 模式。

### 第 2 阶段

- 把 TUI 重组为明确的多屏，而不是默认高密度双栏。
- 把 transcript-first 的全屏模式提升为主路径，而不是次级开关。
- 为 TUI 增加更平静的字段分组和 provider disclosure。

### 第 3 阶段

- 在 Web 与 TUI 中都加入 rename-context 预览面板。
- 按同样叙事顺序对齐 naming、transcript 和 rename-history：
  - session 意图
  - 当前标题
  - 候选标题
  - 最近对话
  - rename 历史

## 备注

- TUI 截图是把 pane capture 渲染成 PNG 之后用于审查的结果，适合做结构性批评，但仍然只是 live terminal 渲染的近似物。
- 这份审查基于 `2026-04-05` 调整后的前端状态，而不是更早那版字号失控的 Web 构建。
