# 数据模型

更新时间：`2026-04-09`

## 设计目标

- 把 Codex 官方文件层与本项目状态层明确分开。
- 支持 dirty 检测、rename history、freeze、request logs、overview 聚合。
- 保证 Web / TUI / CLI 共用同一套状态模型。

## 官方文件层

### rollout

来源：

- `~/.codex/sessions/**/rollout-*.jsonl`

用途：

- 发现 sessions
- 解析消息摘要、task_complete、token、provider、cwd

### session_index

来源：

- `~/.codex/session_index.jsonl`

用途：

- 用户可见 official name 的最终覆盖层
- 语义是 latest-wins

结构：

```json
{"id":"<thread-id>","thread_name":"<name>","updated_at":"<rfc3339>"}
```

## 本地数据库

默认文件：

- `~/.local/state/codex-session-manager/app.db`

## 当前表

### `sessions`

- `thread_id TEXT PRIMARY KEY`
- `rollout_path TEXT NOT NULL`
- `cwd TEXT`
- `project_name TEXT`
- `created_at TEXT`
- `updated_at TEXT`
- `model_provider TEXT`
- `model TEXT`
- `first_user_message TEXT`
- `last_user_message TEXT`
- `last_agent_message TEXT`
- `task_complete_count INTEGER NOT NULL DEFAULT 0`
- `token_total INTEGER NOT NULL DEFAULT 0`
- `latest_official_name TEXT`
- `latest_official_name_updated_at TEXT`
- `status_estimate TEXT`
- `archived_hint INTEGER NOT NULL DEFAULT 0`

### `session_revisions`

- `thread_id TEXT PRIMARY KEY`
- `current_revision TEXT NOT NULL`
- `last_seen_rollout_size INTEGER`
- `last_seen_rollout_mtime TEXT`
- `last_material_change_at TEXT`
- `last_task_complete_count INTEGER`
- `last_agent_message_fingerprint TEXT`

### `rename_state`

- `thread_id TEXT PRIMARY KEY`
- `current_candidate_name TEXT`
- `current_candidate_source TEXT`
- `current_candidate_generated_at TEXT`
- `last_auto_name TEXT`
- `last_manual_name TEXT`
- `last_applied_name TEXT`
- `last_applied_source TEXT`
- `last_applied_at TEXT`
- `last_applied_revision TEXT`
- `dirty_since_rename INTEGER NOT NULL DEFAULT 0`
- `force_rewrite INTEGER NOT NULL DEFAULT 0`
- `frozen INTEGER NOT NULL DEFAULT 0`
- `auto_apply_count INTEGER NOT NULL DEFAULT 0`
- `last_auto_apply_attempt_at TEXT`
- `last_auto_apply_success_at TEXT`
- `last_skip_reason TEXT`

兼容保留但当前运行逻辑不依赖的 legacy 列：

- `current_candidate_style`
- `last_applied_style`
- `preferred_style`
- `manual_override`

### `rename_history`

- `id INTEGER PRIMARY KEY AUTOINCREMENT`
- `thread_id TEXT NOT NULL`
- `kind TEXT NOT NULL`
- `old_name TEXT`
- `new_name TEXT NOT NULL`
- `source TEXT NOT NULL`
- `status TEXT NOT NULL`
- `reason TEXT`
- `applied_at TEXT NOT NULL`
- `applied_revision TEXT`
- `operator TEXT`

兼容保留但当前不再作为调度输入的 legacy 列：

- `style`

### `ingest_cursors`

- `rollout_path TEXT PRIMARY KEY`
- `last_offset INTEGER NOT NULL DEFAULT 0`
- `last_size INTEGER NOT NULL DEFAULT 0`
- `last_mtime TEXT`
- `last_scan_at TEXT`

### `maintenance_state`

- `key TEXT PRIMARY KEY`
- `value_json TEXT NOT NULL`

当前主要存放：

- daemon runtime 快照
- rename replay 历史
- 其他维护态 JSON

### `ai_request_logs`

- `id INTEGER PRIMARY KEY AUTOINCREMENT`
- `thread_id TEXT NOT NULL`
- `project_name TEXT`
- `backend TEXT NOT NULL`
- `transport TEXT NOT NULL`
- `status TEXT NOT NULL`
- `started_at TEXT NOT NULL`
- `finished_at TEXT`
- `duration_ms INTEGER`
- `base_url TEXT`
- `model TEXT`
- `prompt_chars INTEGER`
- `prompt_text TEXT`
- `request_payload_json TEXT`
- `response_chars INTEGER`
- `response_text TEXT`
- `response_payload_json TEXT`
- `result_json TEXT`
- `error TEXT`
- `metadata_json TEXT`

## 不在 DB 里的配置

provider profile 与 AI 配置当前不落在 SQLite，而是来自：

- 用户配置文件
- 项目级 `.codex-session-manager.toml`
- 继承的 Codex 配置

## 关键枚举

### `status_estimate`

- `discovered`
- `active`
- `candidate_ready`
- `finalize_ready`
- `applied`
- `idle`
- `archived_hint`
- `missing`

### `rename_history.source`

- `heuristic`
- `ai`
- `hybrid`
- `manual`
- `batch`
- `recovered`

### `rename_history.kind`

- `auto`
- `manual`
- `batch`
- `compact-rewrite`

### `rename_history.status`

- `applied`
- `skipped`
- `failed`
- `preview_only`

### `ai_request_logs.status`

- `running`
- `succeeded`
- `failed`

### `ai_request_logs.transport`

- `responses`
- `openai-compatible`

## Revision 语义

当前仍按 `current_revision == last_applied_revision` 判定 dirty。

`current_revision` 会综合：

- `task_complete_count`
- `first_user_message`
- `last_user_message`
- `last_agent_message`
- `token_total`
- `cwd`
- `model_provider`

## Session DTO 约定

当前 Session 详情不再暴露 `manualOverride` 作为活跃语义。

典型结构：

```json
{
  "threadId": "019d....",
  "cwd": "/path/to/project",
  "projectName": "codex-session-manager",
  "updatedAt": "2026-04-09T03:02:00Z",
  "officialName": "JI",
  "candidateName": "docs · feat · update status page docs",
  "dirty": true,
  "frozen": false,
  "taskCompleteCount": 4,
  "provider": "OpenAI",
  "model": "gpt-5.4",
  "lastAppliedAt": "2026-04-08T20:00:00Z",
  "lastAppliedRevision": "sha256:..."
}
```

## 统计口径

overview 的 rename 统计当前按**会话去重**：

- `renameHistory.applied / aiApplied / manualApplied / autoApplied`
  - 取每个 thread 最新一条 accepted applied 记录
- `activity.buckets`
  - 取每个 thread 最新一条 rename activity 记录

这意味着同一会话多次命名不会在 overview 图表里重复累计。
