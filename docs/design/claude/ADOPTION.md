# Claude Design MD 接入说明

本项目内置了公开的 `design-md/claude` 参考资料，来源于：

- `https://github.com/VoltAgent/awesome-design-md/tree/main/design-md/claude`

源文件已复制到当前目录：

- [README.md](README.md)
- [DESIGN.md](DESIGN.md)
- [preview.html](preview.html)
- [preview-dark.html](preview-dark.html)

## 我们采纳的部分

- 以羊皮纸感画布作为默认页面背景
- 使用带温度的衬线标题与更有编辑感的节奏留白
- 用陶土色作为主操作和高优先级选中态
- 用暖色中性边框、表面色和元信息色替代冷灰
- 用 ring-shadow 表达层次，而不是典型科技风投影
- 为 session 卡片、transcript 条目和 settings 面板使用更大的圆角
- 用深色左侧导航栏搭配浅色阅读面，制造章节感对比

## 当前项目中的映射

- 应用外壳：深色导航 rail + 羊皮纸色内容面板
- Session 卡片：象牙白卡片、暖色 ring shadow、衬线标题
- 详情头部：更大的衬线标题 + 克制的元信息行
- Transcript：象牙白编辑式卡片 + 暖色语义角色标签
- 控件：暖沙色按钮、陶土色主强调、白色搜索框和输入框
- Settings：偏编辑页面的表单布局，而不是开发者控制台风格

## 有意保留的偏离

- 我们保留 transcript 的 tool/system 过滤和 maintenance JSON 区块，因为这是运维型产品，不是营销页面。
- 字体使用 `Georgia` 和系统字体回退，而不是 Anthropic 专有字体。
- 我们保留明确的分栏布局和高密度 session 列表，但用更接近 Claude 的表面风格与节奏去处理。
