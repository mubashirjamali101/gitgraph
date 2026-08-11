/**
 * Banner for an interrupted merge / rebase / cherry-pick / revert.
 *
 * State comes from the store (refreshed with the rest of the repository), so
 * the banner cannot disagree with what the graph is showing.
 */
import { useState } from 'react'
import { describeError } from '../errors'

import { ipc } from '../ipc'
import type { Tab } from '../store'
import { showToast } from './Toast'
import './ConflictBanner.css'

interface ConflictBannerProps {
  tab: Tab
  onResolved: () => void
}

function describe(tab: Tab): string | null {
  const state = tab.conflict
  if (!state) return null
  if (state.in_rebase) return 'Rebase in progress'
  if (state.in_merge) return 'Merge in progress'
  if (state.in_cherry_pick) return 'Cherry-pick in progress'
  if (state.in_revert) return 'Revert in progress'
  return null
}

export default function ConflictBanner({ tab, onResolved }: ConflictBannerProps) {
  const [busy, setBusy] = useState(false)
  const label = describe(tab)
  if (!label) return null

  const conflicts = tab.conflict?.conflicted_paths ?? []

  const run = async (verb: 'continue' | 'abort') => {
    setBusy(true)
    try {
      if (verb === 'continue') {
        await ipc.continueInProgress(tab.id)
        showToast.success('Operation continued')
      } else {
        await ipc.abortInProgress(tab.id)
        showToast.success('Operation aborted')
      }
      onResolved()
    } catch (error) {
      showToast.error(describeError(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="conflict-banner" role="status">
      <div className="conflict-label">
        <strong>{label}</strong>
        {conflicts.length > 0 && (
          <span>
            {' '}
            — {conflicts.length} conflicted file{conflicts.length === 1 ? '' : 's'}:{' '}
            <span className="conflict-paths">{conflicts.slice(0, 3).join(', ')}</span>
            {conflicts.length > 3 && ` +${conflicts.length - 3} more`}
          </span>
        )}
      </div>
      <div className="conflict-actions">
        <button
          type="button"
          disabled={busy || conflicts.length > 0}
          title={
            conflicts.length > 0
              ? 'Resolve the conflicted files first'
              : 'Continue the operation'
          }
          onClick={() => void run('continue')}
        >
          Continue
        </button>
        <button
          type="button"
          className="danger"
          disabled={busy}
          onClick={() => void run('abort')}
        >
          Abort
        </button>
      </div>
    </div>
  )
}
