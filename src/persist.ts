/**
 * The only module that touches localStorage.
 *
 * One versioned document holds everything that should survive a restart: which
 * repositories were open, where each tab was scrolled, what was selected, and
 * the display settings. Reads are validated field by field — a corrupt or
 * hand-edited entry degrades to defaults instead of breaking startup.
 */

const KEY = 'gitgraph_v2'
const RECENT_LIMIT = 12
const MAX_TABS = 20

export type Theme = 'github-dark' | 'light' | 'dracula' | 'night-owl'
export const THEMES: { id: Theme; label: string }[] = [
  { id: 'github-dark', label: 'GitHub Dark' },
  { id: 'light', label: 'GitHub Light' },
  { id: 'dracula', label: 'Dracula' },
  { id: 'night-owl', label: 'Night Owl' },
]

export type Density = 'compact' | 'comfortable'
export type DiffMode = 'inline' | 'side-by-side'

export interface Settings {
  theme: Theme
  density: Density
  fontSize: number
  diffMode: DiffMode
}

/** Per-repository view state, restored on switch and on app start. */
export interface TabView {
  path: string
  scrollTop: number
  expandedSha: string | null
  selectedSha: string | null
  search: string
  /** An unsent commit message is work; it survives a restart. */
  draftMessage: string
  /** Branch filter; empty means every branch. */
  branches: string[]
  includeRemotes: boolean
}

export interface PersistedState {
  tabs: TabView[]
  activePath: string | null
  recent: string[]
  settings: Settings
  columns: Record<string, number>
  /** Width of the repository sidebar, in pixels. */
  sidebarWidth: number
}

export const SIDEBAR_WIDTH = { min: 180, max: 520, default: 260 } as const

/** Branch names are echoed straight back to git; keep the stored list sane. */
function readBranches(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter(
      (name): name is string =>
        typeof name === 'string' && name.length > 0 && name.length <= 255 && !/[\0\n\r]/.test(name),
    )
    .slice(0, 500)
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'github-dark',
  density: 'compact',
  fontSize: 12,
  diffMode: 'inline',
}

const EMPTY: PersistedState = {
  tabs: [],
  activePath: null,
  recent: [],
  settings: DEFAULT_SETTINGS,
  columns: {},
  sidebarWidth: SIDEBAR_WIDTH.default,
}

/** Absolute path, no control characters, plausible length. */
function isRepoPath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length < 4096 &&
    (value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value)) &&
    !value.includes('\0') &&
    !value.includes('\n')
  )
}

function readSettings(raw: unknown): Settings {
  const value = (raw ?? {}) as Partial<Settings>
  const themes = THEMES.map(t => t.id)
  return {
    theme: themes.includes(value.theme as Theme) ? (value.theme as Theme) : DEFAULT_SETTINGS.theme,
    density: value.density === 'comfortable' ? 'comfortable' : 'compact',
    fontSize:
      typeof value.fontSize === 'number' && value.fontSize >= 10 && value.fontSize <= 20
        ? Math.round(value.fontSize)
        : DEFAULT_SETTINGS.fontSize,
    diffMode: value.diffMode === 'side-by-side' ? 'side-by-side' : 'inline',
  }
}

function readTab(raw: unknown): TabView | null {
  const value = (raw ?? {}) as Partial<TabView>
  if (!isRepoPath(value.path)) return null
  return {
    path: value.path,
    scrollTop:
      typeof value.scrollTop === 'number' && Number.isFinite(value.scrollTop) && value.scrollTop >= 0
        ? value.scrollTop
        : 0,
    expandedSha: typeof value.expandedSha === 'string' ? value.expandedSha : null,
    selectedSha: typeof value.selectedSha === 'string' ? value.selectedSha : null,
    search: typeof value.search === 'string' ? value.search.slice(0, 200) : '',
    draftMessage:
      typeof value.draftMessage === 'string' ? value.draftMessage.slice(0, 8192) : '',
    branches: readBranches(value.branches),
    includeRemotes: value.includeRemotes !== false,
  }
}

export function load(): PersistedState {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return migrateLegacy()
    const parsed = JSON.parse(raw) as Partial<PersistedState>
    const tabs = Array.isArray(parsed.tabs)
      ? parsed.tabs.map(readTab).filter((tab): tab is TabView => tab !== null).slice(0, MAX_TABS)
      : []
    return {
      tabs,
      activePath: isRepoPath(parsed.activePath) ? parsed.activePath : tabs[0]?.path ?? null,
      recent: Array.isArray(parsed.recent)
        ? parsed.recent.filter(isRepoPath).slice(0, RECENT_LIMIT)
        : [],
      settings: readSettings(parsed.settings),
      sidebarWidth:
        typeof parsed.sidebarWidth === 'number' && Number.isFinite(parsed.sidebarWidth)
          ? Math.min(SIDEBAR_WIDTH.max, Math.max(SIDEBAR_WIDTH.min, Math.round(parsed.sidebarWidth)))
          : SIDEBAR_WIDTH.default,
      columns:
        parsed.columns && typeof parsed.columns === 'object'
          ? Object.fromEntries(
              Object.entries(parsed.columns).filter(
                ([, width]) => typeof width === 'number' && width > 0 && width < 4000,
              ),
            )
          : {},
    }
  } catch {
    return { ...EMPTY }
  }
}

let queued: PersistedState | null = null
let flushHandle: number | null = null

/** Coalesce writes: scrolling would otherwise serialize on every frame. */
export function save(state: PersistedState): void {
  queued = state
  if (flushHandle !== null) return
  flushHandle = window.setTimeout(() => {
    flushHandle = null
    const pending = queued
    queued = null
    if (!pending) return
    try {
      localStorage.setItem(KEY, JSON.stringify(pending))
    } catch {
      /* private mode or quota exceeded — losing view state is acceptable */
    }
  }, 400)
}

/** Write immediately; used when the window is going away. */
export function flush(state: PersistedState): void {
  if (flushHandle !== null) {
    window.clearTimeout(flushHandle)
    flushHandle = null
  }
  queued = null
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    /* ignore */
  }
}

export function pushRecent(recent: string[], path: string): string[] {
  if (!isRepoPath(path)) return recent
  return [path, ...recent.filter(entry => entry !== path)].slice(0, RECENT_LIMIT)
}

/**
 * Carry over state written by the previous release, so upgrading does not look
 * like a factory reset. Runs once; the v2 document takes over from then on.
 */
function migrateLegacy(): PersistedState {
  const state: PersistedState = { ...EMPTY }
  try {
    const open = JSON.parse(localStorage.getItem('gitgraph_openRepos') ?? '[]')
    if (Array.isArray(open)) {
      state.tabs = open.filter(isRepoPath).slice(0, MAX_TABS).map(path => ({
        path,
        scrollTop: 0,
        expandedSha: null,
        selectedSha: null,
        search: '',
        draftMessage: '',
        branches: [],
        includeRemotes: true,
      }))
      state.activePath = state.tabs[0]?.path ?? null
    }
    const recent = JSON.parse(localStorage.getItem('gitgraph_recentRepos') ?? '[]')
    if (Array.isArray(recent)) state.recent = recent.filter(isRepoPath).slice(0, RECENT_LIMIT)

    const settings = JSON.parse(localStorage.getItem('gitgraph_settings_v1') ?? 'null')
    if (settings) state.settings = readSettings(settings)
  } catch {
    /* nothing worth recovering */
  }
  return state
}
