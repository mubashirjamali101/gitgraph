/**
 * Running one repository operation from a component.
 *
 * Every such operation is the same shape: disable the controls, do the git
 * work, refresh what it changed, and turn a failure into a sentence rather
 * than a stack trace. Three components had written that out by hand, and
 * their copies had already drifted — two refreshed the working tree while the
 * third reloaded the graph, and only one reported success.
 */
import { useCallback, useState } from 'react'

import { describeError } from '../errors'
import { useStore } from '../store'
import { showToast } from '../components/Toast'

export interface RepoActionOptions {
  /** Prefix for the error toast, e.g. "Stage failed". */
  failure: string
  /** Shown when the action succeeds. Silent when omitted. */
  success?: string
  /**
   * Re-walk the history afterwards, for actions that create or move commits.
   * The default refreshes only the working tree, which is what staging needs
   * and is far cheaper than a reload.
   */
  reloadHistory?: boolean
}

export interface RepoAction {
  /** True while an action is in flight; bind it to `disabled`. */
  busy: boolean
  run: (work: () => Promise<unknown>, options: RepoActionOptions) => Promise<void>
}

export function useRepoAction(repoId: string): RepoAction {
  const refreshWorkingState = useStore(state => state.refreshWorkingState)
  const reload = useStore(state => state.reload)
  const [busy, setBusy] = useState(false)

  const run = useCallback(
    async (work: () => Promise<unknown>, options: RepoActionOptions) => {
      setBusy(true)
      try {
        await work()
        await (options.reloadHistory ? reload(repoId) : refreshWorkingState(repoId))
        if (options.success) showToast.success(options.success)
      } catch (error) {
        showToast.error(`${options.failure}: ${describeError(error)}`)
      } finally {
        setBusy(false)
      }
    },
    [refreshWorkingState, reload, repoId],
  )

  return { busy, run }
}
