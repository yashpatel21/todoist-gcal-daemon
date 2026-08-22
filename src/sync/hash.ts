import { createHash } from 'node:crypto'
import type { TodoistTask } from '../todoist/types.js'
import type { RouteTarget } from './routing.js'

/**
 * Content hash for change detection. Includes title, due datetime/date, task
 * timezone, userTimezone, labels, project id, duration, and route target.
 * Bump `v` when the hash recipe or GCal payload meaning changes.
 */
export function computeContentHash(
  task: TodoistTask,
  target: RouteTarget,
  userTimezone: string,
): string {
	const labels = [...task.labels].sort()
	const due =
		task.due.kind === 'date'
			? { kind: 'date', value: task.due.date, tz: task.due.timezone }
			: { kind: 'datetime', value: task.due.datetime, tz: task.due.timezone }

  const canonical = JSON.stringify({
    v: 4,
    title: task.content,
    description: task.description,
    due,
    labels,
    projectId: task.projectId,
    duration: task.duration,
    userTimezone,
    target: targetKey(target),
  })

	return createHash('sha256').update(canonical).digest('hex')
}

function targetKey(t: RouteTarget): string {
	switch (t.kind) {
		case 'none':
			return 'none'
		case 'reminders':
			return 'reminders'
		case 'tasks':
			return 'tasks'
		case 'project':
			return `project:${t.topLevelProjectId}`
	}
}
