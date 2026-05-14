import type { TodoistProject } from './types.js'

/**
 * Walks the parentId chain to the top-level project. Cycles are guarded.
 * Returns the top-level project id, or null if the project is missing or orphaned.
 */
export function resolveTopLevelProjectId(
  projectId: string | null | undefined,
  projectsById: Map<string, TodoistProject>,
): string | null {
  if (!projectId) return null

  let current: TodoistProject | undefined = projectsById.get(projectId)
  if (!current) return null

  const seen = new Set<string>()
  while (current && current.parentId) {
    if (seen.has(current.id)) break
    seen.add(current.id)
    const parent: TodoistProject | undefined = projectsById.get(current.parentId)
    if (!parent) break
    current = parent
  }
  return current ? current.id : null
}
