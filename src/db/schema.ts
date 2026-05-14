import type Database from 'better-sqlite3'

type Migration = {
  version: number
  name: string
  up: string
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'init',
    up: `
      CREATE TABLE IF NOT EXISTS task_mappings (
        todoist_task_id     TEXT PRIMARY KEY,
        google_event_id     TEXT NOT NULL,
        google_calendar_id  TEXT NOT NULL,
        todoist_updated_at  TEXT NOT NULL,
        content_hash        TEXT NOT NULL,
        last_synced_at      TEXT NOT NULL,
        status              TEXT NOT NULL CHECK (status IN ('active','deleted'))
      );

      CREATE INDEX IF NOT EXISTS idx_task_mappings_status
        ON task_mappings(status);

      CREATE INDEX IF NOT EXISTS idx_task_mappings_calendar
        ON task_mappings(google_calendar_id);

      CREATE TABLE IF NOT EXISTS calendar_mappings (
        id                  TEXT PRIMARY KEY,
        kind                TEXT NOT NULL CHECK (kind IN ('reminders','tasks','project')),
        todoist_project_id  TEXT,
        display_name        TEXT NOT NULL,
        google_calendar_id  TEXT NOT NULL,
        status              TEXT NOT NULL CHECK (status IN ('active','deleted')),
        created_at          TEXT NOT NULL,
        updated_at          TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_calendar_mappings_kind
        ON calendar_mappings(kind);

      CREATE INDEX IF NOT EXISTS idx_calendar_mappings_project
        ON calendar_mappings(todoist_project_id);
    `,
  },
]

/**
 * Applies any unapplied migrations in order. Idempotent: safe to call on every startup.
 * Uses a single `schema_migrations` table to track applied versions.
 */
export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name    TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)

  const appliedRows = db.prepare('SELECT version FROM schema_migrations').all() as Array<{
    version: number
  }>
  const applied = new Set(appliedRows.map((r) => r.version))

  const insertVersion = db.prepare(
    'INSERT INTO schema_migrations (version, name) VALUES (?, ?)',
  )

  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue
    const tx = db.transaction(() => {
      db.exec(m.up)
      insertVersion.run(m.version, m.name)
    })
    tx()
  }
}
