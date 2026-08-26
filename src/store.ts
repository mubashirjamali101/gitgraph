/**
 * Application state.
 *
 * One store holds the tabs and the settings; components subscribe to the slice
 * they need. Nothing is threaded through props, and there is no event bus —
 * actions here are the only way state changes.
 *
 * Scroll position deliberately lives *outside* React state: it is read from the
 * DOM while rendering and written back here only when a tab is left, so
 * scrolling never triggers a store update.
 */
import { create } from 'zustand'

import { PAGE_SIZE } from './constants'
import { commitTabId, worktreeTabId, type FileTab } from './graph/fileTabs'
export type { FileTab }
import { ipc } from './ipc'
import * as persist from './persist'
import type {
  CommitDetail,
  ConflictState,
  FileChanged,
  FileDiff,
  GraphFilter,
  GraphRow,
  RefEntry,
  RepoStatus,
  StashEntry,
  WorkingTree,
} from './types'

/** Sha used by the synthetic row representing uncommitted changes. */
export const WORKING_TREE_SHA = '__working_tree__'

/** What the expanded panel knows about the commit it is showing. */
export interface OpenCommit {
  sha: string
  files: FileChanged[]
  /** Full message and authorship, fetched alongside the file list. */
  detail: CommitDetail | null
  loading: boolean
}

/**
 * A file's diff, fetched when the file is opened.
 *
 * Sending every file's hunks with the commit meant 10 MB of JSON for a
 * 956-file commit, to show one file.
 */
export interface OpenFile {
  key: string
  diff: FileDiff | null
  loading: boolean
  error: string | null
}

/** The working-tree panel's in-progress edit, kept per tab. */
export interface CommitDraft {
  message: string
  amend: boolean
  /** File whose diff is open, and which side of the index it came from. */
  file: string | null
  fileStaged: boolean
}

const EMPTY_DRAFT: CommitDraft = { message: '', amend: false, file: null, fileStaged: false }

export interface Tab {
  id: string
  path: string
  name: string

  rows: GraphRow[]
  cursor: string | null
  total: number
  /** Widest lane across everything loaded so far; sizes the graph column. */
  laneCount: number
  truncated: boolean
  loading: boolean
  loadingMore: boolean
  error: string | null

  status: RepoStatus | null
  workingTree: WorkingTree | null
  stashes: StashEntry[]
  conflict: ConflictState | null
  /** Every branch and tag, for the branch filter. Refreshed with the graph. */
  refs: RefEntry[]

  /**
   * Which branches the graph walks. Changing it re-walks the repository, so it
   * lives here beside the rows rather than in the toolbar component.
   */
  filter: GraphFilter

  /**
   * A commit the list should scroll to, set by anything outside the list (the
   * ref picker, the sidebar). The list clears it once it has acted.
   */
  revealSha: string | null

  // View state, kept per tab so switching tabs does not discard it.
  selectedSha: string | null
  expandedSha: string | null
  search: string
  scrollTop: number
  /** File whose diff is open in the expanded commit panel. */
  detailFile: string | null
  /** Commit message being typed, and the rest of the staging panel's state. */
  draft: CommitDraft

  detail: OpenCommit | null
  /** Diff for whichever file is open, in the commit panel or the worktree. */
  file: OpenFile | null
  /** Diffs keyed by editor-tab id so switching tabs does not refetch. */
  files: Record<string, OpenFile>
  /** Open file editors; `activeEditor` null means the graph is showing. */
  editorTabs: FileTab[]
  activeEditor: string | null
}

interface Store {
  tabs: Tab[]
  activeId: string | null
  recent: string[]
  settings: persist.Settings
  columns: Record<string, number>
  sidebarWidth: number
  restoring: boolean

  // lifecycle
  restoreSession: () => Promise<void>
  openPath: (path: string) => Promise<void>
  closeTab: (id: string) => void
  setActive: (id: string) => void

  // data
  reload: (id: string) => Promise<void>
  loadMore: (id: string) => Promise<void>
  refreshWorkingState: (id: string) => Promise<void>
  /** Change the branch filter, which re-walks the repository. */
  setFilter: (id: string, patch: Partial<GraphFilter>) => Promise<void>

  // view
  select: (id: string, sha: string | null) => void
  toggleExpanded: (id: string, sha: string) => void
  setSearch: (id: string, search: string) => void
  rememberScroll: (id: string, scrollTop: number) => void
  setDetailFile: (id: string, path: string | null) => void
  openWorktreeFile: (id: string, path: string | null, staged: boolean) => void
  openCommitFile: (id: string, sha: string, path: string) => void
  setActiveEditor: (id: string, tabId: string | null) => void
  closeFileTab: (id: string, tabId: string) => void
  closeOtherFileTabs: (id: string, tabId: string) => void
  closeFileTabsToRight: (id: string, tabId: string) => void
  closeFileTabsToLeft: (id: string, tabId: string) => void
  closeAllFileTabs: (id: string) => void
  /** Ask the list to scroll to a commit; `null` once it has. */
  reveal: (id: string, sha: string | null) => void
  setDraft: (id: string, patch: Partial<CommitDraft>) => void

  // settings
  setSettings: (patch: Partial<persist.Settings>) => void
  setColumnWidths: (widths: Record<string, number>) => void
  setSidebarWidth: (width: number) => void
}

const initial = persist.load()

/** Snapshot the parts of the store that outlive the process. */
function snapshot(state: Store): persist.PersistedState {
  return {
    tabs: state.tabs.map(tab => ({
      path: tab.path,
      scrollTop: tab.scrollTop,
      expandedSha: tab.expandedSha,
      selectedSha: tab.selectedSha,
      search: tab.search,
      draftMessage: tab.draft.message,
      branches: tab.filter.branches,
      includeRemotes: tab.filter.includeRemotes,
    })),
    activePath: state.tabs.find(tab => tab.id === state.activeId)?.path ?? null,
    recent: state.recent,
    settings: state.settings,
    columns: state.columns,
    sidebarWidth: state.sidebarWidth,
  }
}

function newTab(id: string, path: string, name: string, view?: persist.TabView): Tab {
  return {
    id,
    path,
    name,
    rows: [],
    cursor: null,
    total: 0,
    laneCount: 1,
    truncated: false,
    loading: true,
    loadingMore: false,
    error: null,
    status: null,
    workingTree: null,
    stashes: [],
    conflict: null,
    refs: [],
    revealSha: null,
    filter: {
      branches: view?.branches ?? [],
      includeRemotes: view?.includeRemotes ?? true,
    },
    selectedSha: view?.selectedSha ?? null,
    expandedSha: view?.expandedSha ?? null,
    search: view?.search ?? '',
    scrollTop: view?.scrollTop ?? 0,
    detailFile: null,
    draft: { ...EMPTY_DRAFT, message: view?.draftMessage ?? '' },
    detail: null,
    file: null,
    files: {},
    editorTabs: [],
    activeEditor: null,
  }
}

export const useStore = create<Store>((set, get) => {
  /** Apply a patch to one tab, leaving the others untouched. */
  const patch = (id: string, update: Partial<Tab> | ((tab: Tab) => Partial<Tab>)) => {
    set(state => ({
      tabs: state.tabs.map(tab =>
        tab.id === id ? { ...tab, ...(typeof update === 'function' ? update(tab) : update) } : tab,
      ),
    }))
  }

  const persistNow = () => persist.save(snapshot(get()))

  /** True when this tab is still showing what the request was made for. */
  const stillWanted = (id: string, sha: string) =>
    get().tabs.find(tab => tab.id === id)?.expandedSha === sha

  /** Load the file list and message for whatever is expanded in a tab. */
  const loadDetail = async (id: string, sha: string) => {
    if (sha === WORKING_TREE_SHA) {
      await get().refreshWorkingState(id)
      return
    }
    patch(id, { detail: { sha, files: [], detail: null, loading: true } })
    try {
      const [files, detail] = await Promise.all([
        ipc.commitFiles(id, sha),
        ipc.commitDetail(id, sha).catch(() => null),
      ])
      // Clicking through commits leaves earlier requests in flight; their
      // results are for a commit that is no longer open.
      if (!stillWanted(id, sha)) return
      patch(id, { detail: { sha, files, detail, loading: false } })
    } catch (error) {
      if (!stillWanted(id, sha)) return
      patch(id, {
        detail: { sha, files: [], detail: null, loading: false },
        error: String(error),
      })
    }
  }

  /**
   * Fetch one file's diff. `key` identifies the request so a slower earlier
   * one cannot overwrite the file you are looking at now.
   */
  const loadFile = async (
    id: string,
    key: string,
    fetch: () => Promise<FileDiff | null>,
    force = false,
  ) => {
    const current = get().tabs.find(tab => tab.id === id)
    const existing = current?.files[key]
    if (!force && existing?.diff && !existing.error) {
      patch(id, { file: existing })
      return
    }
    // Keep the last good diff on screen while a refresh is in flight so an
    // editor (or a watcher tick) cannot unmount the pane mid-keystroke.
    if (!existing?.diff) {
      const pending: OpenFile = { key, diff: null, loading: true, error: null }
      patch(id, tab => ({
        file: pending,
        files: { ...tab.files, [key]: pending },
      }))
    }
    try {
      const diff = await fetch()
      if (!get().tabs.find(tab => tab.id === id)?.files[key]) return
      const ready: OpenFile = { key, diff, loading: false, error: null }
      patch(id, tab => ({
        file: tab.file?.key === key ? ready : tab.file,
        files: { ...tab.files, [key]: ready },
      }))
    } catch (error) {
      if (!get().tabs.find(tab => tab.id === id)?.files[key]) return
      const failed: OpenFile = { key, diff: null, loading: false, error: String(error) }
      patch(id, tab => ({
        file: tab.file?.key === key ? failed : tab.file,
        files: { ...tab.files, [key]: failed },
      }))
    }
  }

  return {
    tabs: [],
    activeId: null,
    recent: initial.recent,
    settings: initial.settings,
    columns: initial.columns,
    sidebarWidth: initial.sidebarWidth,
    restoring: initial.tabs.length > 0,

    async restoreSession() {
      const saved = initial.tabs
      if (saved.length === 0) {
        set({ restoring: false })
        return
      }

      const opened = await Promise.all(
        saved.map(async view => {
          try {
            const repo = await ipc.openRepo(view.path)
            return newTab(repo.repo_id, repo.path, repo.name, view)
          } catch {
            // A repo that moved or was deleted should not block startup.
            return null
          }
        }),
      )

      const tabs = opened.filter((tab): tab is Tab => tab !== null)
      const active =
        tabs.find(tab => tab.path === initial.activePath)?.id ?? tabs[0]?.id ?? null
      set({ tabs, activeId: active, restoring: false })
      await Promise.all(tabs.map(tab => get().reload(tab.id)))
    },

    async openPath(path) {
      const existing = get().tabs.find(tab => tab.path === path)
      if (existing) {
        set({ activeId: existing.id })
        persistNow()
        return
      }
      try {
        const repo = await ipc.openRepo(path)
        const already = get().tabs.find(tab => tab.id === repo.repo_id)
        if (already) {
          set({ activeId: already.id })
          persistNow()
          return
        }
        set(state => ({
          tabs: [...state.tabs, newTab(repo.repo_id, repo.path, repo.name)],
          activeId: repo.repo_id,
          recent: persist.pushRecent(state.recent, repo.path),
        }))
        persistNow()
        await get().reload(repo.repo_id)
      } catch (error) {
        // Surfaced by the caller; opening is user-initiated so it needs a voice.
        throw new Error(String(error))
      }
    },

    closeTab(id) {
      const remaining = get().tabs.filter(tab => tab.id !== id)
      set(state => ({
        tabs: remaining,
        activeId: state.activeId === id ? remaining[remaining.length - 1]?.id ?? null : state.activeId,
      }))
      void ipc.closeRepo(id).catch(() => {})
      persistNow()
    },

    setActive(id) {
      set({ activeId: id })
      persistNow()
    },

    async reload(id) {
      const filter = get().tabs.find(tab => tab.id === id)?.filter
      if (!filter) return
      patch(id, { loading: true, error: null })
      try {
        const page = await ipc.graphPage(id, null, PAGE_SIZE, filter)
        patch(id, {
          rows: page.rows,
          cursor: page.cursor,
          total: page.total,
          truncated: page.truncated,
          laneCount: Math.max(1, page.lane_count),
          loading: false,
        })
        await get().refreshWorkingState(id)

        // The branch filter's menu is only as good as this list, and branches
        // come and go with the history that was just reloaded.
        void ipc
          .listRefs(id)
          .then(refs => {
            if (get().tabs.some(tab => tab.id === id)) patch(id, { refs })
          })
          .catch(() => {})

        // Re-fetch the open commit's details: its diff may have changed.
        const expanded = get().tabs.find(tab => tab.id === id)?.expandedSha
        if (expanded && expanded !== WORKING_TREE_SHA) void loadDetail(id, expanded)
      } catch (error) {
        patch(id, { loading: false, error: String(error) })
      }
    },

    async loadMore(id) {
      const tab = get().tabs.find(entry => entry.id === id)
      if (!tab || tab.loadingMore || tab.cursor === null) return
      patch(id, { loadingMore: true })
      try {
        const page = await ipc.graphPage(id, tab.cursor, PAGE_SIZE, tab.filter)
        // The filter can change while a page is in flight. Appending then
        // would splice rows from two different walks into one list.
        if (get().tabs.find(entry => entry.id === id)?.filter !== tab.filter) {
          patch(id, { loadingMore: false })
          return
        }
        patch(id, current => ({
          rows: [...current.rows, ...page.rows],
          cursor: page.cursor,
          total: page.total,
          // Widen if this page needs more lanes; never narrow, or the graph
          // would shift sideways as pages arrive.
          laneCount: Math.max(current.laneCount, page.lane_count),
          loadingMore: false,
        }))
      } catch {
        patch(id, { loadingMore: false })
      }
    },

    async setFilter(id, update) {
      const tab = get().tabs.find(entry => entry.id === id)
      if (!tab) return
      const filter = { ...tab.filter, ...update }
      if (
        filter.includeRemotes === tab.filter.includeRemotes &&
        filter.branches.length === tab.filter.branches.length &&
        filter.branches.every((name, index) => name === tab.filter.branches[index])
      ) {
        return
      }
      // A different walk is a different history: the rows on screen, the page
      // cursor and the position within them all belong to the old one.
      patch(id, { filter, rows: [], cursor: null, scrollTop: 0, loadingMore: false })
      persistNow()
      await get().reload(id)
    },

    async refreshWorkingState(id) {
      const [tree, status, stashes, conflict] = await Promise.all([
        ipc.workingTree(id).catch(() => null),
        ipc.repoStatus(id).catch(() => null),
        ipc.stashList(id).catch(() => [] as StashEntry[]),
        ipc.conflictState(id).catch(() => null),
      ])
      if (!get().tabs.some(tab => tab.id === id)) return
      patch(id, { workingTree: tree, status, stashes, conflict })
    },

    select(id, sha) {
      patch(id, { selectedSha: sha })
      persistNow()
    },

    toggleExpanded(id, sha) {
      const tab = get().tabs.find(entry => entry.id === id)
      if (!tab) return
      const next = tab.expandedSha === sha ? null : sha
      patch(id, {
        expandedSha: next,
        selectedSha: sha,
        detail: next ? tab.detail : null,
        // A file path from the previously expanded commit means nothing here.
        detailFile: next === tab.expandedSha ? tab.detailFile : null,
      })
      persistNow()
      if (next) void loadDetail(id, next)
    },

    setSearch(id, search) {
      patch(id, { search })
      persistNow()
    },

    rememberScroll(id, scrollTop) {
      // Not routed through `set`: scrolling must not re-render subscribers.
      const tab = get().tabs.find(entry => entry.id === id)
      if (!tab || tab.scrollTop === scrollTop) return
      tab.scrollTop = scrollTop
      persistNow()
    },

    setDetailFile(id, path) {
      patch(id, { detailFile: path, file: null })
      const tab = get().tabs.find(entry => entry.id === id)
      if (!path || !tab?.expandedSha || tab.expandedSha === WORKING_TREE_SHA) return
      const sha = tab.expandedSha
      void loadFile(id, `${sha}:${path}`, () => ipc.commitFileDiff(id, sha, path))
    },

    reveal(id, sha) {
      patch(id, { revealSha: sha })
    },

    openWorktreeFile(id, path, staged) {
      if (!path) {
        patch(id, current => ({
          draft: { ...current.draft, file: null, fileStaged: false },
        }))
        return
      }
      const tabId = worktreeTabId(path)
      patch(id, current => {
        const next: FileTab = {
          id: tabId,
          path,
          kind: 'worktree',
          sha: null,
          staged,
        }
        const editorTabs = current.editorTabs.some(tab => tab.id === tabId)
          ? current.editorTabs.map(tab => (tab.id === tabId ? next : tab))
          : [...current.editorTabs, next]
        return {
          editorTabs,
          activeEditor: tabId,
          draft: { ...current.draft, file: path, fileStaged: staged },
        }
      })
      void loadFile(id, tabId, () => ipc.worktreeFileDiff(id, path, staged))
    },

    openCommitFile(id, sha, path) {
      const tabId = commitTabId(sha, path)
      patch(id, current => {
        const next: FileTab = {
          id: tabId,
          path,
          kind: 'commit',
          sha,
          staged: false,
        }
        const editorTabs = current.editorTabs.some(tab => tab.id === tabId)
          ? current.editorTabs
          : [...current.editorTabs, next]
        return { editorTabs, activeEditor: tabId, detailFile: path }
      })
      void loadFile(id, tabId, () => ipc.commitFileDiff(id, sha, path))
    },

    setActiveEditor(id, tabId) {
      patch(id, { activeEditor: tabId })
      if (!tabId) return
      const tab = get().tabs.find(entry => entry.id === id)
      const editor = tab?.editorTabs.find(entry => entry.id === tabId)
      const cached = tab?.files[tabId]
      if (cached) patch(id, { file: cached })
      else if (editor?.kind === 'worktree') {
        void loadFile(id, tabId, () => ipc.worktreeFileDiff(id, editor.path, editor.staged))
      } else if (editor?.kind === 'commit' && editor.sha) {
        const sha = editor.sha
        void loadFile(id, tabId, () => ipc.commitFileDiff(id, sha, editor.path))
      }
    },

    closeFileTab(id, tabId) {
      patch(id, current => {
        const editorTabs = current.editorTabs.filter(tab => tab.id !== tabId)
        const { [tabId]: _removed, ...files } = current.files
        const activeEditor =
          current.activeEditor === tabId
            ? editorTabs[editorTabs.length - 1]?.id ?? null
            : current.activeEditor
        return { editorTabs, files, activeEditor }
      })
    },

    closeOtherFileTabs(id, tabId) {
      patch(id, current => {
        const editorTabs = current.editorTabs.filter(tab => tab.id === tabId)
        const files: Record<string, OpenFile> = {}
        if (current.files[tabId]) files[tabId] = current.files[tabId]
        return { editorTabs, files, activeEditor: tabId }
      })
    },

    closeFileTabsToRight(id, tabId) {
      patch(id, current => {
        const index = current.editorTabs.findIndex(tab => tab.id === tabId)
        if (index === -1) return {}
        const editorTabs = current.editorTabs.slice(0, index + 1)
        const keptIds = new Set(editorTabs.map(tab => tab.id))
        const files: Record<string, OpenFile> = {}
        for (const [key, val] of Object.entries(current.files)) {
          if (keptIds.has(key)) files[key] = val
        }
        const activeEditor =
          current.activeEditor && keptIds.has(current.activeEditor)
            ? current.activeEditor
            : tabId
        return { editorTabs, files, activeEditor }
      })
    },

    closeFileTabsToLeft(id, tabId) {
      patch(id, current => {
        const index = current.editorTabs.findIndex(tab => tab.id === tabId)
        if (index === -1) return {}
        const editorTabs = current.editorTabs.slice(index)
        const keptIds = new Set(editorTabs.map(tab => tab.id))
        const files: Record<string, OpenFile> = {}
        for (const [key, val] of Object.entries(current.files)) {
          if (keptIds.has(key)) files[key] = val
        }
        const activeEditor =
          current.activeEditor && keptIds.has(current.activeEditor)
            ? current.activeEditor
            : tabId
        return { editorTabs, files, activeEditor }
      })
    },

    closeAllFileTabs(id) {
      patch(id, { editorTabs: [], files: {}, activeEditor: null })
    },

    setDraft(id, update) {
      patch(id, tab => ({ draft: { ...tab.draft, ...update } }))
      persistNow()
    },

    setSettings(update) {
      set(state => ({ settings: { ...state.settings, ...update } }))
      persistNow()
    },

    setColumnWidths(widths) {
      set({ columns: widths })
      persistNow()
    },

    setSidebarWidth(width) {
      const { min, max } = persist.SIDEBAR_WIDTH
      set({ sidebarWidth: Math.round(Math.min(max, Math.max(min, width))) })
      persistNow()
    },
  }
})

/** Flush view state when the window goes away mid-scroll. */
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => persist.flush(snapshot(useStore.getState())))
}

export const activeTab = (state: Store): Tab | undefined =>
  state.tabs.find(tab => tab.id === state.activeId)
