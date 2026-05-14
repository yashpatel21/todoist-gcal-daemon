/**
 * Internal Todoist representations, decoupled from the SDK's evolving schema.
 * Only the fields the daemon actually uses are kept.
 */

export type TodoistProject = {
  id: string
  name: string
  parentId: string | null
  isInbox: boolean
  isArchived: boolean
  isDeleted: boolean
  updatedAt: string | null
}

export type TodoistDue =
  | { kind: 'date'; date: string; timezone: string | null }
  | { kind: 'datetime'; datetime: string; timezone: string | null }

export type TodoistDuration = { amount: number; unit: 'minute' | 'day' }

export type TodoistTask = {
  id: string
  content: string
  description: string
  projectId: string
  labels: string[]
  due: TodoistDue
  duration: TodoistDuration | null
  updatedAt: string
  isRecurring: boolean
}

export type TodoistSnapshot = {
  projects: TodoistProject[]
  projectsById: Map<string, TodoistProject>
  inboxProjectId: string | null
  tasks: TodoistTask[]
}
