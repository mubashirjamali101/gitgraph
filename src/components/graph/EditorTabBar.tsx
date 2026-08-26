import { useState } from 'react'
import { actions } from '../../actions'
import { fileTabLabel } from '../../graph/fileTabs'
import { useStore, type Tab } from '../../store'
import ContextMenu, { type MenuItem } from '../ContextMenu'
import './EditorTabBar.css'

export default function EditorTabBar({ tab }: { tab: Tab }) {
  const setActiveEditor = useStore(state => state.setActiveEditor)
  const closeFileTab = useStore(state => state.closeFileTab)
  const closeOtherFileTabs = useStore(state => state.closeOtherFileTabs)
  const closeFileTabsToRight = useStore(state => state.closeFileTabsToRight)
  const closeFileTabsToLeft = useStore(state => state.closeFileTabsToLeft)
  const closeAllFileTabs = useStore(state => state.closeAllFileTabs)

  const [menuState, setMenuState] = useState<{
    x: number
    y: number
    targetId: string
  } | null>(null)

  const graphActive = tab.activeEditor === null

  const getMenuItems = (): MenuItem[] => {
    if (!menuState) return []
    const { targetId } = menuState

    if (targetId === 'graph') {
      return [
        {
          id: 'close-all',
          label: 'Close All Tabs',
          disabled: tab.editorTabs.length === 0,
          onClick: () => closeAllFileTabs(tab.id),
        },
        {
          id: 'close-right',
          label: 'Close Tabs to the Right',
          disabled: tab.editorTabs.length === 0,
          onClick: () => closeAllFileTabs(tab.id),
        },
      ]
    }

    const idx = tab.editorTabs.findIndex(e => e.id === targetId)
    if (idx === -1) return []
    const targetEditor = tab.editorTabs[idx]

    return [
      {
        id: 'close',
        label: 'Close',
        onClick: () => closeFileTab(tab.id, targetEditor.id),
      },
      {
        id: 'close-others',
        label: 'Close Others',
        disabled: tab.editorTabs.length <= 1,
        onClick: () => closeOtherFileTabs(tab.id, targetEditor.id),
      },
      {
        id: 'close-to-right',
        label: 'Close Tabs to the Right',
        disabled: idx >= tab.editorTabs.length - 1,
        onClick: () => closeFileTabsToRight(tab.id, targetEditor.id),
      },
      {
        id: 'close-to-left',
        label: 'Close Tabs to the Left',
        disabled: idx <= 0,
        onClick: () => closeFileTabsToLeft(tab.id, targetEditor.id),
      },
      {
        id: 'close-all',
        label: 'Close All Tabs',
        onClick: () => closeAllFileTabs(tab.id),
      },
      {
        id: 'copy-path',
        label: 'Copy Path',
        onClick: () => void actions.copy(targetEditor.path, 'file path'),
      },
    ]
  }

  return (
    <div className="editor-tabs" role="tablist" aria-label="Open files">
      <button
        type="button"
        role="tab"
        aria-selected={graphActive}
        className={`editor-tab${graphActive ? ' is-active' : ''}`}
        onClick={() => setActiveEditor(tab.id, null)}
        onContextMenu={event => {
          if (tab.editorTabs.length === 0) return
          event.preventDefault()
          setMenuState({ x: event.clientX, y: event.clientY, targetId: 'graph' })
        }}
      >
        Graph
      </button>
      {tab.editorTabs.map(editor => {
        const active = tab.activeEditor === editor.id
        return (
          <div
            key={editor.id}
            className={`editor-tab-wrap${active ? ' is-active' : ''}`}
            onContextMenu={event => {
              event.preventDefault()
              setMenuState({ x: event.clientX, y: event.clientY, targetId: editor.id })
            }}
          >
            <button
              type="button"
              role="tab"
              aria-selected={active}
              className="editor-tab"
              title={editor.path}
              onClick={() => setActiveEditor(tab.id, editor.id)}
            >
              {fileTabLabel(editor)}
              {editor.kind === 'worktree' && !editor.staged && (
                <span className="editor-tab-mark" title="Unstaged">
                  •
                </span>
              )}
            </button>
            <button
              type="button"
              className="editor-tab-close"
              aria-label={`Close ${fileTabLabel(editor)}`}
              onClick={event => {
                event.stopPropagation()
                closeFileTab(tab.id, editor.id)
              }}
            >
              ×
            </button>
          </div>
        )
      })}
      {menuState && (
        <ContextMenu
          x={menuState.x}
          y={menuState.y}
          items={getMenuItems()}
          onClose={() => setMenuState(null)}
        />
      )}
    </div>
  )
}
