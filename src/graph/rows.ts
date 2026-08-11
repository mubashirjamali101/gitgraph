/**
 * Turning backend rows into the rows the UI actually shows: the working-tree
 * pseudo-row on top, and search matching.
 *
 * Search highlights and jumps rather than filtering. Removing rows from a graph
 * leaves the remaining edges implying parent/child links that do not exist —
 * the drawing would be a lie. Highlighting keeps the history honest and still
 * gets you to the commit you are looking for.
 */
import type { GraphRow, GraphSegment, WorkingTree } from '../types'
import { WORKING_TREE_SHA } from '../store'

export interface WorkingTreeSummary {
  staged: number
  unstaged: number
  total: number
}

export function summarizeWorkingTree(tree: WorkingTree | null): WorkingTreeSummary {
  if (!tree) return { staged: 0, unstaged: 0, total: 0 }
  // A file changed both in the index and the worktree is one file to the user.
  const paths = new Set([...tree.staged.map(f => f.path), ...tree.unstaged.map(f => f.path)])
  return { staged: tree.staged.length, unstaged: tree.unstaged.length, total: paths.size }
}

/**
 * Build the row that represents uncommitted work, sitting above the tip commit
 * and joined to it by the lanes that continue into it.
 */
function workingTreeRow(tip: GraphRow | undefined, summary: WorkingTreeSummary): GraphRow {
  const lane = tip?.lane ?? 0
  const color = tip?.color ?? 0

  // Lanes entering the tip from above are exactly the lanes its own segments
  // start from, plus the lane its dot sits in.
  const lanes = new Map<number, number>([[lane, color]])
  for (const segment of tip?.segments ?? []) {
    if (!lanes.has(segment.from)) lanes.set(segment.from, segment.color)
  }
  const segments: GraphSegment[] = [...lanes].map(([from, laneColor]) => ({
    from,
    to: from,
    color: laneColor,
  }))

  const label =
    summary.total === 1 ? '1 uncommitted change' : `${summary.total} uncommitted changes`

  return {
    sha: WORKING_TREE_SHA,
    short_sha: '',
    message: label,
    author_name: '',
    author_email: '',
    author_timestamp: Math.floor(Date.now() / 1000),
    refs: [],
    lane,
    color,
    segments,
    parent_shas: tip ? [tip.sha] : [],
  }
}

/** The rows to render: uncommitted work first, then history. */
export function buildDisplayRows(rows: GraphRow[], tree: WorkingTree | null): GraphRow[] {
  const summary = summarizeWorkingTree(tree)
  if (summary.total === 0) return rows
  return [workingTreeRow(rows[0], summary), ...rows]
}

export function isWorkingTreeRow(row: GraphRow): boolean {
  return row.sha === WORKING_TREE_SHA
}

/** Indices of rows matching a query, in display order. */
export function findMatches(rows: GraphRow[], query: string): number[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return []

  const matches: number[] = []
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index]
    if (isWorkingTreeRow(row)) continue
    if (
      row.message.toLowerCase().includes(needle) ||
      row.author_name.toLowerCase().includes(needle) ||
      row.author_email.toLowerCase().includes(needle) ||
      row.sha.startsWith(needle) ||
      row.refs.some(ref => ref.kind !== 'Head' && ref.name.toLowerCase().includes(needle))
    ) {
      matches.push(index)
    }
  }
  return matches
}

/** Next match at or after `from`, wrapping around. */
export function nextMatch(matches: number[], from: number, direction: 1 | -1): number | null {
  if (matches.length === 0) return null
  if (direction === 1) {
    return matches.find(index => index > from) ?? matches[0]
  }
  for (let i = matches.length - 1; i >= 0; i--) {
    if (matches[i] < from) return matches[i]
  }
  return matches[matches.length - 1]
}
