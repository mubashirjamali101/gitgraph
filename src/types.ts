/**
 * The IPC contract between the Rust backend and the React frontend.
 * Every type here mirrors a `serde`-serialized struct in `src-tauri/src`.
 */

// ---------------------------------------------------------------- graph

/**
 * A line occupying the band between one row's centre and the next row's centre.
 * `from`/`to` are lane indices; a straight run has `from === to`.
 *
 * Rows are self-describing on purpose: any window of rows can be drawn without
 * a repo-global parent lookup, which is what keeps rendering correct under
 * virtualization.
 */
export interface GraphSegment {
  from: number
  to: number
  color: number
}

export interface GraphRow {
  sha: string
  short_sha: string
  message: string
  author_name: string
  author_email: string
  author_timestamp: number // unix seconds
  refs: GitRef[]
  /** Lane the commit dot sits in. */
  lane: number
  /** Palette index for the dot. */
  color: number
  /** Lines drawn below this row, down to the next row. */
  segments: GraphSegment[]
  parent_shas: string[]
}

export type GitRef =
  | { kind: 'LocalBranch'; name: string; is_current: boolean }
  | { kind: 'RemoteBranch'; name: string }
  | { kind: 'Tag'; name: string }
  | { kind: 'Head'; detached: boolean }

/**
 * Which refs the graph walks.
 *
 * An empty `branches` means every ref, which is what the "Show All" entry in
 * the branch picker selects. The filter is applied by the walk itself, not to
 * the rows afterwards — see `graph/snapshot.rs`.
 */
export interface GraphFilter {
  branches: string[]
  includeRemotes: boolean
}

/** One page of history, plus the cursor needed to resume the walk. */
export interface GraphPage {
  rows: GraphRow[]
  /** Opaque cursor for the next page; `null` when history is exhausted. */
  cursor: string | null
  /** Widest lane index in use across this page, 1-based. */
  lane_count: number
  /** Commits in the whole snapshot, for end-of-history reporting. */
  total: number
  /** The walk hit its safety ceiling and older history was dropped. */
  truncated: boolean
  /** False while more history is still to be walked. */
  complete: boolean
}

// ---------------------------------------------------------------- diffs

export type ChangeType = 'Added' | 'Modified' | 'Deleted' | 'Renamed' | 'Copied' | 'Typechange'

export type DiffLineType = 'Context' | 'Added' | 'Removed'

export interface DiffLine {
  content: string
  line_type: DiffLineType
  old_lineno: number | null
  new_lineno: number | null
}

export interface DiffHunk {
  header: string
  old_start: number
  new_start: number
  lines: DiffLine[]
}

export interface FileDiff {
  old_path: string
  new_path: string
  change_type: ChangeType
  /** Binary files carry no hunks. */
  binary: boolean
  /** Set when the file exceeded the per-file line cap. */
  truncated: boolean
  hunks: DiffHunk[]
}

/** Both sides of a working-tree file as text, for the editor. */
export interface FileText {
  original: string
  current: string
  binary: boolean
}

export interface FileChanged {
  path: string
  change_type: ChangeType
  /** Present in the index (i.e. would be part of a commit). */
  staged: boolean
  insertions: number
  deletions: number
  binary: boolean
}

/**
 * Working-tree state, split the way git actually models it. Only the file
 * lists: a file's diff is fetched when it is opened.
 */
export interface WorkingTree {
  staged: FileChanged[]
  unstaged: FileChanged[]
}

/** Everything about a commit that the graph row does not carry. */
export interface CommitDetail {
  sha: string
  summary: string
  /** Message beyond the summary line; empty for a one-line message. */
  body: string
  author_name: string
  author_email: string
  author_timestamp: number
  committer_name: string
  committer_email: string
  committer_timestamp: number
  committed_by_other: boolean
  parent_shas: string[]
}

export interface RefEntry {
  name: string
  kind: 'local' | 'remote' | 'tag'
  sha: string
  is_current: boolean
  timestamp: number
}

// ---------------------------------------------------------------- repo

export interface DiscoveredRepo {
  path: string
  name: string
}

export interface BranchTracking {
  ahead: number
  behind: number
}

export interface PushImpact {
  ahead: number
  behind: number
  rewrites: boolean
}

export interface StashEntry {
  index: number
  message: string
  branch: string
}

export interface ConflictState {
  in_merge: boolean
  in_rebase: boolean
  in_cherry_pick: boolean
  in_revert: boolean
  conflicted_paths: string[]
}

export interface RepoStatus {
  branch: string
  detached: boolean
  tracking: BranchTracking | null
}
