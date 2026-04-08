# Changelog

All notable changes to CodexNamer will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project currently follows semantic versioning at the repository level.

## [Unreleased]

### Added

- Public-facing README refresh with bilingual entry points.
- Community health files: contributing guide, security policy, code of conduct, issue templates, and PR template.
- GitHub Actions CI for install, build, and test validation.

## [0.1.0] - 2026-04-09

### Added

- Local-first session manager for Codex rollout data.
- Core ingest pipeline for `~/.codex/sessions/**/rollout-*.jsonl`.
- Independent SQLite state database and rename history tracking.
- `session_index.jsonl` writeback and compaction support.
- Structured rename generation with AI and heuristic paths.
- CLI, Local API, Web UI, TUI, and daemon sweep entry points.
- Freeze, manual override, collision handling, prompt preview, provider diagnostics, and rename replay workflows.
- Web daemon controls and runtime panels for distinguishing preview state from real auto-apply execution.
