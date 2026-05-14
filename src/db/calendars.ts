import type { DB } from './db.js'
import { nowIso } from './db.js'

export type CalendarKind = 'reminders' | 'tasks' | 'project'
export type CalendarStatus = 'active' | 'deleted'

export type CalendarMappingRow = {
  id: string
  kind: CalendarKind
  todoist_project_id: string | null
  display_name: string
  google_calendar_id: string
  status: CalendarStatus
  created_at: string
  updated_at: string
}

export type CalendarMapping = {
  id: string
  kind: CalendarKind
  todoistProjectId: string | null
  displayName: string
  googleCalendarId: string
  status: CalendarStatus
  createdAt: string
  updatedAt: string
}

export function specialCalendarId(kind: 'reminders' | 'tasks'): string {
  return `special:${kind}`
}

export function projectCalendarId(todoistProjectId: string): string {
  return `project:${todoistProjectId}`
}

function fromRow(r: CalendarMappingRow): CalendarMapping {
  return {
    id: r.id,
    kind: r.kind,
    todoistProjectId: r.todoist_project_id,
    displayName: r.display_name,
    googleCalendarId: r.google_calendar_id,
    status: r.status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

export class CalendarMappingsRepo {
  constructor(private readonly db: DB) {}

  findById(id: string): CalendarMapping | null {
    const row = this.db
      .prepare('SELECT * FROM calendar_mappings WHERE id = ?')
      .get(id) as CalendarMappingRow | undefined
    return row ? fromRow(row) : null
  }

  findByProjectId(todoistProjectId: string): CalendarMapping | null {
    return this.findById(projectCalendarId(todoistProjectId))
  }

  findSpecial(kind: 'reminders' | 'tasks'): CalendarMapping | null {
    return this.findById(specialCalendarId(kind))
  }

  listActive(): CalendarMapping[] {
    const rows = this.db
      .prepare("SELECT * FROM calendar_mappings WHERE status = 'active'")
      .all() as CalendarMappingRow[]
    return rows.map(fromRow)
  }

  listActiveProjects(): CalendarMapping[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM calendar_mappings WHERE status = 'active' AND kind = 'project'",
      )
      .all() as CalendarMappingRow[]
    return rows.map(fromRow)
  }

  upsertActive(args: {
    id: string
    kind: CalendarKind
    todoistProjectId: string | null
    displayName: string
    googleCalendarId: string
  }): void {
    const now = nowIso()
    this.db
      .prepare(
        `INSERT INTO calendar_mappings (
           id, kind, todoist_project_id, display_name, google_calendar_id,
           status, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           kind               = excluded.kind,
           todoist_project_id = excluded.todoist_project_id,
           display_name       = excluded.display_name,
           google_calendar_id = excluded.google_calendar_id,
           status             = 'active',
           updated_at         = excluded.updated_at`,
      )
      .run(
        args.id,
        args.kind,
        args.todoistProjectId,
        args.displayName,
        args.googleCalendarId,
        now,
        now,
      )
  }

  updateDisplayName(id: string, displayName: string): void {
    this.db
      .prepare('UPDATE calendar_mappings SET display_name = ?, updated_at = ? WHERE id = ?')
      .run(displayName, nowIso(), id)
  }

  softDelete(id: string): void {
    this.db
      .prepare("UPDATE calendar_mappings SET status = 'deleted', updated_at = ? WHERE id = ?")
      .run(nowIso(), id)
  }
}
