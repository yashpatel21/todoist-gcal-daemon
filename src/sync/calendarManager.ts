import type { GCalClient } from '../gcal/client.js'
import {
	createCalendar,
	deleteCalendar,
	findCalendarIdBySummary,
	formatManagedCalendarSummary,
	getCalendar,
	patchCalendarSummary,
} from '../gcal/calendars.js'
import {
	type CalendarMapping,
	type CalendarMappingsRepo,
	projectCalendarId,
	specialCalendarId,
} from '../db/calendars.js'
import type { TaskMappingsRepo } from '../db/tasks.js'
import type { TodoistSnapshot } from '../todoist/types.js'
import type { RoutedCalendarTarget } from './routing.js'
import { log } from '../logger.js'

export type CalendarManagerDeps = {
	gcal: GCalClient
	calendars: CalendarMappingsRepo
	tasks: TaskMappingsRepo
	reminderCalendarName: string
	tasksCalendarName: string
	managedPrefix: string
}

export class CalendarManager {
	constructor(private readonly deps: CalendarManagerDeps) {}

	private summary(displayName: string): string {
		return formatManagedCalendarSummary(this.deps.managedPrefix, displayName)
	}

	/**
	 * Create a calendar, or reuse one that already exists with the same summary.
	 * Avoids duplicate Todoist:Tasks / Reminders after a DB reset.
	 */
	private async createOrAdoptCalendar(desiredSummary: string): Promise<string> {
		const existingId = await findCalendarIdBySummary(this.deps.gcal, desiredSummary)
		if (existingId) {
			log.info('Reusing existing Google calendar by name', {
				summary: desiredSummary,
				calendarId: existingId,
			})
			return existingId
		}
		log.info('Creating Google calendar', { summary: desiredSummary })
		return createCalendar(this.deps.gcal, { summary: desiredSummary })
	}

	/**
	 * Make sure the Reminders and Tasks calendars exist. Called on startup.
	 * If a mapped calendar was deleted in Google, adopt an existing one by name
	 * or create a new one.
	 */
	async ensureSpecialCalendars(): Promise<void> {
		await this.ensureSpecial('reminders', this.deps.reminderCalendarName)
		await this.ensureSpecial('tasks', this.deps.tasksCalendarName)
	}

	private async ensureSpecial(kind: 'reminders' | 'tasks', displayName: string): Promise<void> {
		const id = specialCalendarId(kind)
		const desiredSummary = this.summary(displayName)
		const existing = this.deps.calendars.findById(id)
		if (existing && existing.status === 'active') {
			const live = await getCalendar(this.deps.gcal, existing.googleCalendarId)
			if (live) {
				if (live.summary !== desiredSummary) {
					await patchCalendarSummary(
						this.deps.gcal,
						existing.googleCalendarId,
						desiredSummary,
					)
				}
				if (existing.displayName !== displayName) {
					this.deps.calendars.updateDisplayName(id, displayName)
				}
				return
			}
			log.warn('Special calendar missing in GCal, adopting or recreating', {
				kind,
				calendarId: existing.googleCalendarId,
			})
			this.deps.tasks.softDeleteByCalendar(existing.googleCalendarId)
		}

		const newId = await this.createOrAdoptCalendar(desiredSummary)
		this.deps.calendars.upsertActive({
			id,
			kind,
			todoistProjectId: null,
			displayName,
			googleCalendarId: newId,
		})
	}

	/**
	 * Resolve a route target to a Google Calendar id.
	 * Project calendars are created lazily the first time they are needed.
	 */
	async resolveCalendarId(target: RoutedCalendarTarget): Promise<string> {
		if (target.kind === 'reminders' || target.kind === 'tasks') {
			const mapping = this.deps.calendars.findSpecial(target.kind)
			if (!mapping) {
				throw new Error(
					`Special calendar mapping missing for ${target.kind}. Was bootstrap run?`,
				)
			}
			const live = await getCalendar(this.deps.gcal, mapping.googleCalendarId)
			if (!live) {
				log.warn('Special calendar disappeared, adopting or recreating', { kind: target.kind })
				this.deps.tasks.softDeleteByCalendar(mapping.googleCalendarId)
				const displayName =
					target.kind === 'reminders'
						? this.deps.reminderCalendarName
						: this.deps.tasksCalendarName
				const newId = await this.createOrAdoptCalendar(this.summary(displayName))
				this.deps.calendars.upsertActive({
					id: mapping.id,
					kind: target.kind,
					todoistProjectId: null,
					displayName,
					googleCalendarId: newId,
				})
				return newId
			}
			return mapping.googleCalendarId
		}

		const id = projectCalendarId(target.topLevelProjectId)
		const desiredSummary = this.summary(target.projectName)
		const existing = this.deps.calendars.findById(id)
		if (existing && existing.status === 'active') {
			const live = await getCalendar(this.deps.gcal, existing.googleCalendarId)
			if (live) {
				if (live.summary !== desiredSummary) {
					log.info('Renaming GCal calendar to match Todoist project', {
						calendarId: existing.googleCalendarId,
						from: live.summary ?? existing.displayName,
						to: desiredSummary,
					})
					await patchCalendarSummary(
						this.deps.gcal,
						existing.googleCalendarId,
						desiredSummary,
					)
				}
				if (existing.displayName !== target.projectName) {
					this.deps.calendars.updateDisplayName(id, target.projectName)
				}
				return existing.googleCalendarId
			}
			log.warn('Project calendar missing in GCal, recreating', {
				projectId: target.topLevelProjectId,
				calendarId: existing.googleCalendarId,
			})
			this.deps.tasks.softDeleteByCalendar(existing.googleCalendarId)
		}

		const newId = await this.createOrAdoptCalendar(desiredSummary)
		this.deps.calendars.upsertActive({
			id,
			kind: 'project',
			todoistProjectId: target.topLevelProjectId,
			displayName: target.projectName,
			googleCalendarId: newId,
		})
		return newId
	}

	/**
	 * Find Todoist projects that were deleted (still in our mapping table, gone
	 * from the current Todoist snapshot, and not the inbox). Deletes their Google
	 * calendars and associated task mappings.
	 *
	 * A project calendar is only deleted when the Todoist project itself is
	 * deleted, not when the project is empty or has no scheduled tasks.
	 */
	async handleDeletedProjects(snapshot: TodoistSnapshot): Promise<void> {
		const existingProjectIds = new Set(snapshot.projects.map((p) => p.id))
		const projectMappings = this.deps.calendars.listActiveProjects()

		for (const m of projectMappings) {
			if (!m.todoistProjectId) continue
			if (existingProjectIds.has(m.todoistProjectId)) continue

			log.info('Detected deleted Todoist project, deleting GCal calendar', {
				projectId: m.todoistProjectId,
				displayName: m.displayName,
				calendarId: m.googleCalendarId,
			})
			try {
				await deleteCalendar(this.deps.gcal, m.googleCalendarId)
			} catch (e) {
				const code = (e as { code?: number }).code
				if (code !== 404 && code !== 410) {
					log.error('Failed to delete GCal calendar', {
						calendarId: m.googleCalendarId,
						error: e,
					})
					throw e
				}
			}
			this.deps.tasks.softDeleteByCalendar(m.googleCalendarId)
			this.deps.calendars.softDelete(m.id)
		}
	}

	/**
	 * Google calendar ids for every active managed calendar.
	 * Used at startup when scanning for recoverable events.
	 */
	listActiveCalendarIds(): string[] {
		return this.deps.calendars.listActive().map((m: CalendarMapping) => m.googleCalendarId)
	}
}
