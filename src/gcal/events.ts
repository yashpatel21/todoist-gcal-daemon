import { DateTime } from 'luxon'
import type { calendar_v3 } from 'googleapis'
import type { GCalClient } from './client.js'
import type { TodoistTask } from '../todoist/types.js'

export const TODOIST_ID_PROPERTY = 'todoist_task_id'

const DEFAULT_TIMED_DURATION_MINUTES = 30
const TODOIST_TASK_URL_PREFIX = 'https://app.todoist.com/app/task/'

export type EventPayload = calendar_v3.Schema$Event

export function buildTodoistTaskUrl(taskId: string): string {
  return `${TODOIST_TASK_URL_PREFIX}${taskId}`
}

/** True if the string already has an offset or Z (fixed instant). */
function hasExplicitOffset(iso: string): boolean {
  return /(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(iso)
}

/**
 * Format a local wall-clock time without offset/Z.
 * Google Calendar prefers this together with a separate `timeZone` field.
 */
function formatFloatingDateTime(dt: DateTime): string {
  return dt.toFormat("yyyy-MM-dd'T'HH:mm:ss")
}

/**
 * Builds the Google Calendar event payload for a Todoist task.
 * Stores the Todoist task id in `extendedProperties.private.todoist_task_id`
 * so events can be recovered if the local mapping DB is lost.
 *
 * Todoist due times come in two shapes (API v1):
 * - Floating: `YYYY-MM-DDTHH:MM:SS` with `timezone: null` means wall clock in
 *   the authenticated user's timezone (`userTimezone`).
 * - Fixed: `...Z` (UTC) with a task-level `timezone` means convert to that zone
 *   for display, falling back to `userTimezone`.
 *
 * Timed events always use a local `dateTime` (no offset) plus an IANA `timeZone`
 * so clients show the same wall clock the user set in Todoist. All-day tasks use
 * `start.date` / `end.date`.
 */
export function buildEventPayload(task: TodoistTask, userTimezone: string): EventPayload {
  const todoistUrl = buildTodoistTaskUrl(task.id)
  const userDescription = task.description.trim()
  const description =
    userDescription.length > 0
      ? `${userDescription}\n\nOpen in Todoist: ${todoistUrl}`
      : `Open in Todoist: ${todoistUrl}`

  const base: EventPayload = {
    summary: task.content,
    description,
    source: { title: 'Todoist', url: todoistUrl },
    extendedProperties: {
      private: {
        [TODOIST_ID_PROPERTY]: task.id,
      },
    },
  }

  if (task.due.kind === 'date') {
    const start = task.due.date
    const days = task.duration && task.duration.unit === 'day' ? Math.max(1, task.duration.amount) : 1
    const end = DateTime.fromISO(start).plus({ days }).toISODate()
    if (!end) throw new Error(`Invalid all-day start date: ${start}`)
    return {
      ...base,
      start: { date: start },
      end: { date: end },
    }
  }

  const startStr = task.due.datetime
  const zone = (task.due.timezone && task.due.timezone.trim()) || userTimezone

  let startDt: DateTime
  if (hasExplicitOffset(startStr)) {
    // Fixed UTC instant. Convert to wall clock in the resolved zone.
    startDt = DateTime.fromISO(startStr, { setZone: true }).setZone(zone)
  } else {
    // Floating local time in the user's (or task) timezone. Do not treat as UTC.
    startDt = DateTime.fromISO(startStr, { zone })
  }
  if (!startDt.isValid) {
    throw new Error(`Invalid datetime from Todoist: ${startStr} (zone=${zone})`)
  }

  let durationMinutes = DEFAULT_TIMED_DURATION_MINUTES
  if (task.duration) {
    durationMinutes =
      task.duration.unit === 'minute'
        ? task.duration.amount
        : task.duration.amount * 24 * 60
  }
  const endDt = startDt.plus({ minutes: durationMinutes })

  return {
    ...base,
    start: { dateTime: formatFloatingDateTime(startDt), timeZone: zone },
    end: { dateTime: formatFloatingDateTime(endDt), timeZone: zone },
  }
}

export async function insertEvent(
  gcal: GCalClient,
  calendarId: string,
  payload: EventPayload,
): Promise<string> {
  try {
    const res = await gcal.calendar.events.insert({
      calendarId,
      requestBody: payload,
    })
    const id = res.data.id
    if (!id) throw new Error('Google did not return an event id on insert')
    return id
  } catch (e) {
    throw attachPayload(e, calendarId, payload)
  }
}

export async function updateEvent(
  gcal: GCalClient,
  calendarId: string,
  eventId: string,
  payload: EventPayload,
): Promise<void> {
  try {
    await gcal.calendar.events.update({
      calendarId,
      eventId,
      requestBody: payload,
    })
  } catch (e) {
    throw attachPayload(e, calendarId, payload, eventId)
  }
}

function attachPayload(
  err: unknown,
  calendarId: string,
  payload: EventPayload,
  eventId?: string,
): unknown {
  if (err instanceof Error) {
    const anyErr = err as Error & {
      calendarId?: string
      eventId?: string
      requestPayload?: EventPayload
    }
    anyErr.calendarId = calendarId
    if (eventId) anyErr.eventId = eventId
    anyErr.requestPayload = payload
  }
  return err
}

export async function deleteEvent(
  gcal: GCalClient,
  calendarId: string,
  eventId: string,
): Promise<void> {
  try {
    await gcal.calendar.events.delete({ calendarId, eventId })
  } catch (e) {
    const code = (e as { code?: number }).code
    if (code === 404 || code === 410) return
    throw e
  }
}

/**
 * Lists events in a calendar that carry our todoist_task_id extended property.
 * Used at startup to rebuild missing mappings.
 */
export async function listManagedEvents(
  gcal: GCalClient,
  calendarId: string,
): Promise<calendar_v3.Schema$Event[]> {
  const out: calendar_v3.Schema$Event[] = []
  let pageToken: string | undefined
  do {
    const res = await gcal.calendar.events.list({
      calendarId,
      maxResults: 2500,
      singleEvents: true,
      showDeleted: false,
      privateExtendedProperty: [`${TODOIST_ID_PROPERTY}=`],
      pageToken,
    })
    if (res.data.items) out.push(...res.data.items)
    pageToken = res.data.nextPageToken ?? undefined
  } while (pageToken)
  return out
}

/**
 * Searches managed calendars for an event with the given Todoist task id.
 * Helps avoid duplicates when the local mapping is gone but the event still exists.
 */
export async function findManagedEventByTodoistId(
  gcal: GCalClient,
  calendarIds: string[],
  todoistTaskId: string,
): Promise<{ calendarId: string; event: calendar_v3.Schema$Event } | null> {
  for (const calendarId of calendarIds) {
    try {
      const res = await gcal.calendar.events.list({
        calendarId,
        maxResults: 50,
        singleEvents: true,
        showDeleted: false,
        privateExtendedProperty: [`${TODOIST_ID_PROPERTY}=${todoistTaskId}`],
      })
      const items = res.data.items ?? []
      if (items.length > 0 && items[0]) return { calendarId, event: items[0] }
    } catch (e) {
      const code = (e as { code?: number }).code
      if (code === 404 || code === 410) continue
      throw e
    }
  }
  return null
}

export function getTodoistIdFromEvent(event: calendar_v3.Schema$Event): string | null {
  const v = event.extendedProperties?.private?.[TODOIST_ID_PROPERTY]
  return typeof v === 'string' && v.length > 0 ? v : null
}
