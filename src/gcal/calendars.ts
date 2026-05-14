import type { calendar_v3 } from 'googleapis'
import type { GCalClient } from './client.js'

export const MANAGED_DESCRIPTION = 'Managed by todoist-gcal-daemon'

/**
 * Renders a logical display name (as stored in `calendar_mappings.display_name`)
 * into the Google Calendar `summary` field by applying the configured prefix.
 * Idempotent: a name that already starts with the prefix is returned unchanged.
 * An empty prefix disables the feature entirely.
 */
export function formatManagedCalendarSummary(prefix: string, displayName: string): string {
  if (prefix.length === 0) return displayName
  if (displayName.startsWith(prefix)) return displayName
  return `${prefix}${displayName}`
}

export type CreateCalendarArgs = {
  summary: string
  description?: string
  timeZone?: string
}

export async function createCalendar(
  gcal: GCalClient,
  args: CreateCalendarArgs,
): Promise<string> {
  const res = await gcal.calendar.calendars.insert({
    requestBody: {
      summary: args.summary,
      description: args.description ?? MANAGED_DESCRIPTION,
      timeZone: args.timeZone,
    },
  })
  const id = res.data.id
  if (!id) throw new Error('Google did not return a calendar id on insert')
  return id
}

export async function deleteCalendar(gcal: GCalClient, calendarId: string): Promise<void> {
  await gcal.calendar.calendars.delete({ calendarId })
}

export async function getCalendar(
  gcal: GCalClient,
  calendarId: string,
): Promise<calendar_v3.Schema$Calendar | null> {
  try {
    const res = await gcal.calendar.calendars.get({ calendarId })
    return res.data
  } catch (e) {
    const code = (e as { code?: number }).code
    if (code === 404 || code === 410) return null
    throw e
  }
}

export async function patchCalendarSummary(
  gcal: GCalClient,
  calendarId: string,
  summary: string,
): Promise<void> {
  await gcal.calendar.calendars.patch({
    calendarId,
    requestBody: { summary },
  })
}
