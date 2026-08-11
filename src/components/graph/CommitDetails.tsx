/**
 * The panel shown under an expanded row: commit metadata on the left, files and
 * their diff on the right — or the staging form when the expanded row is the
 * working tree.
 */
import { memo } from 'react'

import { isWorkingTreeRow } from '../../graph/rows'
import { useStore, type Tab } from '../../store'
import type { GraphRow } from '../../types'
import DiffView from './DiffView'
import FileTree from './FileTree'
import { refLabel } from './RefBadges'
import WorkingTreePanel from './WorkingTreePanel'
import './CommitDetails.css'

interface CommitDetailsProps {
  tab: Tab
  row: GraphRow
}

function CommitDetails({ tab, row }: CommitDetailsProps) {
  const diffMode = useStore(state => state.settings.diffMode)
  const setSettings = useStore(state => state.setSettings)
  const toggleExpanded = useStore(state => state.toggleExpanded)
  // Which file is open lives with the tab, so switching tabs keeps it.
  const setSelectedPath = useStore(state => state.setDetailFile)
  const selectedPath = tab.detailFile

  if (isWorkingTreeRow(row)) {
    return (
      <div className="detail-frame">
        <WorkingTreePanel tab={tab} />
        <button
          type="button"
          className="detail-close"
          onClick={() => toggleExpanded(tab.id, row.sha)}
          aria-label="Close"
        >
          ✕
        </button>
      </div>
    )
  }

  const open = tab.detail?.sha === row.sha ? tab.detail : null
  const files = open?.files ?? []
  const message = open?.detail
  const file = tab.file?.key === `${row.sha}:${selectedPath}` ? tab.file : null

  return (
    <div className="detail-frame">
      <div className="detail-panel">
        <div className="detail-side">
          <code className="detail-sha">{row.sha}</code>
          <div className="detail-message">{message?.summary ?? row.message}</div>
          {message?.body && <pre className="detail-body">{message.body}</pre>}
          <div className="detail-author">
            {row.author_name}
            {row.author_email && ` <${row.author_email}>`}
          </div>
          <div className="detail-date">
            {new Date(row.author_timestamp * 1000).toLocaleString()}
          </div>
          {message?.committed_by_other && (
            <div className="detail-author">
              committed by {message.committer_name} &lt;{message.committer_email}&gt;
            </div>
          )}

          {row.refs.length > 0 && (
            <div className="detail-block">
              <div className="detail-label">Refs</div>
              {row.refs.map(ref => (
                <code key={`${ref.kind}-${refLabel(ref)}`} className={`chip ref-${ref.kind.toLowerCase()}`}>
                  {refLabel(ref)}
                </code>
              ))}
            </div>
          )}

          {row.parent_shas.length > 0 && (
            <div className="detail-block">
              <div className="detail-label">
                {row.parent_shas.length > 1 ? 'Parents' : 'Parent'}
              </div>
              {row.parent_shas.map(sha => (
                <code key={sha} className="chip mono">
                  {sha.slice(0, 12)}
                </code>
              ))}
            </div>
          )}
        </div>

        <div className="detail-main">
          <div className="detail-main-header">
            {selectedPath ? (
              <>
                <button type="button" className="back" onClick={() => setSelectedPath(tab.id, null)}>
                  ←
                </button>
                <span className="detail-path">{selectedPath}</span>
              </>
            ) : (
              <span className="detail-path">
                {open?.loading
                  ? 'Loading changes…'
                  : `${files.length} file${files.length === 1 ? '' : 's'} changed`}
              </span>
            )}
            {selectedPath && (
              <div className="diff-mode">
                <button
                  type="button"
                  className={diffMode === 'inline' ? 'active' : ''}
                  onClick={() => setSettings({ diffMode: 'inline' })}
                >
                  Inline
                </button>
                <button
                  type="button"
                  className={diffMode === 'side-by-side' ? 'active' : ''}
                  onClick={() => setSettings({ diffMode: 'side-by-side' })}
                >
                  Split
                </button>
              </div>
            )}
          </div>

          <div className="detail-scroll">
            {selectedPath ? (
              file?.loading || !file ? (
                <div className="diff-empty">Loading diff…</div>
              ) : file.error ? (
                <div className="diff-empty">{file.error}</div>
              ) : file.diff ? (
                <DiffView diff={file.diff} mode={diffMode} />
              ) : (
                <div className="diff-empty">No diff for this file</div>
              )
            ) : (
              <FileTree
                files={files}
                selected={selectedPath}
                onSelect={path => setSelectedPath(tab.id, path)}
              />
            )}
          </div>
        </div>
      </div>

      <button
        type="button"
        className="detail-close"
        onClick={() => toggleExpanded(tab.id, row.sha)}
        aria-label="Close"
      >
        ✕
      </button>
    </div>
  )
}

export default memo(CommitDetails)
