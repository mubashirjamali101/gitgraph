/**
 * Typed wrapper over the Tauri command surface. Every backend call in the app
 * goes through here — components never call `invoke` directly, so the contract
 * lives in exactly one place (and the mock harness only has to stand in for
 * `invoke` itself).
 */
import { invoke } from '@tauri-apps/api/core'
import type {
  CommitDetail,
  ConflictState,
  DiscoveredRepo,
  FileChanged,
  FileDiff,
  GraphFilter,
  GraphPage,
  PushImpact,
  RefEntry,
  RepoStatus,
  StashEntry,
  WorkingTree,
} from './types'

export interface OpenedRepo {
  repo_id: string
  path: string
  name: string
}

export type ResetMode = 'soft' | 'mixed' | 'hard'

export const ipc = {
  // -------------------------------------------------------------- repos
  pickDirectory: () => invoke<string | null>('pick_directory'),
  scanRepos: (path: string) => invoke<DiscoveredRepo[]>('scan_repos', { path }),
  openRepo: (path: string) => invoke<OpenedRepo>('open_repo', { path }),
  closeRepo: (repoId: string) => invoke<void>('close_repo', { repoId }),
  repoStatus: (repoId: string) => invoke<RepoStatus>('repo_status', { repoId }),

  // -------------------------------------------------------------- graph
  graphPage: (repoId: string, cursor: string | null, limit: number, filter: GraphFilter) =>
    invoke<GraphPage>('graph_page', { repoId, cursor, limit, filter }),

  // -------------------------------------------------------------- commits
  commitFiles: (repoId: string, sha: string) =>
    invoke<FileChanged[]>('commit_files', { repoId, sha }),
  commitFileDiff: (repoId: string, sha: string, path: string) =>
    invoke<FileDiff | null>('commit_file_diff', { repoId, sha, path }),
  commitDetail: (repoId: string, sha: string) =>
    invoke<CommitDetail>('commit_detail', { repoId, sha }),
  listRefs: (repoId: string) => invoke<RefEntry[]>('list_refs', { repoId }),

  // -------------------------------------------------------------- working tree
  workingTree: (repoId: string) => invoke<WorkingTree>('working_tree', { repoId }),
  worktreeFileDiff: (repoId: string, path: string, staged: boolean) =>
    invoke<FileDiff | null>('worktree_file_diff', { repoId, path, staged }),
  stageFile: (repoId: string, path: string) => invoke<void>('stage_file', { repoId, path }),
  unstageFile: (repoId: string, path: string) => invoke<void>('unstage_file', { repoId, path }),
  stageAll: (repoId: string) => invoke<void>('stage_all', { repoId }),
  unstageAll: (repoId: string) => invoke<void>('unstage_all', { repoId }),
  discardFile: (repoId: string, path: string) => invoke<void>('discard_file', { repoId, path }),
  commitStaged: (repoId: string, message: string) =>
    invoke<void>('commit_staged', { repoId, message }),
  amendCommit: (repoId: string, message: string | null) =>
    invoke<void>('amend_commit', { repoId, message }),
  userEmail: (repoId: string) => invoke<string>('user_email', { repoId }),

  // -------------------------------------------------------------- branches & refs
  checkout: (repoId: string, refName: string) => invoke<void>('checkout', { repoId, refName }),
  createBranch: (repoId: string, name: string, fromSha: string, checkout: boolean) =>
    invoke<void>('create_branch', { repoId, name, fromSha, checkout }),
  renameBranch: (repoId: string, oldName: string, newName: string) =>
    invoke<void>('rename_branch', { repoId, oldName, newName }),
  deleteBranch: (repoId: string, name: string, force: boolean) =>
    invoke<void>('delete_branch', { repoId, name, force }),
  deleteRemoteBranch: (repoId: string, branchName: string) =>
    invoke<void>('delete_remote_branch', { repoId, branchName }),
  createTag: (repoId: string, name: string, sha: string, message: string | null) =>
    invoke<void>('create_tag', { repoId, name, sha, message }),
  deleteTag: (repoId: string, name: string) => invoke<void>('delete_tag', { repoId, name }),
  merge: (repoId: string, refName: string) => invoke<void>('merge', { repoId, refName }),
  rebase: (repoId: string, onto: string) => invoke<void>('rebase', { repoId, onto }),
  cherryPick: (repoId: string, sha: string) => invoke<void>('cherry_pick', { repoId, sha }),
  reset: (repoId: string, sha: string, mode: ResetMode) =>
    invoke<void>('reset', { repoId, sha, mode }),
  revert: (repoId: string, sha: string) => invoke<void>('revert', { repoId, sha }),

  // -------------------------------------------------------------- remotes
  fetchAll: (repoId: string) => invoke<void>('fetch_all', { repoId }),
  fetchBranch: (repoId: string, branchName: string) =>
    invoke<void>('fetch_branch', { repoId, branchName }),
  pull: (repoId: string) => invoke<void>('pull', { repoId }),
  push: (repoId: string, branchName: string) => invoke<void>('push', { repoId, branchName }),
  forcePush: (repoId: string, branchName: string) =>
    invoke<void>('force_push', { repoId, branchName }),
  pushImpact: (repoId: string, branchName: string) =>
    invoke<PushImpact>('push_impact', { repoId, branchName }),
  remoteBranchExists: (repoId: string, branchName: string) =>
    invoke<boolean>('remote_branch_exists', { repoId, branchName }),

  // -------------------------------------------------------------- stash
  stashList: (repoId: string) => invoke<StashEntry[]>('stash_list', { repoId }),
  stashPush: (repoId: string, message: string | null, includeUntracked: boolean) =>
    invoke<void>('stash_push', { repoId, message, includeUntracked }),
  stashPop: (repoId: string, index: number) => invoke<void>('stash_pop', { repoId, index }),
  stashApply: (repoId: string, index: number) => invoke<void>('stash_apply', { repoId, index }),
  stashDrop: (repoId: string, index: number) => invoke<void>('stash_drop', { repoId, index }),

  // -------------------------------------------------------------- in-progress operations
  conflictState: (repoId: string) => invoke<ConflictState>('conflict_state', { repoId }),
  abortInProgress: (repoId: string) => invoke<void>('abort_in_progress', { repoId }),
  continueInProgress: (repoId: string) => invoke<void>('continue_in_progress', { repoId }),

  // -------------------------------------------------------------- diagnostics
  logLine: (level: 'error' | 'warn' | 'info' | 'debug', message: string) =>
    invoke<void>('log_line', { level, message }),
}

/** Message the backend pushes when a watched repository changes on disk. */
export interface RepoChangedEvent {
  repo_id: string
}
