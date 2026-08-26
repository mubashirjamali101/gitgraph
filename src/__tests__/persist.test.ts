import { beforeEach, describe, expect, it } from 'vitest'

import {
  DEFAULT_SETTINGS,
  SIDEBAR_WIDTH,
  load,
  flush,
  pushRecent,
  type PersistedState,
} from '../persist'

const state = (overrides: Partial<PersistedState> = {}): PersistedState => ({
  tabs: [],
  activePath: null,
  recent: [],
  settings: DEFAULT_SETTINGS,
  columns: {},
  sidebarWidth: SIDEBAR_WIDTH.default,
  ...overrides,
})

describe('persisted session', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('round-trips tab view state so a restart resumes where you were', () => {
    flush(
      state({
        tabs: [
          {
            path: '/repos/app',
            scrollTop: 4200,
            expandedSha: 'abc123',
            selectedSha: 'abc123',
            search: 'fix',
            draftMessage: 'wip: half a thought',
            branches: ['main', 'release/2.0'],
            includeRemotes: false,
          },
        ],
        activePath: '/repos/app',
        settings: { ...DEFAULT_SETTINGS, theme: 'dracula', density: 'comfortable' },
      }),
    )

    const restored = load()
    expect(restored.tabs).toHaveLength(1)
    expect(restored.tabs[0]).toEqual({
      path: '/repos/app',
      scrollTop: 4200,
      expandedSha: 'abc123',
      selectedSha: 'abc123',
      search: 'fix',
      draftMessage: 'wip: half a thought',
      branches: ['main', 'release/2.0'],
      includeRemotes: false,
    })
    expect(restored.activePath).toBe('/repos/app')
    expect(restored.settings.theme).toBe('dracula')
    expect(restored.settings.density).toBe('comfortable')
  })

  it('drops entries that are not usable paths', () => {
    localStorage.setItem(
      'gitgraph_v2',
      JSON.stringify({
        tabs: [
          { path: 'relative/path' },
          { path: '/good/repo', scrollTop: -5 },
          { path: '/bad/repo\n' },
          { nothing: true },
        ],
      }),
    )

    const restored = load()
    expect(restored.tabs.map(tab => tab.path)).toEqual(['/good/repo'])
    // A nonsense scroll offset becomes a sane one rather than breaking layout.
    expect(restored.tabs[0].scrollTop).toBe(0)
  })

  it('falls back to defaults on corrupt storage', () => {
    localStorage.setItem('gitgraph_v2', 'not json at all')
    const restored = load()
    expect(restored.tabs).toEqual([])
    expect(restored.settings).toEqual(DEFAULT_SETTINGS)
  })

  it('supports system theme persistence', () => {
    flush(
      state({
        settings: { ...DEFAULT_SETTINGS, theme: 'system' },
      }),
    )

    const restored = load()
    expect(restored.settings.theme).toBe('system')
  })

  it('clamps settings to supported values', () => {
    flush(
      state({
        settings: {
          theme: 'not-a-theme' as never,
          density: 'huge' as never,
          fontSize: 400,
          diffMode: 'nonsense' as never,
        },
      }),
    )

    const restored = load()
    expect(restored.settings).toEqual(DEFAULT_SETTINGS)
  })

  it('adopts state written by the previous version', () => {
    // Upgrading should not look like a factory reset.
    localStorage.setItem('gitgraph_openRepos', JSON.stringify(['/repos/one', '/repos/two']))
    localStorage.setItem('gitgraph_recentRepos', JSON.stringify(['/repos/one']))
    localStorage.setItem(
      'gitgraph_settings_v1',
      JSON.stringify({ theme: 'night-owl', density: 'comfortable', fontSize: 14 }),
    )

    const restored = load()
    expect(restored.tabs.map(tab => tab.path)).toEqual(['/repos/one', '/repos/two'])
    expect(restored.recent).toEqual(['/repos/one'])
    expect(restored.settings.theme).toBe('night-owl')
    expect(restored.settings.fontSize).toBe(14)
  })

  it('keeps the recent list deduplicated, most recent first', () => {
    let recent = pushRecent([], '/a')
    recent = pushRecent(recent, '/b')
    recent = pushRecent(recent, '/a')
    expect(recent).toEqual(['/a', '/b'])

    const many = Array.from({ length: 20 }, (_, i) => `/repo-${i}`).reduce(
      (list, path) => pushRecent(list, path),
      [] as string[],
    )
    expect(many).toHaveLength(12)
    expect(many[0]).toBe('/repo-19')
  })

  it('ignores paths that could not be repositories', () => {
    expect(pushRecent([], 'not-absolute')).toEqual([])
  })
})
