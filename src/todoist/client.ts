import { TodoistApi } from '@doist/todoist-sdk'
import type { TodoistProject, TodoistTask, TodoistSnapshot, TodoistDue } from './types.js'

const PAGE_LIMIT = 200

export class TodoistClient {
  private readonly api: TodoistApi

  constructor(apiToken: string) {
    this.api = new TodoistApi(apiToken)
  }

  /**
   * Fetches the full Todoist state (active projects + active tasks) and normalizes it.
   * - Projects: paginates `getProjects`, drops archived/deleted, identifies the inbox.
   * - Tasks: paginates `getTasks`, drops tasks without due dates (per architecture).
   */
  async fetchSnapshot(): Promise<TodoistSnapshot> {
    const rawProjects = await this.fetchAllProjects()
    const projects: TodoistProject[] = rawProjects
      .filter((p) => !p.isArchived && !p.isDeleted)
      .map(normalizeProject)

    const projectsById = new Map<string, TodoistProject>()
    let inboxProjectId: string | null = null
    for (const p of projects) {
      projectsById.set(p.id, p)
      if (p.isInbox) inboxProjectId = p.id
    }

    const rawTasks = await this.fetchAllTasks()
    const tasks: TodoistTask[] = []
    for (const t of rawTasks) {
      const normalized = normalizeTask(t)
      if (normalized) tasks.push(normalized)
    }

    return { projects, projectsById, inboxProjectId, tasks }
  }

  private async fetchAllProjects(): Promise<UnknownProject[]> {
    const all: UnknownProject[] = []
    let cursor: string | null = null
    do {
      const page = await this.api.getProjects({ cursor, limit: PAGE_LIMIT })
      all.push(...(page.results as UnknownProject[]))
      cursor = page.nextCursor ?? null
    } while (cursor)
    return all
  }

  private async fetchAllTasks(): Promise<UnknownTask[]> {
    const all: UnknownTask[] = []
    let cursor: string | null = null
    do {
      const page = await this.api.getTasks({ cursor, limit: PAGE_LIMIT })
      all.push(...(page.results as UnknownTask[]))
      cursor = page.nextCursor ?? null
    } while (cursor)
    return all
  }
}

// ----- normalization -----

type UnknownProject = {
  id: string
  name: string
  parentId?: string | null
  inboxProject?: boolean
  isArchived: boolean
  isDeleted: boolean
  updatedAt: Date | string | null
}

type UnknownTask = {
  id: string
  content: string
  description?: string
  projectId: string
  labels: string[]
  due: {
    date: string
    datetime?: string | null
    timezone?: string | null
    isRecurring?: boolean
  } | null
  duration?: { amount: number; unit: 'minute' | 'day' } | null
  updatedAt: Date | string | null
  isDeleted?: boolean
  checked?: boolean
}

function normalizeProject(p: UnknownProject): TodoistProject {
  return {
    id: p.id,
    name: p.name,
    parentId: p.parentId ?? null,
    isInbox: p.inboxProject === true,
    isArchived: p.isArchived,
    isDeleted: p.isDeleted,
    updatedAt: toIso(p.updatedAt),
  }
}

function normalizeTask(t: UnknownTask): TodoistTask | null {
  if (t.isDeleted || t.checked) return null
  if (!t.due) return null

  const due = normalizeDue(t.due)
  if (!due) return null

  return {
    id: t.id,
    content: t.content,
    description: t.description ?? '',
    projectId: t.projectId,
    labels: t.labels ?? [],
    due,
    duration: t.duration ?? null,
    updatedAt: toIso(t.updatedAt) ?? new Date(0).toISOString(),
    isRecurring: t.due.isRecurring === true,
  }
}

function normalizeDue(due: NonNullable<UnknownTask['due']>): TodoistDue | null {
  const tz = (due.timezone ?? null) || null

  // The Todoist v1 API folds timed tasks into the `date` field as a full
  // RFC3339 datetime; `datetime` is a legacy alias that may be null even for
  // timed tasks. Use the presence of "T" as the kind discriminator, regardless
  // of which field the string came from.
  const datetimeCandidate =
    due.datetime && due.datetime.length > 0 ? due.datetime : null
  if (datetimeCandidate) {
    return { kind: 'datetime', datetime: datetimeCandidate, timezone: tz }
  }

  if (due.date && due.date.length > 0) {
    if (due.date.includes('T')) {
      return { kind: 'datetime', datetime: due.date, timezone: tz }
    }
    return { kind: 'date', date: due.date, timezone: tz }
  }
  return null
}

function toIso(v: Date | string | null | undefined): string | null {
  if (!v) return null
  if (v instanceof Date) return v.toISOString()
  // Already a string; trust the SDK's ISO formatting.
  return v
}
