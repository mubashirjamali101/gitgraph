/**
 * The branch filter decides which history is walked, so it has to reach the
 * backend on every request and it has to invalidate what is already on screen.
 * Both were easy to get wrong: rows from a previous filter appended to a new
 * walk produce a graph of two histories spliced together.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { GraphFilter, GraphPage } from '../types'

const graphPage = vi.fn<
  [string, string | null, number, GraphFilter],
  Promise<GraphPage>
>()

vi.mock('../ipc', () => ({
  ipc: {
    graphPage: (...args: [string, string | null, number, GraphFilter]) => graphPage(...args),
    workingTree: () => Promise.resolve({ staged: [], unstaged: [] }),
    repoStatus: () => Promise.resolve(null),
    stashList: () => Promise.resolve([]),
    conflictState: () => Promise.resolve(null),
    listRefs: () => Promise.resolve([]),
    closeRepo: () => Promise.resolve(),
  },
}))

const { useStore } = await import('../store')

function page(shas: string[], cursor: string | null = null): GraphPage {
  return {
    rows: shas.map(sha => ({
      sha,
      short_sha: sha.slice(0, 7),
      message: sha,
      author_name: 'Ada',
      author_email: 'ada@example.com',
      author_timestamp: 1_700_000_000,
      refs: [],
      lane: 0,
      color: 0,
      segments: [],
      parent_shas: [],
    })),
    cursor,
    lane_count: 1,
    total: shas.length,
    truncated: false,
    complete: cursor === null,
  }
}

function seedTab(filter: GraphFilter) {
  useStore.setState({
    tabs: [
      {
        id: 'repo',
        path: '/repos/app',
        name: 'app',
        rows: page(['old-1', 'old-2']).rows,
        cursor: '2',
        total: 2,
        laneCount: 1,
        truncated: false,
        loading: false,
        loadingMore: false,
        error: null,
        status: null,
        workingTree: null,
        stashes: [],
        conflict: null,
        refs: [],
        filter,
        revealSha: null,
        selectedSha: null,
        expandedSha: null,
        search: '',
        scrollTop: 900,
        detailFile: null,
        draft: { message: '', amend: false, file: null, fileStaged: false },
        detail: null,
        file: null,
      },
    ],
    activeId: 'repo',
  })
}

const tab = () => useStore.getState().tabs[0]

describe('the branch filter', () => {
  beforeEach(() => {
    graphPage.mockReset()
    localStorage.clear()
    seedTab({ branches: [], includeRemotes: true })
  })

  it('sends the selected branches with every page request', async () => {
    graphPage.mockResolvedValue(page(['a'], '1'))
    await useStore.getState().setFilter('repo', { branches: ['main', 'release'] })

    expect(graphPage).toHaveBeenCalledWith('repo', null, expect.any(Number), {
      branches: ['main', 'release'],
      includeRemotes: true,
    })

    graphPage.mockResolvedValue(page(['b'], null))
    await useStore.getState().loadMore('repo')
    expect(graphPage).toHaveBeenLastCalledWith('repo', '1', expect.any(Number), {
      branches: ['main', 'release'],
      includeRemotes: true,
    })
  })

  it('drops the rows and the scroll position of the previous walk', async () => {
    let resolve: (value: GraphPage) => void = () => {}
    graphPage.mockReturnValue(new Promise<GraphPage>(done => (resolve = done)))

    const pending = useStore.getState().setFilter('repo', { branches: ['main'] })
    // Before the new page even arrives, nothing from the old walk is left.
    expect(tab().rows).toEqual([])
    expect(tab().scrollTop).toBe(0)
    expect(tab().cursor).toBeNull()

    resolve(page(['new-1']))
    await pending
    expect(tab().rows.map(row => row.sha)).toEqual(['new-1'])
  })

  it('does not re-walk when the filter is set to what it already is', async () => {
    graphPage.mockResolvedValue(page(['a']))
    await useStore.getState().setFilter('repo', { branches: [] })
    await useStore.getState().setFilter('repo', { includeRemotes: true })
    expect(graphPage).not.toHaveBeenCalled()
  })

  it('discards a page that arrives after the filter changed under it', async () => {
    // A slow "show all" page in flight while the user picks one branch. Its
    // rows belong to a walk that is no longer on screen.
    let resolveSlow: (value: GraphPage) => void = () => {}
    graphPage.mockReturnValueOnce(new Promise<GraphPage>(done => (resolveSlow = done)))
    const slow = useStore.getState().loadMore('repo')

    graphPage.mockResolvedValue(page(['fresh-1']))
    await useStore.getState().setFilter('repo', { branches: ['main'] })

    resolveSlow(page(['stale-1', 'stale-2'], '4'))
    await slow

    expect(tab().rows.map(row => row.sha)).toEqual(['fresh-1'])
    expect(tab().loadingMore).toBe(false)
  })

  it('keeps a filter per repository, and remembers it across a restart', async () => {
    graphPage.mockResolvedValue(page(['a']))
    await useStore.getState().setFilter('repo', {
      branches: ['release/2.0'],
      includeRemotes: false,
    })

    // Writes are coalesced on a timer, so wait for the flush rather than
    // reading localStorage the instant the action returns.
    const { load } = await import('../persist')
    await vi.waitFor(() => expect(load().tabs).toHaveLength(1), { timeout: 2000 })
    const saved = load().tabs.find(entry => entry.path === '/repos/app')
    expect(saved?.branches).toEqual(['release/2.0'])
    expect(saved?.includeRemotes).toBe(false)
  })
})
