/**
 * The strip above the graph: which repository, which branches, and the
 * actions that operate on them.
 *
 * The branch picker collects its changes and applies them when it closes.
 * Applying per click would re-walk the repository on every checkbox, and
 * choosing four branches is one intent, not four.
 */
import { useEffect, useMemo, useState } from 'react'

import { actions } from '../../actions'
import { useStore, type Tab } from '../../store'
import Dropdown from '../Dropdown'
import './GraphToolbar.css'

interface GraphToolbarProps {
  tab: Tab
  /** Focused by ⌘F and `/`; owned by the list, which does the searching. */
  searchRef: React.RefObject<HTMLInputElement | null>
  matchCount: number
  onJump: (direction: 1 | -1) => void
}

function summarize(branches: string[]): string {
  if (branches.length === 0) return 'Show All'
  if (branches.length === 1) return branches[0]
  return `${branches.length} branches`
}

export default function GraphToolbar({
  tab,
  searchRef,
  matchCount,
  onJump,
}: GraphToolbarProps) {
  const tabs = useStore(state => state.tabs)
  const setActive = useStore(state => state.setActive)
  const setFilter = useStore(state => state.setFilter)
  const setSearch = useStore(state => state.setSearch)
  const reload = useStore(state => state.reload)

  // The picker's working copy. Seeded from the tab each time it opens, so a
  // filter changed elsewhere (or a reset) is picked up rather than shadowed.
  const [draft, setDraft] = useState<string[]>(tab.filter.branches)
  const [query, setQuery] = useState('')

  useEffect(() => {
    setDraft(tab.filter.branches)
  }, [tab.filter.branches])

  const branches = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const wanted = tab.refs.filter(
      ref =>
        ref.kind !== 'tag' &&
        (ref.kind === 'local' || tab.filter.includeRemotes) &&
        (needle === '' || ref.name.toLowerCase().includes(needle)),
    )
    return {
      local: wanted.filter(ref => ref.kind === 'local'),
      remote: wanted.filter(ref => ref.kind === 'remote'),
    }
  }, [tab.refs, tab.filter.includeRemotes, query])

  const toggle = (name: string) =>
    setDraft(current =>
      current.includes(name) ? current.filter(entry => entry !== name) : [...current, name],
    )

  /** Escape means "never mind"; any other dismissal commits the selection. */
  const apply = (cancelled: boolean) => {
    setQuery('')
    if (cancelled) {
      setDraft(tab.filter.branches)
      return
    }
    void setFilter(tab.id, { branches: draft })
  }

  const branchItem = (name: string, isCurrent: boolean) => (
    <button
      key={name}
      type="button"
      className={`dropdown-item${draft.includes(name) ? ' is-selected' : ''}`}
      role="menuitemcheckbox"
      aria-checked={draft.includes(name)}
      onClick={() => toggle(name)}
    >
      <span className="check" aria-hidden="true">
        {draft.includes(name) ? '✓' : ''}
      </span>
      <span className="item-name">{name}</span>
      {isCurrent && <span className="item-note">current</span>}
    </button>
  )

  return (
    <div className="graph-toolbar">
      <div className="toolbar-field">
        <span className="toolbar-caption">Repo:</span>
        <Dropdown label={tab.name} title={tab.path} className="repo-picker">
          {close =>
            tabs.map(entry => (
              <button
                key={entry.id}
                type="button"
                className={`dropdown-item${entry.id === tab.id ? ' is-selected' : ''}`}
                role="menuitemradio"
                aria-checked={entry.id === tab.id}
                title={entry.path}
                onClick={() => {
                  setActive(entry.id)
                  close()
                }}
              >
                <span className="check" aria-hidden="true">
                  {entry.id === tab.id ? '✓' : ''}
                </span>
                <span className="item-name">{entry.name}</span>
              </button>
            ))
          }
        </Dropdown>
      </div>

      <div className="toolbar-field">
        <span className="toolbar-caption">Branches:</span>
        <Dropdown
          label={summarize(tab.filter.branches)}
          title="Show only selected branches"
          className="branch-picker"
          onClose={apply}
        >
          {close => (
            <>
              <input
                className="dropdown-search"
                type="search"
                placeholder="Filter branches…"
                value={query}
                autoFocus
                onChange={event => setQuery(event.target.value)}
              />

              <button
                type="button"
                className={`dropdown-item${draft.length === 0 ? ' is-selected' : ''}`}
                role="menuitemradio"
                aria-checked={draft.length === 0}
                onClick={() => setDraft([])}
              >
                <span className="check" aria-hidden="true">
                  {draft.length === 0 ? '✓' : ''}
                </span>
                <span className="item-name">Show All</span>
              </button>

              <div className="dropdown-separator" />

              <div className="dropdown-scroll">
                {branches.local.length === 0 && branches.remote.length === 0 && (
                  <div className="dropdown-heading">No branch matches</div>
                )}
                {branches.local.length > 0 && <div className="dropdown-heading">Local</div>}
                {branches.local.map(ref => branchItem(ref.name, ref.is_current))}
                {branches.remote.length > 0 && <div className="dropdown-heading">Remote</div>}
                {branches.remote.map(ref => branchItem(ref.name, false))}
              </div>

              <div className="dropdown-separator" />
              <div className="dropdown-footer">
                <button type="button" onClick={() => setDraft([])}>
                  Clear
                </button>
                <button type="button" className="primary" onClick={close}>
                  Apply
                </button>
              </div>
            </>
          )}
        </Dropdown>
      </div>

      {/* Titled, because the label is dropped on a narrow pane. */}
      <label className="toolbar-check" title="Show Remote Branches">
        <input
          type="checkbox"
          checked={tab.filter.includeRemotes}
          onChange={event => void setFilter(tab.id, { includeRemotes: event.target.checked })}
        />
        <span className="check-text">Show Remote Branches</span>
      </label>

      <div className="toolbar-spacer" />

      <div className="toolbar-search">
        <input
          ref={searchRef}
          className="search-input"
          type="search"
          placeholder="Search commits  (⌘F)"
          value={tab.search}
          onChange={event => setSearch(tab.id, event.target.value)}
        />
        {tab.search.trim() !== '' && (
          <div className="search-status">
            <span>{matchCount === 0 ? 'No matches' : `${matchCount} matches`}</span>
            <button type="button" onClick={() => onJump(-1)} title="Previous match (Shift+N)">
              ↑
            </button>
            <button type="button" onClick={() => onJump(1)} title="Next match (N)">
              ↓
            </button>
          </div>
        )}
      </div>

      <div className="toolbar-actions">
        <button type="button" title="Fetch from origin" onClick={() => void actions.fetchAll(tab.id)}>
          Fetch
        </button>
        <button
          type="button"
          title={`Pull into ${tab.status?.branch ?? 'current branch'}`}
          onClick={() => void actions.pull(tab.id)}
        >
          Pull
        </button>
        <button
          type="button"
          title="Reload history (⌘R)"
          aria-label="Reload"
          onClick={() => void reload(tab.id)}
        >
          ↻
        </button>
      </div>
    </div>
  )
}
