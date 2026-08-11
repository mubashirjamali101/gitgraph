/**
 * Generates a mock-IPC fixture from a real git repository.
 *
 *   node scripts/gen-fixture.mjs <repo-path> [out-file] [diff-count]
 *
 * The fixture feeds `src/mock/ipc.ts`, which stands in for the Tauri IPC layer
 * when running `pnpm dev:mock`. That lets the whole UI be driven in a plain
 * browser — with real commit topology — for development and regression work.
 *
 * Lane assignment intentionally mirrors the Rust engine so fixtures stay
 * representative; see src-tauri/src/graph/lanes.rs.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const repoPath = process.argv[2] ?? '.'
const outFile = resolve(process.argv[3] ?? 'public/fixture.json')
const diffCount = Number(process.argv[4] ?? 40)

/** Skip pathological files (lockfiles, generated bundles) in fixture diffs. */
const MAX_DIFF_LINES_PER_FILE = 2000

const git = (...args) =>
  execFileSync('git', ['-C', repoPath, ...args], { maxBuffer: 1 << 30, encoding: 'utf8' })

const SEP = '\x1f'

function readCommits() {
  const raw = git('log', '--all', '--topo-order', `--format=%H${SEP}%P${SEP}%an${SEP}%ae${SEP}%at${SEP}%s`)
  return raw.split('\n').filter(Boolean).map(line => {
    const [sha, parents, authorName, authorEmail, timestamp, ...rest] = line.split(SEP)
    return {
      sha,
      parents: parents ? parents.split(' ') : [],
      authorName,
      authorEmail,
      timestamp: Number(timestamp),
      message: rest.join(SEP),
    }
  })
}

function readRefs() {
  const head = git('rev-parse', '--abbrev-ref', 'HEAD').trim()
  const raw = git('for-each-ref', '--format=%(refname)\x1f%(objectname)\x1f%(*objectname)')
  const byOid = new Map()
  const add = (oid, ref) => {
    if (!byOid.has(oid)) byOid.set(oid, [])
    byOid.get(oid).push(ref)
  }
  for (const line of raw.split('\n').filter(Boolean)) {
    const [name, oid, peeled] = line.split('\x1f')
    const target = peeled || oid
    if (name.startsWith('refs/heads/')) {
      const branch = name.slice('refs/heads/'.length)
      add(target, { kind: 'LocalBranch', name: branch, is_current: branch === head })
    } else if (name.startsWith('refs/remotes/')) {
      // origin/HEAD only points at another branch; the backend skips it too.
      if (name.endsWith('/HEAD')) continue
      add(target, { kind: 'RemoteBranch', name: name.slice('refs/remotes/'.length) })
    } else if (name.startsWith('refs/tags/')) {
      add(target, { kind: 'Tag', name: name.slice('refs/tags/'.length) })
    }
  }
  return { head, byOid }
}

/**
 * Mirrors the Rust lane engine (src-tauri/src/graph/lanes.rs): lanes are freed
 * when a chain ends and reused, so width tracks *concurrent* branches.
 *
 * Each row carries the segments occupying the band between its own centre and
 * the next row's centre. That makes every row self-describing: a renderer can
 * draw any window without a repo-global parent index.
 */
const PALETTE_SIZE = 8

function assignLanes(commits) {
  const lanes = []        // (sha | null)[] — the commit each lane is waiting for
  const colors = []       // color index per lane
  const rows = []
  let nextColor = 0
  let maxConcurrent = 0

  const freeSlot = () => {
    const i = lanes.indexOf(null)
    if (i !== -1) return i
    lanes.push(null)
    colors.push(0)
    return lanes.length - 1
  }

  for (const commit of commits) {
    let lane = lanes.indexOf(commit.sha)
    if (lane === -1) {
      lane = freeSlot()
      colors[lane] = nextColor++ % PALETTE_SIZE
    }
    const color = colors[lane]
    const segments = []

    lanes[lane] = null
    // Lanes already running beside this row, captured before its parents are
    // scheduled: a lane this commit opens is not one of them.
    const passing = lanes.map(slot => slot !== null)
    const [first, ...rest] = commit.parents
    if (first !== undefined) {
      const existing = lanes.indexOf(first)
      if (existing !== -1) {
        segments.push({ from: lane, to: existing, color })
      } else {
        lanes[lane] = first
        colors[lane] = color
        segments.push({ from: lane, to: lane, color })
      }
    }
    for (const parent of rest) {
      const existing = lanes.indexOf(parent)
      if (existing !== -1) {
        segments.push({ from: lane, to: existing, color: colors[existing] })
        continue
      }
      const slot = freeSlot()
      lanes[slot] = parent
      colors[slot] = nextColor++ % PALETTE_SIZE
      segments.push({ from: lane, to: slot, color: colors[slot] })
    }

    for (let i = 0; i < lanes.length; i++) {
      if (i !== lane && passing[i] && lanes[i] !== null) {
        segments.push({ from: i, to: i, color: colors[i] })
      }
    }

    while (lanes.length && lanes[lanes.length - 1] === null) {
      lanes.pop()
      colors.pop()
    }
    maxConcurrent = Math.max(maxConcurrent, lanes.length, lane + 1)

    rows.push({ commit, lane, color, segments })
  }
  return { rows, laneCount: Math.max(1, maxConcurrent) }
}

function parsePatch(patch) {
  const files = []
  let file = null
  let hunk = null
  for (const line of patch.split('\n')) {
    if (line.startsWith('diff --git ')) {
      const m = line.match(/^diff --git a\/(.*) b\/(.*)$/)
      file = {
        old_path: m ? m[1] : '',
        new_path: m ? m[2] : '',
        change_type: 'Modified',
        binary: false,
        truncated: false,
        hunks: [],
      }
      files.push(file)
      hunk = null
    } else if (!file) {
      continue
    } else if (line.startsWith('new file')) {
      file.change_type = 'Added'
    } else if (line.startsWith('deleted file')) {
      file.change_type = 'Deleted'
    } else if (line.startsWith('rename ')) {
      file.change_type = 'Renamed'
    } else if (line.startsWith('Binary files')) {
      file.binary = true
    } else if (line.startsWith('@@')) {
      const m = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/)
      hunk = {
        header: line.trim(),
        old_start: m ? Number(m[1]) : 0,
        new_start: m ? Number(m[3]) : 0,
        lines: [],
      }
      file.hunks.push(hunk)
    } else if (hunk) {
      const kind = line[0]
      if (kind !== '+' && kind !== '-' && kind !== ' ') continue
      const type = kind === '+' ? 'Added' : kind === '-' ? 'Removed' : 'Context'
      hunk.lines.push({ content: line.slice(1), line_type: type })
    }
  }
  // Line numbers, computed the same way the Rust side reports them.
  for (const f of files) {
    let budget = MAX_DIFF_LINES_PER_FILE
    for (const h of f.hunks) {
      if (budget <= 0) {
        h.lines = []
        f.truncated = true
        continue
      }
      if (h.lines.length > budget) {
        h.lines = h.lines.slice(0, budget)
        f.truncated = true
      }
      budget -= h.lines.length
    }
    for (const h of f.hunks) {
      let oldNo = h.old_start
      let newNo = h.new_start
      for (const l of h.lines) {
        l.old_lineno = l.line_type === 'Added' ? null : oldNo++
        l.new_lineno = l.line_type === 'Removed' ? null : newNo++
      }
    }
  }
  return files
}

const commits = readCommits()
const { head, byOid } = readRefs()
const { rows, laneCount } = assignLanes(commits)

const graphRows = rows.map(({ commit, lane, color, segments }) => ({
  sha: commit.sha,
  short_sha: commit.sha.slice(0, 7),
  message: commit.message,
  author_name: commit.authorName,
  author_email: commit.authorEmail,
  author_timestamp: commit.timestamp,
  refs: byOid.get(commit.sha) ?? [],
  lane,
  color,
  segments,
  parent_shas: commit.parents,
}))

const diffs = {}
const filesChanged = {}
for (const commit of commits.slice(0, diffCount)) {
  let patch = ''
  try {
    patch = git('show', '--format=', '--no-color', '-M', commit.sha)
  } catch {
    patch = ''
  }
  const parsed = parsePatch(patch)
  diffs[commit.sha] = parsed
  filesChanged[commit.sha] = parsed.map(f => ({
    path: f.new_path || f.old_path,
    change_type: f.change_type,
    staged: false,
    insertions: f.hunks.reduce((n, h) => n + h.lines.filter(l => l.line_type === 'Added').length, 0),
    deletions: f.hunks.reduce((n, h) => n + h.lines.filter(l => l.line_type === 'Removed').length, 0),
  }))
}

let stagedFiles = []
let unstagedFiles = []
let stagedDiff = []
let unstagedDiff = []
try {
  for (const line of git('status', '--porcelain=v1', '-uall').split('\n').filter(Boolean)) {
    const index = line[0]
    const worktree = line[1]
    const path = line.slice(3)
    const typeOf = (c) => (c === 'A' || c === '?' ? 'Added' : c === 'D' ? 'Deleted' : c === 'R' ? 'Renamed' : 'Modified')
    const counts = { insertions: 0, deletions: 0 }
    if (index !== ' ' && index !== '?') {
      stagedFiles.push({ path, change_type: typeOf(index), staged: true, ...counts })
    }
    if (worktree !== ' ') {
      unstagedFiles.push({ path, change_type: typeOf(worktree), staged: false, ...counts })
    }
  }
  stagedDiff = parsePatch(git('diff', '--cached', '--no-color'))
  unstagedDiff = parsePatch(git('diff', '--no-color'))
} catch {
  /* worktree may be unreadable; fixtures stay empty */
}

mkdirSync(dirname(outFile), { recursive: true })
writeFileSync(outFile, JSON.stringify({
  repoPath: resolve(repoPath),
  repoName: resolve(repoPath).split('/').pop(),
  head,
  laneCount,
  rows: graphRows,
  diffs,
  filesChanged,
  stagedFiles,
  unstagedFiles,
  stagedDiff,
  unstagedDiff,
}))

console.log(
  `${outFile}: ${graphRows.length} rows, ${laneCount} concurrent lanes, ` +
  `${Object.keys(diffs).length} diffs, ${stagedFiles.length + unstagedFiles.length} working-tree files`
)
