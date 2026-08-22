import type { calendar_v3 } from 'googleapis'
import type { GCalClient } from './client.js'

export const MANAGED_DESCRIPTION = 'Managed by todoist-gcal-daemon'

/**
 * Builds the Google Calendar summary from a display name and the configured prefix.
 * If the name already starts with the prefix, it is left alone.
 * An empty prefix disables prefixing.
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

export async function createCalendar(gcal: GCalClient, args: CreateCalendarArgs): Promise<string> {
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

/**
 * Finds an existing calendar whose summary matches the given name.
 * Used to reuse `Todoist:Tasks` / `Todoist:Reminders` after a DB wipe
 * instead of creating duplicates.
 */
export async function findCalendarIdBySummary(
	gcal: GCalClient,
	summary: string,
): Promise<string | null> {
	const wanted = summary.trim().toLowerCase()
	let pageToken: string | undefined
	do {
		const res = await gcal.calendar.calendarList.list({
			maxResults: 250,
			pageToken,
			// Hidden calendars (for example Reminders unchecked in the sidebar)
			// are omitted unless showHidden is true. That used to cause duplicates.
			showHidden: true,
		})
		for (const item of res.data.items ?? []) {
			const name = item.summary?.trim()
			if (name && name.toLowerCase() === wanted && item.id) return item.id
		}
		pageToken = res.data.nextPageToken ?? undefined
	} while (pageToken)
	return null
}
