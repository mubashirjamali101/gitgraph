import { useStore, type Tab } from '../../store'
import { fileTabLabel } from '../../graph/fileTabs'
import './EditorTabBar.css'

export default function EditorTabBar({ tab }: { tab: Tab }) {
  const setActiveEditor = useStore(state => state.setActiveEditor)
  const closeFileTab = useStore(state => state.closeFileTab)
  const graphActive = tab.activeEditor === null

  return (
    <div className="editor-tabs" role="tablist" aria-label="Open files">
      <button
        type="button"
        role="tab"
        aria-selected={graphActive}
        className={`editor-tab${graphActive ? ' is-active' : ''}`}
        onClick={() => setActiveEditor(tab.id, null)}
      >
        Graph
      </button>
      {tab.editorTabs.map(editor => {
        const active = tab.activeEditor === editor.id
        return (
          <div
            key={editor.id}
            className={`editor-tab-wrap${active ? ' is-active' : ''}`}
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
    </div>
  )
}
