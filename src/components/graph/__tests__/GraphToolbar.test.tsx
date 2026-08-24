/**
 * The branch picker gathers a selection and applies it once, when it closes.
 * Applying per checkbox would re-walk the repository between clicks.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'

import { useStore, type Tab } from '../../../store'
import GraphToolbar from '../GraphToolbar'
import type { RefEntry } from '../../../types'

const setFilter = vi.fn(() => Promise.resolve())

function refs(): RefEntry[] {
  return [
    { name: 'main', kind: 'local', sha: 'a'.repeat(40), is_current: true, timestamp: 1 },
    { name: 'feature', kind: 'local', sha: 'b'.repeat(40), is_current: false, timestamp: 2 },
    { name: 'origin/main', kind: 'remote', sha: 'a'.repeat(40), is_current: false, timestamp: 1 },
    { name: 'v1.0', kind: 'tag', sha: 'c'.repeat(40), is_current: false, timestamp: 3 },
  ]
}

function tab(overrides: Partial<Tab> = {}): Tab {
  return {
    id: 'repo',
    path: '/repos/app',
    name: 'app',
    rows: [],
    cursor: null,
    total: 0,
    laneCount: 1,
    truncated: false,
    loading: false,
    loadingMore: false,
    error: null,
    status: null,
    workingTree: null,
    stashes: [],
    conflict: null,
    refs: refs(),
    filter: { branches: [], includeRemotes: true },
    revealSha: null,
    selectedSha: null,
    expandedSha: null,
    search: '',
    scrollTop: 0,
    detailFile: null,
    draft: { message: '', amend: false, file: null, fileStaged: false },
    detail: null,
    file: null,
    files: {},
    editorTabs: [],
    activeEditor: null,
    ...overrides,
  }
}

function show(entry = tab()) {
  useStore.setState({ tabs: [entry], activeId: entry.id, setFilter } as never)
  return render(
    <GraphToolbar tab={entry} searchRef={createRef<HTMLInputElement>()} matchCount={0} onJump={vi.fn()} />,
  )
}

const openPicker = () => fireEvent.click(screen.getByTitle('Show only selected branches'))

describe('the branch picker', () => {
  beforeEach(() => {
    cleanup()
    setFilter.mockClear()
  })

  it('lists local and remote branches, but not tags', () => {
    show()
    openPicker()

    expect(screen.getByRole('menuitemcheckbox', { name: /^main/ })).toBeTruthy()
    expect(screen.getByRole('menuitemcheckbox', { name: /origin\/main/ })).toBeTruthy()
    expect(screen.queryByRole('menuitemcheckbox', { name: /v1\.0/ })).toBeNull()
  })

  it('hides remote branches when they are not being shown', () => {
    show(tab({ filter: { branches: [], includeRemotes: false } }))
    openPicker()
    expect(screen.queryByRole('menuitemcheckbox', { name: /origin\/main/ })).toBeNull()
  })

  it('applies the whole selection once, on close', () => {
    show()
    openPicker()

    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /^main/ }))
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /feature/ }))
    expect(setFilter).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('Apply'))
    expect(setFilter).toHaveBeenCalledTimes(1)
    expect(setFilter).toHaveBeenCalledWith('repo', { branches: ['main', 'feature'] })
  })

  it('treats "Show All" as an empty selection', () => {
    show(tab({ filter: { branches: ['main'], includeRemotes: true } }))
    openPicker()

    fireEvent.click(screen.getByRole('menuitemradio', { name: /Show All/ }))
    fireEvent.click(screen.getByText('Apply'))
    expect(setFilter).toHaveBeenCalledWith('repo', { branches: [] })
  })

  it('throws the selection away when the menu is dismissed with Escape', () => {
    show()
    openPicker()
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /feature/ }))
    fireEvent.keyDown(document, { key: 'Escape' })

    expect(setFilter).not.toHaveBeenCalled()
    // Re-opening shows the applied filter, not the abandoned selection.
    openPicker()
    expect(
      screen.getByRole('menuitemcheckbox', { name: /feature/ }).getAttribute('aria-checked'),
    ).toBe('false')
  })

  it('toggles remote branches straight away — one click, one intent', () => {
    show()
    fireEvent.click(screen.getByRole('checkbox'))
    expect(setFilter).toHaveBeenCalledWith('repo', { includeRemotes: false })
  })
})

/*
 * Note for the next person: none of the above would have caught the toolbar
 * clipping these menus to nothing (`overflow: hidden` on a 38px strip). jsdom
 * has no layout, so a panel with zero visible area still answers every query.
 * Changes to how the pickers are positioned need a real browser —
 * `pnpm dev:mock`, open the menu, look at it.
 */
