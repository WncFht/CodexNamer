# Contributing

Thanks for your interest in improving CodexNamer.

## Before you start

- For bug reports, please include reproduction steps and the smallest useful sample.
- For feature work, open an issue first if the change is large, invasive, or changes rename semantics.
- Please keep in mind that this project is **local-first** and intentionally writes back through `session_index.jsonl` instead of patching Codex internals.

## Development setup

```bash
git clone <your-repo-url> codexnamer
cd codexnamer
npm install
```

Recommended validation commands:

```bash
npm run build
npm run build:runtime
npm run web:build
npm test
```

Useful local entry points while developing:

```bash
npm run web
npm run tui
npm run api
npm run daemon -- --once
```

## Project structure

```text
packages/core     rename engine, state model, writeback, provider logic
packages/shared   shared DTOs and schemas
packages/api      local Fastify API
packages/cli      CLI
packages/daemon   daemon sweep runner
packages/web      React + Vite UI
packages/tui      Ink terminal UI
docs/             specs, ADRs, reviews
test/             Vitest tests
```

## Contribution guidelines

### 1. Prefer small, reviewable changes

Separate UI tweaks, refactors, and semantic behavior changes whenever possible.

### 2. Keep core semantics explicit

If you touch naming or auto-apply behavior, document whether the change affects:

- rename evaluation (`skip / suggest / apply`)
- actual writeback behavior
- runtime/heartbeat reporting
- compatibility with existing state data

### 3. Add or update tests

Please add tests for:

- new core rename behavior
- API contract changes
- config parsing changes
- UI state derivation logic when practical

### 4. Keep docs in sync

If the change affects user-visible behavior, update at least one of:

- `README.md`
- `README.zh.md`
- `docs/README.md`
- the relevant spec under `docs/spec/`

## Pull requests

Before opening a PR, please make sure:

- [ ] the branch builds locally
- [ ] the relevant tests pass
- [ ] docs were updated when behavior changed
- [ ] the PR description explains the user-visible impact

GitHub pull requests are welcome. Internally the repo may also be maintained with Jujutsu (`jj`), but contributors do **not** need to use `jj` to contribute.

## Coding style

- Prefer clear, boring code over clever abstractions.
- Reuse the shared core/backend model instead of duplicating logic in Web/TUI/CLI.
- Keep local paths and runtime assumptions explicit.
- Avoid silently changing writeback semantics.

## Questions

If you're unsure where a change belongs, start with an issue or draft PR and explain the intended behavior.
