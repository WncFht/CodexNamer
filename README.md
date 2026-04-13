# CodexNamer

[English](README.md) | [简体中文](README.zh.md)

Local-first session naming and automation for Codex rollouts.

CodexNamer scans local rollout files under `~/.codex/sessions/**/rollout-*.jsonl`, keeps its own SQLite state database, and writes final names back through `~/.codex/session_index.jsonl` — without patching Codex itself or touching Codex's internal SQLite.

![TypeScript](https://img.shields.io/static/v1?label=Language&message=TypeScript&color=3178c6&style=flat-square)
![Node 20+](https://img.shields.io/static/v1?label=Node&message=20%2B&color=43853d&style=flat-square)
![Local-first](https://img.shields.io/static/v1?label=Mode&message=Local-first&color=7c3aed&style=flat-square)
![License: MIT](https://img.shields.io/static/v1?label=License&message=MIT&color=2563eb&style=flat-square)

## Why this exists

Codex already stores session history locally, but day-to-day session management quickly becomes messy when you have:

- hundreds of rollout files
- weak or stale default titles
- multiple workspaces and providers
- a need to batch rename, freeze, requeue older sessions, or audit naming history
- a desire to auto-apply stable names only when sessions are truly idle

This project adds an external management layer on top of Codex's local data model:

- **read** local rollout files
- **derive** structured names from heuristics or AI
- **preview** rename decisions before applying
- **write back** through the official `session_index.jsonl` rename layer

## Highlights

- **No Codex patching required**  
  Works as a standalone local tool. It does not wrap Codex startup and does not modify Codex source code.

- **Local-first and auditable**  
  Reads rollout files, stores derived state in its own SQLite database, and keeps rename history separate from Codex internals.

- **Structured AI naming**  
  Supports structured naming with `tag / kind / scope / summary` composition, prompt preview, context strategies, and builder-driven title assembly.

- **Multiple operators, one backend**  
  CLI, Local API, Web UI, TUI, and daemon all share the same core rename engine and state model.

- **Safe auto-apply model**  
  Distinguishes between preview status (`skip / suggest / apply`) and real writeback execution (`preview-only` vs `auto-apply`).

- **Daemon control in Web UI**  
  The Local API auto-starts a managed sweep daemon by default, and the Web app can stop/restart it while showing the next scheduled sweep countdown.

- **Product-style Web UI**  
  The Web surface now uses a warm Bokushi-inspired design system with unified cards, pills, light/dark/system themes, a lighter workspace rail, and maintenance charts that share one semantic palette.

- **Practical queue operations**  
  Freeze sessions, requeue by rule signature, detect name collisions, compact `session_index.jsonl`, inspect provider diagnostics, and review AI request logs.

## Architecture

```mermaid
flowchart LR
  A["~/.codex/sessions/**/rollout-*.jsonl"] --> B["Core scanner / ingest"]
  B --> C["SQLite state DB"]
  C --> D["Rename evaluation"]
  D --> E["CLI / API / Web / TUI"]
  D --> F["Daemon sweep"]
  F --> G["session_index.jsonl writeback"]
  E --> G
```

There is no separate durable task queue. Dirty sessions inside `rename_state` act as a soft queue, and each sweep recomputes `skip / suggest / apply` from current state.

## Feature overview

| Capability | Status | Entry points |
| --- | --- | --- |
| Rollout scanning and incremental ingest | Available | core |
| Structured rename candidate generation | Available | core / CLI / API / Web / TUI |
| Manual rename | Available | CLI / API / TUI |
| Freeze / unfreeze | Available | CLI / API / Web / TUI |
| Dirty queue preview and batch apply | Available | CLI / API / Web / TUI |
| Auto-rename sweep with daemon heartbeat | Available | daemon / API / Web |
| Provider diagnostics and prompt preview | Available | CLI / API / Web / TUI |
| `session_index.jsonl` compaction | Available | CLI / API / Web |
| Rule-signature requeue | Available | API / Web |
| API-managed daemon with auto-start and Web controls | Available | API / Web |

## Quick start

### Requirements

- Node.js `20+`
- npm `10+`
- A local Codex home directory, usually `~/.codex`
- If you want AI naming via inherited Codex provider settings:
  - `~/.codex/config.toml`
  - `~/.codex/auth.json`

### Install

```bash
git clone <your-repo-url> codexnamer
cd codexnamer
npm install
npm run build
```

### Start the local service

```bash
npm run serve
```

This is the product-style local entry point:

- one long-lived local process
- serves the built Web UI from the same port as the API
- auto-starts the API-managed daemon by default
- shuts down cleanly on `SIGINT` / `SIGTERM`

Default URL:

- `http://127.0.0.1:42110`

### Install as a user service

CodexNamer now exposes a cross-platform user-service wrapper around `codexnamer serve`:

```bash
# Register the service for the current user
npm run cli -- service install

# Start / stop / restart / inspect
npm run cli -- service start
npm run cli -- service stop
npm run cli -- service restart
npm run cli -- service status

# Remove the registration again
npm run cli -- service uninstall
```

Platform mapping:

- Linux → `systemd --user`
- macOS → `LaunchAgent`
- Windows → Task Scheduler (`ONLOGON`)

Current scope:

- install / start / stop / restart / status / uninstall are implemented
- the service runs the same `serve` flow with built Web assets
- Linux behavior is covered by this repo's CI-equivalent validation chain
- macOS / Windows command generation is implemented, but not live-verified in this Linux workspace yet

### Start the Web dev launcher

```bash
npm run web
```

This remains the development entry point. The launcher will:

- reuse a healthy local API if one already exists
- or start a new API on an available `42110+` port
- auto-start the API-managed daemon
- clean up stale repo-owned launcher/API/web dev processes
- open the Vite app against the matching API target

Default Web URL:

- `http://127.0.0.1:43110`

Current Web UI behavior:

- three-state theme toggle: `system → light → dark`
- content-first Sessions / Settings / Maintenance / Daemon surfaces
- unified maintenance chart palette driven by shared design tokens
- AI provider diagnostics presented as one effective-config snapshot + connectivity receipt

### Start the TUI

```bash
npm run tui
```

Or connect the TUI to an explicit API:

```bash
npm run tui -- --api-base http://127.0.0.1:42110
```

### Start the Local API directly

```bash
npm run api -- --host 127.0.0.1 --port 42110
curl http://127.0.0.1:42110/api/v1/health
```

`npm run api` now auto-starts a controller-managed daemon with the configured scan interval.

If you also want it to serve a built dashboard from the same process:

```bash
npm run api -- --host 127.0.0.1 --port 42110 --web-root packages/web/dist
```

### Start the daemon

```bash
# Continuous sweep
npm run daemon

# Single sweep only
npm run daemon -- --once

# Custom interval
npm run daemon -- --interval 60
```

This standalone daemon is optional. In the common Web/API flow, the Local API already starts its own managed daemon by default.

## Auto-apply semantics

This project intentionally separates **rename evaluation** from **actual writeback**.

- `skip` → do nothing
- `suggest` → candidate is ready for preview
- `apply` → candidate is eligible to be written

But `apply` in preview does **not** automatically mean the rename was written back.

Real auto-apply depends on runtime state:

- `rename.auto_apply = "disabled"` → preview only
- `rename.auto_apply = "idle-finalize"` + daemon running → eligible `finalize_ready` sessions can be written automatically

In the default Web/API flow, that daemon is auto-started by the Local API. The standalone `npm run daemon` entry point remains useful for isolated runtime testing or non-API setups.

The UI exposes:

- configured auto-apply policy
- actual execution mode
- daemon heartbeat status
- last sweep summary

So you can distinguish "configured for auto-apply" from "actually applying now".

## Configuration

Default config path:

- `~/.config/codexnamer/config.toml`

> Note: CodexNamer now uses only the `codexnamer` config and state prefixes.

A commented starter config is available at [`config.example.toml`](./config.example.toml).
For first-time use, copy it to `~/.config/codexnamer/config.toml` and adjust from there.
It starts in preview mode (`rename.auto_apply = "disabled"`) and reuses your current Codex provider by default.

Minimal example:

```toml
[general]
codex_home = "~/.codex"
state_dir = "~/.local/state/codexnamer"
ui_language = "zh-CN"

[ai]
backend = "responses"
provider_source = "codex-config"
profile = "default"
max_concurrency = 1

[naming]
preset = "conventional"
language = "zh-CN"
context_strategy = "summary-signals"
context_max_chars = 8000
composition_mode = "structured"
builder = [
  { type = "component", component = "tag" },
  { type = "separator", value = " · " },
  { type = "component", component = "kind" },
  { type = "separator", value = " · " },
  { type = "component", component = "summary" }
]

[[naming.tags]]
id = "settings"
description = "Settings, provider, config, save, and language related sessions."
prompt_hint = "setting settings config save language provider"
```

## Selected commands

### CLI

```bash
npm run cli -- list --dirty
npm run cli -- show --id <thread-id>
npm run cli -- suggest --id <thread-id>
npm run cli -- apply --id <thread-id>
npm run cli -- rename --id <thread-id> --name "feat(api): add config writeback"
npm run cli -- batch apply --dirty --preview
npm run cli -- batch apply --dirty
npm run cli -- compact-index --dry-run
npm run cli -- doctor
npm run cli -- provider test
```

### Local API

```bash
curl 'http://127.0.0.1:42110/api/v1/sessions?dirty=true&search=api'
curl -X POST http://127.0.0.1:42110/api/v1/sessions/<thread-id>/suggest
curl -X POST http://127.0.0.1:42110/api/v1/sessions/<thread-id>/apply
curl http://127.0.0.1:42110/api/v1/overview
curl http://127.0.0.1:42110/api/v1/daemon
```

## Repo layout

```text
packages/core     core ingest, state, provider, naming, writeback
packages/shared   shared DTOs and schemas
packages/api      local Fastify API
packages/cli      CLI entry point
packages/daemon   sweep daemon
packages/web      React + Vite dashboard
packages/tui      Ink-based terminal UI
docs/             specs, ADRs, design notes, reviews
test/             Vitest test suite
```

## Development

```bash
npm install
npm run build
npm run build:runtime
npm run web:build
npm test
```

Useful local entry points:

```bash
npm run serve
npm run web
npm run tui
npm run api
npm run daemon
```

## Documentation

- [Documentation index](docs/README.md)
- [Repo overview](docs/spec/repo-overview.md)
- [System design](docs/spec/system-design.md)
- [Config and AI backend](docs/spec/config-and-ai.md)
- [Web / TUI / Local API design](docs/spec/web-tui-local-api-design.md)
- [Rename evaluation and context](docs/spec/rename-evaluation-and-context.md)

## Project status

This repository is already usable for local session management, but it is still early-stage software.

Current strengths:

- the core read/write loop is implemented
- the Web UI, TUI, CLI, API, and daemon are all functional
- naming, provider diagnostics, and maintenance flows are test-covered

Still evolving:

- release packaging and distribution
- long-term compatibility hardening against future Codex data model changes
- public project polish, docs, and contributor workflows

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Security

See [SECURITY.md](SECURITY.md).

## License

MIT — see [LICENSE](LICENSE).
