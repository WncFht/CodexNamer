# 数据模型

## 设计目标

- 把“官方文件层”和“项目状态层”明确分开
- 支持 dirty 检测、自动 rename、手动 override、历史回溯、批量预览
- 保证 WebUI / TUI / CLI 共用同一套状态模型

## 官方文件层

### rollout

来源：

- `~/.codex/sessions/**/rollout-*.jsonl`

用途：

- 发现 sessions
- 解析消息、task_complete、token 使用、provider、cwd

### session_index

来源：

- `~/.codex/session_index.jsonl`

用途：

- 最终可见 name 覆盖层
- latest-wins

结构：

```json
{"id":"<thread-id>","thread_name":"<name>","updated_at":"<rfc3339>"}
```

## 本地数据库

建议使用 SQLite，文件路径：

- `~/.local/state/codex-session-manager/app.db`

## 表设计

### `sessions`

每条记录对应一个 Codex thread。

字段：

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

记录每个 session 当前解析出的内容版本。

字段：

- `thread_id TEXT PRIMARY KEY`
- `current_revision TEXT NOT NULL`
- `last_seen_rollout_size INTEGER`
- `last_seen_rollout_mtime TEXT`
- `last_material_change_at TEXT`
- `last_task_complete_count INTEGER`
- `last_agent_message_fingerprint TEXT`

### `rename_state`

记录 rename 生命周期状态。

字段：

- `thread_id TEXT PRIMARY KEY`
- `current_candidate_name TEXT`
- `current_candidate_source TEXT`
- `current_candidate_generated_at TEXT`
- `current_candidate_style TEXT`
- `last_auto_name TEXT`
- `last_manual_name TEXT`
- `last_applied_name TEXT`
- `last_applied_source TEXT`
- `last_applied_at TEXT`
- `last_applied_style TEXT`
- `last_applied_revision TEXT`
- `preferred_style TEXT`
- `dirty_since_rename INTEGER NOT NULL DEFAULT 0`
- `manual_override INTEGER NOT NULL DEFAULT 0`
- `frozen INTEGER NOT NULL DEFAULT 0`
- `auto_apply_count INTEGER NOT NULL DEFAULT 0`
- `last_auto_apply_attempt_at TEXT`
- `last_auto_apply_success_at TEXT`
- `last_skip_reason TEXT`

### `rename_history`

记录每次 rename 行为。

字段：

- `id INTEGER PRIMARY KEY AUTOINCREMENT`
- `thread_id TEXT NOT NULL`
- `kind TEXT NOT NULL`
- `old_name TEXT`
- `new_name TEXT NOT NULL`
- `source TEXT NOT NULL`
- `style TEXT`
- `status TEXT NOT NULL`
- `reason TEXT`
- `applied_at TEXT NOT NULL`
- `applied_revision TEXT`
- `operator TEXT`

### `ingest_cursors`

记录 rollout 的增量读取游标。

字段：

- `rollout_path TEXT PRIMARY KEY`
- `last_offset INTEGER NOT NULL DEFAULT 0`
- `last_size INTEGER NOT NULL DEFAULT 0`
- `last_mtime TEXT`
- `last_scan_at TEXT`

### `provider_profiles`

记录 AI 命名后端配置。

字段：

- `profile_id TEXT PRIMARY KEY`
- `backend_kind TEXT NOT NULL`
- `display_name TEXT NOT NULL`
- `provider_source TEXT NOT NULL`
- `provider_ref TEXT`
- `base_url TEXT`
- `model TEXT`
- `headers_json TEXT`
- `extra_json TEXT`
- `enabled INTEGER NOT NULL DEFAULT 1`
- `is_default INTEGER NOT NULL DEFAULT 0`

### `maintenance_state`

记录维护信息。

字段：

- `key TEXT PRIMARY KEY`
- `value_json TEXT NOT NULL`

## 状态枚举

### `status_estimate`

- `active`
- `candidate_ready`
- `finalize_ready`
- `idle`
- `archived_hint`
- `missing`

### `source`

- `heuristic`
- `ai`
- `hybrid`
- `manual`
- `batch`
- `recovered`

### `kind`

- `auto`
- `manual`
- `batch`
- `compact-rewrite`

### `status`

- `applied`
- `skipped`
- `failed`
- `preview_only`

## Revision 语义

`current_revision` 应根据会影响 name 的字段计算：

- `task_complete_count`
- `first_user_message`
- `last_user_message`
- `last_agent_message`
- `token_total`
- `cwd`
- `model_provider`

推荐算法：

- 归一化字段
- 拼接为结构化 JSON
- 计算 `sha256`

规则：

- `current_revision == last_applied_revision` -> 非 dirty
- `current_revision != last_applied_revision` -> dirty

## Session 详情 DTO

WebUI/TUI/CLI 应统一读取如下聚合结构：

```json
{
  "threadId": "019d....",
  "cwd": "/path/to/project",
  "projectName": "project",
  "updatedAt": "2026-04-04T12:00:00Z",
  "officialName": "共享 provider 设计",
  "candidateName": "0404-1200 feat(provider): 共享 provider 设计",
  "dirty": true,
  "frozen": false,
  "manualOverride": false,
  "taskCompleteCount": 4,
  "provider": "OpenAI",
  "model": "gpt-5.4",
  "firstUserMessage": "...",
  "lastAgentMessage": "...",
  "lastAppliedAt": "2026-04-03T08:00:00Z",
  "lastAppliedRevision": "sha256:..."
}
```

## 约束

- `thread_id` 是唯一真主键
- 不允许用 name 当主键
- 同一个 name 可以对应多个不同 thread
- 一个 thread 可以有多次 rename 历史
- `rename_state.last_applied_name` 必须与 `rename_history` 中最近一次成功记录一致
- `rename_state.last_applied_style` 必须与该次成功记录的 `style` 一致
