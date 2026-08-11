/**
 * Stand-in for `@tauri-apps/api/core` used by `pnpm dev:mock`.
 *
 * `vite.mock.config.ts` aliases the Tauri module to this file, so the entire
 * app — unmodified — runs in a plain browser against a fixture generated from a
 * real repository (`node scripts/gen-fixture.mjs <repo>`). It exists so UI work
 * and UI regression checks don't need a Rust build, and so large-repo
 * behaviour can be exercised deterministically.
 *
 * Mutating commands update the in-memory fixture just enough to keep the UI
 * coherent; this is a UI harness, not a git implementation.
 */
import type {
  ConflictState,
  FileChanged,
  FileDiff,
  GraphFilter,
  GraphPage,
  GraphRow,
  StashEntry,
  WorkingTree,
} from '../types'

interface Fixture {
  repoPath: string
  repoName: string
  head: string
  laneCount: number
  rows: GraphRow[]
  diffs: Record<string, FileDiff[]>
  filesChanged: Record<string, FileChanged[]>
  stagedFiles: FileChanged[]
  unstagedFiles: FileChanged[]
  stagedDiff: FileDiff[]
  unstagedDiff: FileDiff[]
}

/** Simulated IPC latency, so loading states are exercised rather than skipped. */
const LATENCY_MS = Number(new URLSearchParams(location.search).get('latency') ?? 12)

/**
 * Several repositories are served from the one fixture, so tab switching can be
 * exercised here. Each keeps its own mutable state, exactly as separate repos
 * would — without this the harness could only ever open a single tab, which is
 * how a tab-switching bug reached the app.
 */
const EXTRA_REPOS = ['alpha', 'beta', 'gamma']

interface RepoState {
  id: string
  path: string
  name: string
  head: string
  staged: FileChanged[]
  unstaged: FileChanged[]
  stashes: StashEntry[]
}

let data: Fixture
const repos = new Map<string, RepoState>()
let nextRepo = 0

function repoFor(path: string): RepoState {
  const existing = [...repos.values()].find(repo => repo.path === path)
  if (existing) return existing
  const name = path.split('/').filter(Boolean).pop() ?? 'repo'
  const state: RepoState = {
    id: `mock-${repos.size}`,
    path,
    name,
    head: data.head,
    staged: data.stagedFiles.map(f => ({ ...f })),
    unstaged: data.unstagedFiles.map(f => ({ ...f })),
    stashes: [
      { index: 0, message: 'wip: parser rewrite', branch: data.head },
      { index: 1, message: 'spike: alternate layout', branch: data.head },
    ],
  }
  repos.set(state.id, state)
  return state
}

function byId(id: string): RepoState {
  return repos.get(id) ?? repoFor(data.repoPath)
}

const ready = (async () => {
  const response = await fetch('/fixture.json')
  if (!response.ok) {
    throw new Error(
      'No fixture found. Generate one first: node scripts/gen-fixture.mjs <repo-path>',
    )
  }
  data = (await response.json()) as Fixture
})()

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

function withCurrentBranch(rows: GraphRow[], head: string): GraphRow[] {
  return rows.map(row => {
    if (!row.refs.some(r => r.kind === 'LocalBranch')) return row
    return {
      ...row,
      refs: row.refs.map(r =>
        r.kind === 'LocalBranch' ? { ...r, is_current: r.name === head } : r,
      ),
    }
  })
}

/**
 * Apply a branch filter to the fixture the way the walk would.
 *
 * The backend seeds a revwalk from the selected refs; here the rows are
 * already walked, so reachability is recomputed over `parent_shas`. Close
 * enough to exercise the UI, and it keeps the harness honest about the one
 * thing that matters: filtering removes commits, not just badges.
 */
function applyFilter(rows: GraphRow[], filter: GraphFilter | undefined): GraphRow[] {
  if (!filter) return rows
  const visible = (row: GraphRow) =>
    row.refs.filter(ref => filter.includeRemotes || ref.kind !== 'RemoteBranch')

  const seeds = new Set<string>()
  for (const row of rows) {
    for (const ref of visible(row)) {
      if (ref.kind === 'Head') continue
      if (filter.branches.length === 0 || filter.branches.includes(ref.name)) seeds.add(row.sha)
    }
  }

  const byShaRow = new Map(rows.map(row => [row.sha, row]))
  const reachable = new Set<string>()
  const queue = [...seeds]
  while (queue.length > 0) {
    const sha = queue.pop()!
    if (reachable.has(sha)) continue
    reachable.add(sha)
    for (const parent of byShaRow.get(sha)?.parent_shas ?? []) queue.push(parent)
  }

  return rows
    .filter(row => reachable.has(row.sha))
    .map(row => ({ ...row, refs: visible(row) }))
}

function graphPage(
  repo: RepoState,
  cursor: string | null,
  limit: number,
  filter: GraphFilter | undefined,
): GraphPage {
  const all = applyFilter(data.rows, filter)
  const start = cursor ? Number(cursor) : 0
  const end = Math.min(start + limit, all.length)
  const rows = withCurrentBranch(all.slice(start, end), repo.head)
  const laneCount = rows.reduce(
    (max, row) => row.segments.reduce((m, s) => Math.max(m, s.from + 1, s.to + 1), Math.max(max, row.lane + 1)),
    1,
  )
  return {
    rows,
    cursor: end < all.length ? String(end) : null,
    lane_count: laneCount,
    total: all.length,
    truncated: false,
    complete: end >= all.length,
  }
}

function workingTree(repo: RepoState): WorkingTree {
  return { staged: repo.staged, unstaged: repo.unstaged }
}

/** One file's diff, the way the backend now serves it. */
function fileDiff(files: FileDiff[], path: string): FileDiff | null {
  return files.find(file => (file.new_path || file.old_path) === path) ?? null
}

export async function invoke<T = unknown>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  await ready
  await sleep(cmd === 'graph_page' ? LATENCY_MS * 4 : LATENCY_MS)

  const repo = typeof args.repoId === 'string' ? byId(args.repoId) : repoFor(data.repoPath)

  switch (cmd) {
    case 'pick_directory': {
      // Hand back a different path each time so several tabs can be opened.
      const suffix = EXTRA_REPOS[nextRepo % EXTRA_REPOS.length]
      nextRepo += 1
      return (nextRepo === 1 ? data.repoPath : `${data.repoPath}-${suffix}`) as T
    }
    case 'scan_repos':
      return [{ path: data.repoPath, name: data.repoName }] as T
    case 'open_repo': {
      const opened = repoFor(String(args.path))
      return { repo_id: opened.id, path: opened.path, name: opened.name } as T
    }
    case 'close_repo':
      return undefined as T
    case 'repo_status':
      return { branch: repo.head, detached: false, tracking: { ahead: 2, behind: 0 } } as T

    case 'graph_page':
      return graphPage(
        repo,
        (args.cursor as string | null) ?? null,
        (args.limit as number) ?? 2000,
        args.filter as GraphFilter | undefined,
      ) as T

    case 'commit_files':
      return (data.filesChanged[String(args.sha)] ?? []) as T
    case 'commit_file_diff':
      return fileDiff(data.diffs[String(args.sha)] ?? [], String(args.path)) as T
    case 'commit_detail': {
      const row = data.rows.find(r => r.sha === args.sha)
      return {
        sha: String(args.sha),
        summary: row?.message ?? '',
        body: 'Body text is only present in the real backend.',
        author_name: row?.author_name ?? '',
        author_email: row?.author_email ?? '',
        author_timestamp: row?.author_timestamp ?? 0,
        committer_name: row?.author_name ?? '',
        committer_email: row?.author_email ?? '',
        committer_timestamp: row?.author_timestamp ?? 0,
        committed_by_other: false,
        parent_shas: row?.parent_shas ?? [],
      } as T
    }
    case 'list_refs': {
      const seen = new Map<string, unknown>()
      for (const row of data.rows) {
        for (const ref of row.refs) {
          if (ref.kind === 'Head') continue
          const kind =
            ref.kind === 'LocalBranch' ? 'local' : ref.kind === 'RemoteBranch' ? 'remote' : 'tag'
          if (!seen.has(ref.name)) {
            seen.set(ref.name, {
              name: ref.name,
              kind,
              sha: row.sha,
              is_current: kind === 'local' && ref.name === repo.head,
              timestamp: row.author_timestamp,
            })
          }
        }
      }
      return [...seen.values()] as T
    }

    case 'working_tree':
      return workingTree(repo) as T
    case 'worktree_file_diff':
      return fileDiff(
        args.staged ? data.stagedDiff.concat(data.unstagedDiff) : data.unstagedDiff.concat(data.stagedDiff),
        String(args.path),
      ) as T
    case 'stage_all':
      repo.staged = [...repo.staged, ...repo.unstaged.map(f => ({ ...f, staged: true }))]
      repo.unstaged = []
      return undefined as T
    case 'unstage_all':
      repo.unstaged = [...repo.unstaged, ...repo.staged.map(f => ({ ...f, staged: false }))]
      repo.staged = []
      return undefined as T
    case 'stage_file': {
      const file = repo.unstaged.find(f => f.path === args.path)
      if (file) {
        repo.unstaged = repo.unstaged.filter(f => f !== file)
        repo.staged = [...repo.staged, { ...file, staged: true }]
      }
      return undefined as T
    }
    case 'unstage_file': {
      const file = repo.staged.find(f => f.path === args.path)
      if (file) {
        repo.staged = repo.staged.filter(f => f !== file)
        repo.unstaged = [...repo.unstaged, { ...file, staged: false }]
      }
      return undefined as T
    }
    case 'discard_file':
      repo.unstaged = repo.unstaged.filter(f => f.path !== args.path)
      return undefined as T
    case 'commit_staged':
    case 'amend_commit':
      repo.staged = []
      return undefined as T
    case 'user_email':
      return 'you@example.com' as T

    case 'checkout':
      repo.head = String(args.refName).replace(/^origin\//, '')
      return undefined as T
    case 'push_impact':
      return { ahead: 2, behind: 0, rewrites: false } as T
    case 'remote_branch_exists':
      return true as T

    case 'stash_list':
      return repo.stashes as T
    case 'stash_push':
      repo.stashes = [
        { index: 0, message: (args.message as string) || 'WIP', branch: repo.head },
        ...repo.stashes.map(s => ({ ...s, index: s.index + 1 })),
      ]
      repo.staged = []
      repo.unstaged = []
      return undefined as T
    case 'stash_pop':
    case 'stash_drop':
      repo.stashes = repo.stashes
        .filter(s => s.index !== (args.index as number))
        .map((s, i) => ({ ...s, index: i }))
      return undefined as T
    case 'stash_apply':
      return undefined as T

    case 'conflict_state':
      return {
        in_merge: false,
        in_rebase: false,
        in_cherry_pick: false,
        in_revert: false,
        conflicted_paths: [],
      } satisfies ConflictState as T

    default:
      // Branch and remote mutations that need no simulated state just succeed.
      return undefined as T
  }
}
