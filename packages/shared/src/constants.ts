export const DEFAULT_CONFIG_RELATIVE_PATH = ".config/codexnamer/config.toml";
export const DEFAULT_STATE_RELATIVE_PATH = ".local/state/codexnamer";
export const PROJECT_CONFIG_FILENAME = ".codexnamer.toml";
export const SESSION_INDEX_FILENAME = "session_index.jsonl";
export const REDACTED_SECRET = "[redacted]";

export const DEFAULT_WATCH = {
  scanIntervalSeconds: 300,
  candidateIdleSeconds: 120,
  finalizeIdleSeconds: 600,
  renameCooldownSeconds: 900,
  minRolloutGrowthBytes: 4096,
  minTaskCompleteDelta: 1,
  maxAutoRenamesPerSession: 2
} as const;
