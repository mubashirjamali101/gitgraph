/**
 * Staging and committing for the active repository, in the sidebar.
 *
 * This is the only place a commit is composed. The expanded working-tree row
 * in the graph shows the diffs; putting a second message box there would give
 * the same draft two homes and invite them to disagree.
 */
import { useEffect, useState } from 'react'

import { useRepoAction } from '../../hooks/useRepoAction'
import { ipc } from '../../ipc'
import { CHANGE_LETTER, changeClass } from '../../graph/changes'
import { useStore, type Tab } from '../../store'
import type { FileChanged } from '../../types'

export default function RepoChanges({ tab }: { tab: Tab }) {
  const setDraft = useStore(state => state.setDraft)
  const openFile = useStore(state => state.openWorktreeFile)
  const { busy, run } = useRepoAction(tab.id)

  const [email, setEmail] = useState('')

  const { message, amend, file, fileStaged } = tab.draft
  const staged = tab.workingTree?.staged ?? []
  const unstaged = tab.workingTree?.unstaged ?? []

  useEffect(() => {
    ipc.userEmail(tab.id).then(setEmail).catch(() => setEmail(''))
  }, [tab.id])

  const canCommit = !busy && (amend || (message.trim() !== '' && staged.length > 0))

  const commit = async () => {
    if (!canCommit) return
    const trimmed = message.trim()
    await run(
      async () => {
        if (amend) {
          await ipc.amendCommit(tab.id, trimmed === '' ? null : trimmed)
        } else {
          await ipc.commitStaged(tab.id, trimmed)
        }
        setDraft(tab.id, { message: '', amend: false })
      },
      {
        failure: 'Commit failed',
        success: amend ? 'Commit amended' : 'Commit created',
        reloadHistory: true,
      },
    )
  }

  const fileRow = (entry: FileChanged, isStaged: boolean) => {
    const slash = entry.path.lastIndexOf('/')
    const open = file === entry.path && fileStaged === isStaged
    return (
      <li
        key={`${isStaged ? 's' : 'u'}:${entry.path}`}
        className={`change-row${open ? ' is-open' : ''}`}
        title={entry.path}
      >
        <button
          type="button"
          className="change-open"
          onClick={() => openFile(tab.id, entry.path, isStaged)}
        >
          <span className="change-file">{entry.path.slice(slash + 1)}</span>
          {slash > 0 && <span className="change-dir">{entry.path.slice(0, slash)}</span>}
        </button>
        <span className={`change-status ${changeClass(entry.change_type)}`}>
          {CHANGE_LETTER[entry.change_type]}
        </span>
        {!isStaged && (
          <button
            type="button"
            className="change-action"
            disabled={busy}
            title="Discard changes to this file"
            onClick={() =>
              void run(() => ipc.discardFile(tab.id, entry.path), { failure: 'Discard failed' })
            }
          >
            ↺
          </button>
        )}
        <button
          type="button"
          className="change-action"
          disabled={busy}
          title={isStaged ? 'Unstage this file' : 'Stage this file'}
          onClick={() =>
            void run(
              () =>
                isStaged ? ipc.unstageFile(tab.id, entry.path) : ipc.stageFile(tab.id, entry.path),
              { failure: isStaged ? 'Unstage failed' : 'Stage failed' },
            )
          }
        >
          {isStaged ? '−' : '+'}
        </button>
      </li>
    )
  }

  return (
    <div className="repo-changes">
      <textarea
        className="commit-message"
        placeholder={
          amend ? 'Amend message (blank keeps the original)' : `Message (⌘⏎ to commit${email ? ` as ${email}` : ''})`
        }
        value={message}
        maxLength={8192}
        rows={2}
        onChange={event => setDraft(tab.id, { message: event.target.value })}
        onKeyDown={event => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault()
            void commit()
          }
        }}
      />

      <div className="commit-actions">
        <button type="button" className="commit-button" disabled={!canCommit} onClick={() => void commit()}>
          {amend ? 'Amend' : 'Commit'}
          {staged.length > 0 && <span className="commit-count">{staged.length}</span>}
        </button>
        <label className="amend-toggle" title="Replace the last commit instead of adding one">
          <input
            type="checkbox"
            checked={amend}
            onChange={event => setDraft(tab.id, { amend: event.target.checked })}
          />
          Amend
        </label>
      </div>

      {staged.length > 0 && (
        <div className="change-group">
          <div className="change-group-head">
            <span>Staged Changes</span>
            <span className="group-count">{staged.length}</span>
            <button
              type="button"
              className="group-action"
              disabled={busy}
              title="Unstage everything"
              onClick={() => void run(() => ipc.unstageAll(tab.id), { failure: 'Unstage failed' })}
            >
              −
            </button>
          </div>
          <ul className="change-list">{staged.map(entry => fileRow(entry, true))}</ul>
        </div>
      )}

      {unstaged.length > 0 && (
        <div className="change-group">
          <div className="change-group-head">
            <span>Changes</span>
            <span className="group-count">{unstaged.length}</span>
            <button
              type="button"
              className="group-action"
              disabled={busy}
              title="Stage everything"
              onClick={() => void run(() => ipc.stageAll(tab.id), { failure: 'Stage failed' })}
            >
              +
            </button>
          </div>
          <ul className="change-list">{unstaged.map(entry => fileRow(entry, false))}</ul>
        </div>
      )}

      {staged.length === 0 && unstaged.length === 0 && (
        <p className="changes-clean">Working tree clean</p>
      )}
    </div>
  )
}
