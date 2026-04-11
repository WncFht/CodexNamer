import type { RenameSource } from "@codexnamer/shared";

export type SessionRow = {
  thread_id: string;
  rollout_path: string;
  cwd: string | null;
  project_name: string | null;
  created_at: string | null;
  updated_at: string | null;
  model_provider: string | null;
  model: string | null;
  first_user_message: string | null;
  last_user_message: string | null;
  last_agent_message: string | null;
  task_complete_count: number;
  token_total: number;
  latest_official_name: string | null;
  latest_official_name_updated_at: string | null;
  status_estimate: string | null;
  archived_hint: number;
  current_revision: string | null;
  current_candidate_name: string | null;
  current_candidate_rule_signature: string | null;
  dirty_since_rename: number | null;
  force_rewrite: number | null;
  last_applied_name: string | null;
  last_applied_source: RenameSource | null;
  last_applied_revision: string | null;
  last_applied_at: string | null;
  last_applied_rule_signature: string | null;
  frozen: number | null;
};

export function toBoolean(value: number | null | undefined): boolean {
  return value === 1;
}
