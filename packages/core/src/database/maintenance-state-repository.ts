import type Database from "better-sqlite3";

export function vacuum(db: Database.Database): void {
  db.exec("VACUUM");
}

export function setMaintenanceState(db: Database.Database, key: string, value: unknown): void {
  db.prepare(
    `INSERT INTO maintenance_state (key, value_json)
     VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`
  ).run(key, JSON.stringify(value));
}

export function getMaintenanceState<T>(db: Database.Database, key: string): T | undefined {
  const row = db.prepare(`SELECT value_json FROM maintenance_state WHERE key = ?`).get(key) as
    | Record<string, unknown>
    | undefined;

  if (!row || typeof row.value_json !== "string") {
    return undefined;
  }

  try {
    return JSON.parse(row.value_json) as T;
  } catch {
    return undefined;
  }
}
