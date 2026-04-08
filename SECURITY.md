# Security Policy

## Supported versions

| Version | Supported |
| --- | --- |
| `0.1.x` | ✅ |
| `< 0.1.0` | ❌ |

## Reporting a vulnerability

Please **do not** open a public issue with exploit details.

If GitHub Security Advisories are enabled for the repository, use that channel first.
Otherwise, contact the maintainer through a private channel before publishing details.

If no private channel is available yet, open a minimal issue asking for a secure contact method and avoid disclosing the vulnerability itself.

## What is security-relevant here

Because this project is local-first, security-sensitive areas typically include:

- reading local Codex rollout files
- writing back to `~/.codex/session_index.jsonl`
- inheriting provider credentials from local config/auth files
- exposing the local API and daemon controls on a non-loopback interface

When reporting an issue, please include:

- affected version or commit
- operating system
- whether the issue requires local access or remote access
- whether it involves local credential leakage, arbitrary file access, or unintended writeback
- the smallest reproducible setup you can provide safely

## Hardening expectations

For production-like local setups, we recommend:

- binding the API to loopback unless remote access is intentional
- treating `~/.codex/auth.json` and any explicit provider API keys as secrets
- reviewing daemon auto-apply settings before enabling unattended writeback
- backing up `session_index.jsonl` before bulk or experimental operations
