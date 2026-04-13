# CodexNamer

[English](README.md) | [简体中文](README.zh.md)

让你本地的 Codex 会话重新变得可读、可管、可维护。

CodexNamer 会扫描本地 Codex rollout 历史，生成更清晰的 session 标题，支持你先预览再应用，也能冻结不该频繁变化的会话；最终仍通过 `~/.codex/session_index.jsonl` 写回，不需要 patch Codex。

![Language: TypeScript](https://img.shields.io/static/v1?label=Language&message=TypeScript&color=3178c6&style=flat-square)
![Node 20+](https://img.shields.io/static/v1?label=Node&message=20%2B&color=43853d&style=flat-square)
![Local-first](https://img.shields.io/static/v1?label=Mode&message=Local-first&color=7c3aed&style=flat-square)
![License: MIT](https://img.shields.io/static/v1?label=License&message=MIT&color=2563eb&style=flat-square)

## 界面预览

<table>
  <tr>
    <td width="50%">
      <img src="docs/assets/screenshots/readme-sessions.png" alt="会话与 transcript 浏览界面" />
    </td>
    <td width="50%">
      <img src="docs/assets/screenshots/readme-settings.png" alt="命名与运行时设置界面" />
    </td>
  </tr>
  <tr>
    <td valign="top">
      <strong>会话浏览与 transcript 审核</strong><br />
      按 workspace 浏览 session，查看 transcript、命名上下文和操作状态。
    </td>
    <td valign="top">
      <strong>命名规则与运行时设置</strong><br />
      在同一套界面里调整 naming policy、provider 配置和运行阈值。
    </td>
  </tr>
</table>

## 它现在能帮你做什么

- **把所有 session 放回一个清晰列表里**，按 workspace、provider、项目统一查看。
- **自动生成更像人写的标题**，走可审阅的结构化命名流程。
- **先看再写回**，明确区分 `skip / suggest / apply`。
- **冻结稳定会话**，避免标题反复抖动。
- **保持本地优先**，使用自己的 SQLite 状态库，但仍走官方 `session_index.jsonl` 写回层。
- **直接用正式产品化界面管理**，包括 Sessions、Settings、Maintenance、Requeue、Daemon。

## 快速开始

当前主要发布渠道就是 GitHub 仓库。

```bash
git clone https://github.com/WncFht/CodexNamer.git codexnamer
cd codexnamer
npm install
npm run serve
```

打开：

- `http://127.0.0.1:42110`

`npm run serve` 会自动完成所需构建、启动本地常驻进程、同时提供 Web UI 和 Local API，并在未显式关闭时自动拉起托管 daemon。

## 更保守的首次启动方式

如果你想先以“只预览、不自动落盘”的方式使用，可以先复制示例配置：

```bash
mkdir -p ~/.config/codexnamer
cp config.example.toml ~/.config/codexnamer/config.toml
```

这个示例文件比内置默认值更保守：它会把 `rename.auto_apply` 设成 `"disabled"`，方便你先观察结果。

## 你在界面里会用到的能力

### Sessions

- 按 workspace 浏览会话
- 查看 transcript、元信息、命名历史
- 审核候选标题后再决定是否写回
- 在需要时 apply、freeze、requeue

### Settings

- 调整命名 builder、标签、prompt override 和 context strategy
- 继承 Codex provider 配置，或自己手动填写 provider
- 做 provider 连通性检查，并查看运行时解析结果
- 调整扫描节奏、空闲阈值和自动应用策略

### Maintenance / Requeue / Daemon

- 查看 dirty 队列、运行图表和 AI 请求日志
- 在 `session_index.jsonl` 变大后执行 compact
- 预览并执行基于规则签名的 requeue
- 监控托管 sweep daemon，并控制它的运行状态

## 开发与发布前检查

当前仓库状态：

- 格式化和 lint 已统一到 **Biome**
- `npm run lint` 会执行 `biome check .`
- `npm run format` 会执行 `biome format --write .`
- `npm run validate:full` 是发布前的完整检查入口

常见的本地验证链路：

```bash
npm run lint
npm run build
npm run build:runtime
npm run web:build
npm test
```

## 作为后台服务运行

如果你希望 CodexNamer 以用户级后台服务持续运行：

```bash
npm run cli -- service install --start
```

其他 service 命令：

```bash
npm run cli -- service status
npm run cli -- service restart
npm run cli -- service stop
npm run cli -- service uninstall
```

这组 service 命令现在默认输出更适合人看的摘要；在 TTY 里会自动带颜色。如果要给脚本消费，再追加 `--json`；如果只想强制纯文本，可以加 `NO_COLOR=1`。

平台对应：

- Linux → `systemd --user`
- macOS → `LaunchAgent`
- Windows → 任务计划程序（`ONLOGON`）

## 配置

默认用户配置路径：

- `~/.config/codexnamer/config.toml`

可选项目级覆盖路径：

- `<当前工作目录>/.codexnamer.toml`

CodexNamer 可以直接继承你本地 Codex 的 provider 配置，也可以在自己的配置里手动定义 provider。

## 其他使用方式

大多数用户只需要 `npm run serve`。如果你有更偏操作型的需求，也可以使用：

- `npm run tui` — 通过 Local API 提供的终端界面
- `npm run cli -- ...` — 直接命令行操作
- `npm run api -- --host 127.0.0.1 --port 42110` — 只启动 Local API
- `npm run daemon -- --once` — 单独执行一轮 sweep，方便隔离验证

## 文档

- 发布入口与快速上手：`README.md` / `README.zh.md`
- 用户和贡献者文档：[`docs/README.md`](docs/README.md)
- 安全策略：[`SECURITY.md`](SECURITY.md)
- 贡献指南：[`CONTRIBUTING.md`](CONTRIBUTING.md)

## 友链

[![友链 linux.do](https://img.shields.io/badge/LINUX--DO-Community-blue.svg?logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB3aWR0aD0iMTIwIiBoZWlnaHQ9IjEyMCIgdmlld0JveD0iMCAwIDEyMCAxMjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI%2BPGNsaXBQYXRoIGlkPSJhIj48Y2lyY2xlIGN4PSI2MCIgY3k9IjYwIiByPSI0NyIvPjwvY2xpcFBhdGg%2BPGNpcmNsZSBmaWxsPSIjZjBmMGYwIiBjeD0iNjAiIGN5PSI2MCIgcj0iNTAiLz48cmVjdCBmaWxsPSIjMWMxYzFlIiBjbGlwLXBhdGg9InVybCgjYSkiIHg9IjEwIiB5PSIxMCIgd2lkdGg9IjEwMCIgaGVpZ2h0PSIzMCIvPjxyZWN0IGZpbGw9IiNmMGYwZjAiIGNsaXAtcGF0aD0idXJsKCNhKSIgeD0iMTAiIHk9IjQwIiB3aWR0aD0iMTAwIiBoZWlnaHQ9IjQwIi8%2BPHJlY3QgZmlsbD0iI2ZmYjAwMyIgY2xpcC1wYXRoPSJ1cmwoI2EpIiB4PSIxMCIgeT0iODAiIHdpZHRoPSIxMDAiIGhlaWdodD0iMzAiLz48L3N2Zz4%3D&style=flat)](https://linux.do/)

## 为什么强调本地优先

CodexNamer 会维护自己的状态，但真正的最终命名写回仍然走官方 `session_index.jsonl` 层。这意味着：

- 你可以清楚地检查和控制这套工具
- 不需要改 Codex 源码
- Codex 内部状态和 CodexNamer 自己的状态边界清晰
