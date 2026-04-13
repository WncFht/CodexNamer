# CodexNamer

[English](README.md) | [简体中文](README.zh.md)

Keep Codex sessions readable on your own machine.

CodexNamer scans local Codex rollout history, suggests clearer session titles, lets you review or freeze them, and writes accepted names back through `~/.codex/session_index.jsonl` — without patching Codex itself.

![TypeScript](https://img.shields.io/static/v1?label=Language&message=TypeScript&color=3178c6&style=flat-square)
![Node 20+](https://img.shields.io/static/v1?label=Node&message=20%2B&color=43853d&style=flat-square)
![Local-first](https://img.shields.io/static/v1?label=Mode&message=Local-first&color=7c3aed&style=flat-square)
![License: MIT](https://img.shields.io/static/v1?label=License&message=MIT&color=2563eb&style=flat-square)

## Screenshots

<table>
  <tr>
    <td width="50%">
      <img src="docs/assets/screenshots/readme-sessions.png" alt="Sessions and transcript browser" />
    </td>
    <td width="50%">
      <img src="docs/assets/screenshots/readme-settings.png" alt="Naming and runtime settings" />
    </td>
  </tr>
  <tr>
    <td valign="top">
      <strong>Sessions and transcript review</strong><br />
      Browse by workspace, inspect transcript, and review rename context without leaving the app shell.
    </td>
    <td valign="top">
      <strong>Settings and runtime controls</strong><br />
      Edit naming policy, provider setup, and runtime thresholds from one product surface.
    </td>
  </tr>
</table>

## What it does well

- **See all your sessions in one place** across workspaces, providers, and projects.
- **Generate clearer names** with reviewable, structured naming workflows.
- **Review before writing** with explicit `skip / suggest / apply` states.
- **Freeze noisy sessions** so stable names stay stable.
- **Run fully local-first** with its own SQLite state and official `session_index.jsonl` writeback.
- **Manage the whole flow in a product UI** with Sessions, Settings, Maintenance, Requeue, and Daemon views.

## Quick start

The GitHub repository is the primary distribution channel right now.

```bash
git clone https://github.com/WncFht/CodexNamer.git codexnamer
cd codexnamer
npm install
npm run serve
```

Open:

- `http://127.0.0.1:42110`

`npm run serve` builds what it needs, starts one long-lived local process, serves the Web UI and the Local API together, and auto-starts the managed daemon unless you disable it explicitly.

## Conservative first-run setup

If you want a preview-only first run, copy the starter config before launching:

```bash
mkdir -p ~/.config/codexnamer
cp config.example.toml ~/.config/codexnamer/config.toml
```

That starter file is intentionally more conservative than the built-in defaults: it keeps `rename.auto_apply = "disabled"` until you trust the results.

## What you can do in the app

### Sessions

- browse sessions by workspace
- inspect transcript, metadata, and rename history
- review suggested titles before applying them
- apply, freeze, or requeue sessions when needed

### Settings

- adjust naming builder, tags, prompt override, and context strategy
- inherit Codex provider settings or define a manual provider
- verify provider connectivity and inspect resolved runtime configuration
- tune scan cadence, idle thresholds, and auto-apply policy

### Maintenance, Requeue, and Daemon

- review dirty queues, runtime charts, and AI request logs
- compact `session_index.jsonl` when it grows too large
- preview and execute rule-signature-based requeue
- watch the managed sweep daemon and control its runtime state

## Development and release checks

Current repository status:

- formatting and linting are unified on **Biome**
- `npm run lint` runs `biome check .`
- `npm run format` runs `biome format --write .`
- `npm run validate:full` is the release-grade verification entry

Typical contributor flow:

```bash
npm run lint
npm run build
npm run build:runtime
npm run web:build
npm test
```

## Background service

If you want CodexNamer to stay available as a user-level background service:

```bash
npm run cli -- service install --start
```

Other service commands:

```bash
npm run cli -- service status
npm run cli -- service restart
npm run cli -- service stop
npm run cli -- service uninstall
```

These service commands now print human-readable summaries by default, with terminal colors enabled automatically on TTY output. Add `--json` if you need machine-readable output for scripts, or `NO_COLOR=1` if you want plain text.

Platform mapping:

- Linux → `systemd --user`
- macOS → `LaunchAgent`
- Windows → Task Scheduler (`ONLOGON`)

## Configuration

Default user config path:

- `~/.config/codexnamer/config.toml`

Optional project override path:

- `<current working directory>/.codexnamer.toml`

CodexNamer can inherit provider settings from your local Codex config, or you can define a manual provider inside CodexNamer.

## Other ways to operate

Most users only need `npm run serve`, but the project also includes:

- `npm run tui` — terminal UI backed by the Local API
- `npm run cli -- ...` — direct command-line operations
- `npm run api -- --host 127.0.0.1 --port 42110` — Local API only
- `npm run daemon -- --once` — standalone sweep runner for isolated testing

## Documentation

- Release-facing overview and quick start: `README.md` / `README.zh.md`
- User and contributor docs: [`docs/README.md`](docs/README.md)
- Security policy: [`SECURITY.md`](SECURITY.md)
- Contribution guide: [`CONTRIBUTING.md`](CONTRIBUTING.md)

## Friends

[![友链 linux.do](https://img.shields.io/badge/LINUX--DO-Community-blue.svg?logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB3aWR0aD0iMTIwIiBoZWlnaHQ9IjEyMCIgdmlld0JveD0iMCAwIDEyMCAxMjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI%2BPGNsaXBQYXRoIGlkPSJhIj48Y2lyY2xlIGN4PSI2MCIgY3k9IjYwIiByPSI0NyIvPjwvY2xpcFBhdGg%2BPGNpcmNsZSBmaWxsPSIjZjBmMGYwIiBjeD0iNjAiIGN5PSI2MCIgcj0iNTAiLz48cmVjdCBmaWxsPSIjMWMxYzFlIiBjbGlwLXBhdGg9InVybCgjYSkiIHg9IjEwIiB5PSIxMCIgd2lkdGg9IjEwMCIgaGVpZ2h0PSIzMCIvPjxyZWN0IGZpbGw9IiNmMGYwZjAiIGNsaXAtcGF0aD0idXJsKCNhKSIgeD0iMTAiIHk9IjQwIiB3aWR0aD0iMTAwIiBoZWlnaHQ9IjQwIi8%2BPHJlY3QgZmlsbD0iI2ZmYjAwMyIgY2xpcC1wYXRoPSJ1cmwoI2EpIiB4PSIxMCIgeT0iODAiIHdpZHRoPSIxMDAiIGhlaWdodD0iMzAiLz48L3N2Zz4%3D&style=flat)](https://linux.do/)

## Why local-first matters

CodexNamer keeps its own state, but final rename writeback still goes through the official `session_index.jsonl` layer. That gives you:

- a tool you can inspect and control yourself
- no Codex source patching
- a clear separation between Codex internals and CodexNamer state
