import type { TodoistTask, TodoistProject } from '../todoist/types.js'
import { resolveTopLevelProjectId } from '../todoist/normalize.js'

export const REMINDER_LABEL = 'reminder'

export type RouteTarget =
  | { kind: 'reminders' }
  | { kind: 'tasks' }
  | { kind: 'project'; topLevelProjectId: string; projectName: string }

export type RoutingContext = {
  projectsById: Map<string, TodoistProject>
  inboxProjectId: string | null
}

/**
 * Implements the deterministic routing rules from architecture.mdc:
 *
 *   1. tasks without a due date are never synced (caller filters them out)
 *   2. tasks with the "reminder" label  -> Reminders calendar
 *   3. tasks in Inbox or with no project -> Tasks calendar
 *   4. otherwise                         -> the top-level project's calendar
 *
 * Subprojects roll up to their top-level parent (Work/ClientA -> Work).
 */
export function route(task: TodoistTask, ctx: RoutingContext): RouteTarget {
  if (task.labels.includes(REMINDER_LABEL)) {
    return { kind: 'reminders' }
  }

  const topId = resolveTopLevelProjectId(task.projectId, ctx.projectsById)
  if (!topId || topId === ctx.inboxProjectId) {
    return { kind: 'tasks' }
  }

  const topProject = ctx.projectsById.get(topId)
  return {
    kind: 'project',
    topLevelProjectId: topId,
    projectName: topProject?.name ?? 'Unknown',
  }
}
