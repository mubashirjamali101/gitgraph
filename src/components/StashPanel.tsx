/**
 * Stash drawer: create, apply, pop and drop stashes.
 *
 * Collapsed by default and labelled with the count, so it costs one line of
 * vertical space when there is nothing stashed.
 */
import { useState } from 'react'

import { summarizeWorkingTree } from '../graph/rows'
import { useRepoAction } from '../hooks/useRepoAction'
import { ipc } from '../ipc'
import type { Tab } from '../store'
import ConfirmDialog from './ConfirmDialog'
import type { StashEntry } from '../types'
import './StashPanel.css'

export default function StashPanel({ tab }: { tab: Tab }) {
  const { busy, run } = useRepoAction(tab.id)
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [message, setMessage] = useState('')
  const [includeUntracked, setIncludeUntracked] = useState(false)
  const [dropTarget, setDropTarget] = useState<StashEntry | null>(null)

  const stashes = tab.stashes
  const hasChanges = summarizeWorkingTree(tab.workingTree).total > 0

  /** Every stash action moves commits around, so the graph is re-walked. */
  const runStash = (label: string, work: () => Promise<unknown>) =>
    run(work, { failure: 'Stash failed', success: label, reloadHistory: true })

  return (
    <div className="stash-panel">
      <button
        type="button"
        className="stash-toggle"
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
      >
        {open ? '▾' : '▸'} Stashes ({stashes.length})
      </button>

      {open && (
        <div className="stash-body">
          {creating ? (
            <div className="stash-create">
              <input
                autoFocus
                placeholder="Optional message"
                maxLength={256}
                value={message}
                onChange={event => setMessage(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Escape') setCreating(false)
                }}
              />
              <label>
                <input
                  type="checkbox"
                  checked={includeUntracked}
                  onChange={event => setIncludeUntracked(event.target.checked)}
                />
                Include untracked
              </label>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void runStash('Changes stashed', async () => {
                    await ipc.stashPush(tab.id, message.trim() || null, includeUntracked)
                    setMessage('')
                    setCreating(false)
                  })
                }
              >
                Stash
              </button>
              <button type="button" onClick={() => setCreating(false)}>
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="stash-new"
              disabled={!hasChanges}
              title={hasChanges ? 'Stash current changes' : 'Nothing to stash'}
              onClick={() => setCreating(true)}
            >
              + Stash changes
            </button>
          )}

          {stashes.length === 0 ? (
            <p className="stash-empty">No stashes.</p>
          ) : (
            <ul className="stash-list">
              {stashes.map(entry => (
                <li key={entry.index}>
                  <span className="stash-index">stash@{`{${entry.index}}`}</span>
                  {entry.branch && <span className="stash-branch">{entry.branch}</span>}
                  <span className="stash-message">{entry.message}</span>
                  <span className="stash-actions">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void runStash('Stash applied', () => ipc.stashApply(tab.id, entry.index))
                      }
                    >
                      Apply
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void runStash('Stash popped', () => ipc.stashPop(tab.id, entry.index))}
                    >
                      Pop
                    </button>
                    <button
                      type="button"
                      className="danger"
                      disabled={busy}
                      onClick={() => setDropTarget(entry)}
                    >
                      Drop
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <ConfirmDialog
        isOpen={dropTarget !== null}
        title="Drop stash?"
        message={`stash@{${dropTarget?.index ?? 0}} will be deleted. This cannot be undone.`}
        confirmLabel="Drop"
        destructive
        onCancel={() => setDropTarget(null)}
        onConfirm={() => {
          const index = dropTarget?.index
          setDropTarget(null)
          if (index !== undefined) {
            void runStash('Stash dropped', () => ipc.stashDrop(tab.id, index))
          }
        }}
      />
    </div>
  )
}
