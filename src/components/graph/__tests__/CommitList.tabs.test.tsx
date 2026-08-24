/**
 * Tab switching must not lose where you were.
 *
 * The list is mounted per active tab, so leaving a tab unmounts it and coming
 * back mounts it again. That round trip is what dropped the scroll position:
 * the "remember" effect ran on mount with the render-time value (still 0)
 * before any scroll event, overwriting the position the restore effect had just
 * applied.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { act } from 'react'

import { useStore, type Tab } from '../../../store'
import CommitList from '../CommitList'
import type { GraphRow } from '../../../types'

beforeAll(() => {
  // jsdom has neither of these, and the list observes its scroller.
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never
  HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as never
})

function rows(count: number): GraphRow[] {
  return Array.from({ length: count }, (_, index) => ({
    sha: `sha-${index}`,
    short_sha: `sha-${index}`.slice(0, 7),
    message: `commit ${index}`,
    author_name: 'Ada',
    author_email: 'ada@example.com',
    author_timestamp: 1_700_000_000,
    refs: [],
    lane: 0,
    color: 0,
    segments: index < count - 1 ? [{ from: 0, to: 0, color: 0 }] : [],
    parent_shas: [],
  }))
}

function tab(id: string, scrollTop: number): Tab {
  return {
    id,
    path: `/repos/${id}`,
    name: id,
    rows: rows(400),
    cursor: null,
    total: 400,
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
    filter: { branches: [], includeRemotes: true },
    revealSha: null,
    selectedSha: null,
    expandedSha: null,
    search: '',
    scrollTop,
    detailFile: null,
    draft: { message: '', amend: false, file: null, fileStaged: false },
    detail: null,
    file: null,
    files: {},
    editorTabs: [],
    activeEditor: null,
  }
}

const noop = () => {}

function show(id: string) {
  const current = useStore.getState().tabs.find(entry => entry.id === id)!
  return render(
    <CommitList tab={current} onRefMenu={noop} onRowMenu={noop} onCheckout={noop} />,
  )
}

/** jsdom reports zero-height elements; give the scroller a viewport. */
function giveViewport(container: HTMLElement) {
  const scroller = container.querySelector('.list-scroll') as HTMLElement
  Object.defineProperty(scroller, 'clientHeight', { value: 600, configurable: true })
  return scroller
}

describe('per-tab view state across switches', () => {
  beforeEach(() => {
    cleanup()
    useStore.setState({
      tabs: [tab('alpha', 4200), tab('beta', 0)],
      activeId: 'alpha',
    })
  })

  it('restores the scroll position and does not overwrite it on mount', () => {
    const { container, unmount } = show('alpha')
    const scroller = giveViewport(container)

    expect(scroller.scrollTop).toBe(4200)
    // The stored position must still be the restored one, not the 0 the
    // component started its first render with.
    expect(useStore.getState().tabs[0].scrollTop).toBe(4200)

    Object.defineProperty(scroller, 'scrollTop', { value: 0, configurable: true })
    unmount()
    expect(useStore.getState().tabs[0].scrollTop).toBe(4200)
  })

  it('keeps each tab at its own position when switching back and forth', () => {
    const first = show('alpha')
    giveViewport(first.container)
    first.unmount()

    useStore.setState({ activeId: 'beta' })
    const second = show('beta')
    const betaScroller = giveViewport(second.container)
    expect(betaScroller.scrollTop).toBe(0)

    // Scroll the second tab, then leave it the way a real switch does: the
    // element is detached before the cleanup runs.
    act(() => {
      betaScroller.scrollTop = 900
      betaScroller.dispatchEvent(new Event('scroll'))
    })
    Object.defineProperty(betaScroller, 'scrollTop', { value: 0, configurable: true })
    second.unmount()

    useStore.setState({ activeId: 'alpha' })
    const back = show('alpha')
    expect(giveViewport(back.container).scrollTop).toBe(4200)
    back.unmount()

    useStore.setState({ activeId: 'beta' })
    const backToBeta = show('beta')
    expect(giveViewport(backToBeta.container).scrollTop).toBe(900)
  })

  it('records the last scroll, and survives the scroller being detached', () => {
    const { container, unmount } = show('alpha')
    const scroller = giveViewport(container)

    act(() => {
      scroller.scrollTop = 1234
      scroller.dispatchEvent(new Event('scroll'))
    })
    expect(useStore.getState().tabs[0].scrollTop).toBe(1234)

    // In a browser the scroller is already detached when the unmount cleanup
    // runs, and a detached element reports 0. jsdom keeps the number, so model
    // the real behaviour explicitly — reading the DOM on the way out is what
    // zeroed the saved position.
    Object.defineProperty(scroller, 'scrollTop', { value: 0, configurable: true })
    unmount()

    expect(useStore.getState().tabs[0].scrollTop).toBe(1234)
  })

  it('keeps a half-written commit message and open file per tab', () => {
    const { setDraft, setDetailFile } = useStore.getState()

    act(() => {
      setDraft('alpha', { message: 'wip: still thinking' })
      setDetailFile('alpha', 'src/main.rs')
      setDraft('beta', { message: 'fix: other repo' })
    })

    const [alpha, beta] = useStore.getState().tabs
    expect(alpha.draft.message).toBe('wip: still thinking')
    expect(alpha.detailFile).toBe('src/main.rs')
    expect(beta.draft.message).toBe('fix: other repo')
    expect(beta.detailFile).toBeNull()
  })
})
