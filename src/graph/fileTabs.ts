/** Identity of a file opened as an editor tab inside a repository. */

export type FileTabKind = 'worktree' | 'commit'

export interface FileTab {
  id: string
  path: string
  kind: FileTabKind
  /** Commit SHA when `kind` is `commit`. */
  sha: string | null
  /** Which side of the index, when `kind` is `worktree`. */
  staged: boolean
}

export function worktreeTabId(path: string): string {
  return `wt:${path}`
}

export function commitTabId(sha: string, path: string): string {
  return `c:${sha}:${path}`
}

export function fileTabLabel(tab: FileTab): string {
  const slash = tab.path.lastIndexOf('/')
  return slash >= 0 ? tab.path.slice(slash + 1) : tab.path
}
