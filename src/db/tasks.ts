import type { DB } from './db.js'
import { nowIso } from './db.js'

export type TaskMappingStatus = 'active' | 'deleted'

export type TaskMappingRow = {
  todoist_task_id: string
  google_event_id: string
  google_calendar_id: string
  todoist_updated_at: string
  content_hash: string
  last_synced_at: string
  status: TaskMappingStatus
}

export type TaskMapping = {
  todoistTaskId: string
  googleEventId: string
  googleCalendarId: string
  todoistUpdatedAt: string
  contentHash: string
  lastSyncedAt: string
  status: TaskMappingStatus
}

function fromRow(r: TaskMappingRow): TaskMapping {
  return {
    todoistTaskId: r.todoist_task_id,
    googleEventId: r.google_event_id,
    googleCalendarId: r.google_calendar_id,
    todoistUpdatedAt: r.todoist_updated_at,
    contentHash: r.content_hash,
    lastSyncedAt: r.last_synced_at,
    status: r.status,
  }
}

export class TaskMappingsRepo {
  constructor(private readonly db: DB) {}

  findById(todoistTaskId: string): TaskMapping | null {
    const row = this.db
      .prepare('SELECT * FROM task_mappings WHERE todoist_task_id = ?')
      .get(todoistTaskId) as TaskMappingRow | undefined
    return row ? fromRow(row) : null
  }

  listActive(): TaskMapping[] {
    const rows = this.db
      .prepare("SELECT * FROM task_mappings WHERE status = 'active'")
      .all() as TaskMappingRow[]
    return rows.map(fromRow)
  }

  listActiveByCalendar(googleCalendarId: string): TaskMapping[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM task_mappings WHERE status = 'active' AND google_calendar_id = ?",
      )
      .all(googleCalendarId) as TaskMappingRow[]
    return rows.map(fromRow)
  }

  /**
   * Upserts an active mapping. The architecture requires that callers only invoke this
   * AFTER a successful Google Calendar write.
   */
  upsertActive(args: {
    todoistTaskId: string
    googleEventId: string
    googleCalendarId: string
    todoistUpdatedAt: string
    contentHash: string
  }): void {
    const now = nowIso()
    this.db
      .prepare(
        `INSERT INTO task_mappings (
           todoist_task_id, google_event_id, google_calendar_id,
           todoist_updated_at, content_hash, last_synced_at, status
         ) VALUES (?, ?, ?, ?, ?, ?, 'active')
         ON CONFLICT(todoist_task_id) DO UPDATE SET
           google_event_id    = excluded.google_event_id,
           google_calendar_id = excluded.google_calendar_id,
           todoist_updated_at = excluded.todoist_updated_at,
           content_hash       = excluded.content_hash,
           last_synced_at     = excluded.last_synced_at,
           status             = 'active'`,
      )
      .run(
        args.todoistTaskId,
        args.googleEventId,
        args.googleCalendarId,
        args.todoistUpdatedAt,
        args.contentHash,
        now,
      )
  }

  softDelete(todoistTaskId: string): void {
    this.db
      .prepare(
        "UPDATE task_mappings SET status = 'deleted', last_synced_at = ? WHERE todoist_task_id = ?",
      )
      .run(nowIso(), todoistTaskId)
  }

  softDeleteByCalendar(googleCalendarId: string): number {
    const r = this.db
      .prepare(
        "UPDATE task_mappings SET status = 'deleted', last_synced_at = ? WHERE google_calendar_id = ? AND status = 'active'",
      )
      .run(nowIso(), googleCalendarId)
    return r.changes
  }
}
