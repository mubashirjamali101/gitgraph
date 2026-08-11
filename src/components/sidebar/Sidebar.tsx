/**
 * The repository list down the left-hand side.
 *
 * Selecting a repository here is the same action as picking one from the
 * toolbar's Repo menu — both call `setActive`, and the graph follows. The
 * active repository expands to show its uncommitted changes, so the sidebar
 * answers "what is going on in this repo" without leaving the graph.
 */
import { useEffect, useRef, useState } from 'react'

import { summarizeWorkingTree } from '../../graph/rows'
import { SIDEBAR_WIDTH } from '../../persist'
import { useStore } from '../../store'
import StashPanel from '../StashPanel'
import RepoChanges from './RepoChanges'
import './Sidebar.css'

export default function Sidebar({ onOpen }: { onOpen: () => void }) {
  const tabs = useStore(state => state.tabs)
  const activeId = useStore(state => state.activeId)
  const setActive = useStore(state => state.setActive)
  const closeTab = useStore(state => state.closeTab)
  const width = useStore(state => state.sidebarWidth)
  const setWidth = useStore(state => state.setSidebarWidth)

  const [resizing, setResizing] = useState(false)
  const aside = useRef<HTMLElement>(null)

  // Drag-to-resize is tracked on the window, so the pointer may leave the
  // handle (and the sidebar) without the drag stopping.
  useEffect(() => {
    if (!resizing) return
    const onMove = (event: MouseEvent) => {
      const left = aside.current?.getBoundingClientRect().left ?? 0
      setWidth(event.clientX - left)
    }
    const onUp = () => setResizing(false)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    document.body.style.cursor = 'col-resize'
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
    }
  }, [resizing, setWidth])

  return (
    <aside className="sidebar" style={{ width: `${width}px` }} ref={aside}>
      <header className="sidebar-header">
        <span className="sidebar-title">Repositories</span>
        <button
          type="button"
          className="sidebar-add"
          title="Open a repository (⌘O)"
          aria-label="Open a repository"
          onClick={onOpen}
        >
          +
        </button>
      </header>

      <div className="sidebar-list">
        {tabs.length === 0 && (
          <p className="sidebar-empty">No repositories open.</p>
        )}

        {tabs.map(tab => {
          const active = tab.id === activeId
          // Counted here rather than added up by hand: a file changed both in
          // the index and the worktree is one changed file to the reader.
          const changes = summarizeWorkingTree(tab.workingTree).total
          return (
            <section key={tab.id} className={`repo-entry${active ? ' is-active' : ''}`}>
              <div
                className="repo-row"
                role="button"
                tabIndex={0}
                aria-current={active}
                title={tab.path}
                onClick={() => setActive(tab.id)}
                onKeyDown={event => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    setActive(tab.id)
                  }
                }}
              >
                <span className="repo-name">{tab.name}</span>
                {tab.status && (
                  <span className="repo-branch" title={`On ${tab.status.branch}`}>
                    {tab.status.branch}
                  </span>
                )}
                {changes > 0 && (
                  <span className="repo-count" title={`${changes} changed files`}>
                    {changes}
                  </span>
                )}
                <button
                  type="button"
                  className="repo-close"
                  aria-label={`Close ${tab.name}`}
                  title="Close repository (⌘W)"
                  onClick={event => {
                    event.stopPropagation()
                    closeTab(tab.id)
                  }}
                >
                  ×
                </button>
              </div>

              {active && (
                <>
                  <RepoChanges tab={tab} />
                  <StashPanel tab={tab} />
                </>
              )}
            </section>
          )
        })}
      </div>

      <div
        className={`sidebar-resizer${resizing ? ' is-resizing' : ''}`}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        onMouseDown={event => {
          event.preventDefault()
          setResizing(true)
        }}
        onDoubleClick={() => setWidth(SIDEBAR_WIDTH.default)}
      />
    </aside>
  )
}
