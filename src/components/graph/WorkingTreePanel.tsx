/**
 * What the expanded "uncommitted changes" row shows: the two file lists, and
 * the diff of whichever file is open.
 *
 * Composing the commit happens in the sidebar. This panel is the reading
 * surface for the same state — one draft, one place to type it.
 */
import { useRepoAction } from '../../hooks/useRepoAction'
import { ipc } from '../../ipc'
import { useStore, type Tab } from '../../store'
import type { FileChanged } from '../../types'
import DiffView from './DiffView'
import FileTree from './FileTree'

interface WorkingTreePanelProps {
  tab: Tab
}

export default function WorkingTreePanel({ tab }: WorkingTreePanelProps) {
  const diffMode = useStore(state => state.settings.diffMode)
  const { busy, run } = useRepoAction(tab.id)

  const { file, fileStaged } = tab.draft

  const openFile = useStore(state => state.openWorktreeFile)
  const selected: { path: string; staged: boolean } | null =
    file === null ? null : { path: file, staged: fileStaged }
  const setSelected = (next: { path: string; staged: boolean } | null) =>
    openFile(tab.id, next?.path ?? null, next?.staged ?? false)

  const tree = tab.workingTree
  const staged = tree?.staged ?? []
  const unstaged = tree?.unstaged ?? []

  const pending = selected ? tab.file?.key === `worktree:${selected.staged}:${selected.path}` : false
  const openDiff = pending ? tab.file : null

  const fileActions = (file: FileChanged, isStaged: boolean) => (
    <button
      type="button"
      className="file-action"
      disabled={busy}
      title={isStaged ? 'Unstage this file' : 'Stage this file'}
      onClick={event => {
        event.stopPropagation()
        void run(
          () => (isStaged ? ipc.unstageFile(tab.id, file.path) : ipc.stageFile(tab.id, file.path)),
          { failure: isStaged ? 'Unstage failed' : 'Stage failed' },
        )
      }}
    >
      {isStaged ? '−' : '+'}
    </button>
  )

  return (
    <div className="detail-panel working-tree-panel">
      <div className="detail-side">
        <div className="detail-meta">
          <div className="detail-title">Uncommitted changes</div>
          <div className="detail-chips">
            <code className="chip">{tab.status?.branch ?? '…'}</code>
            <code className="chip">{staged.length} staged</code>
            <code className="chip">{unstaged.length} changed</code>
          </div>
        </div>

        <p className="detail-hint">
          Pick a file to see its diff. The commit message lives in the sidebar.
        </p>

        <div className="detail-actions">
          <button
            type="button"
            disabled={busy || unstaged.length === 0}
            onClick={() => void run(() => ipc.stageAll(tab.id), { failure: 'Stage failed' })}
          >
            Stage all
          </button>
          <button
            type="button"
            disabled={busy || staged.length === 0}
            onClick={() => void run(() => ipc.unstageAll(tab.id), { failure: 'Unstage failed' })}
          >
            Unstage all
          </button>
        </div>
      </div>

      <div className="detail-main">
        {selected ? (
          <>
            <div className="detail-main-header">
              <button type="button" className="back" onClick={() => setSelected(null)}>
                ←
              </button>
              <span className="detail-path">{selected.path}</span>
            </div>
            <div className="detail-scroll">
              {!openDiff || openDiff.loading ? (
                <div className="diff-empty">Loading diff…</div>
              ) : openDiff.error ? (
                <div className="diff-empty">{openDiff.error}</div>
              ) : openDiff.diff ? (
                <DiffView diff={openDiff.diff} mode={diffMode} />
              ) : (
                <div className="diff-empty">No diff for this file</div>
              )}
            </div>
          </>
        ) : (
          <div className="detail-scroll">
            <div className="tree-group">
              <div className="tree-group-title">Staged ({staged.length})</div>
              <FileTree
                files={staged}
                selected={null}
                onSelect={path => setSelected({ path, staged: true })}
                renderActions={file => fileActions(file, true)}
              />
            </div>
            <div className="tree-group">
              <div className="tree-group-title">Changes ({unstaged.length})</div>
              <FileTree
                files={unstaged}
                selected={null}
                onSelect={path => setSelected({ path, staged: false })}
                renderActions={file => fileActions(file, false)}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
