/**
 * Repository actions shared by menus, buttons and keyboard shortcuts.
 *
 * Each action does one thing: call the backend, report the outcome, refresh.
 * Destructive ones return a description instead of running, so the caller can
 * put a confirmation in front of them — the decision to confirm lives with the
 * action, not with whichever menu happens to invoke it.
 */
import { ipc, type ResetMode } from './ipc'
import { useStore } from './store'
import { showToast } from './components/Toast'
import { describeError } from './errors'

export interface Confirmation {
  title: string
  message: string
  confirmLabel: string
  destructive?: boolean
  /** When set, the user must type this exact string to enable the action. */
  typeToConfirm?: string
  run: () => Promise<void>
}

async function reloadTab(repoId: string) {
  await useStore.getState().reload(repoId)
}

/** Run an operation, reporting success and failure the same way everywhere. */
async function perform(repoId: string, success: string, work: () => Promise<void>) {
  try {
    await work()
    await reloadTab(repoId)
    showToast.success(success)
  } catch (error) {
    showToast.error(describeError(error))
  }
}

export const actions = {
  async checkout(repoId: string, refName: string) {
    // Remote-tracking branches check out as their local counterpart.
    const target = refName.replace(/^origin\//, '')
    await perform(repoId, `Switched to ${target}`, () => ipc.checkout(repoId, target))
  },

  async createBranch(repoId: string, name: string, fromSha: string, checkout: boolean) {
    await perform(repoId, `Created ${name}`, () =>
      ipc.createBranch(repoId, name, fromSha, checkout),
    )
  },

  async renameBranch(repoId: string, oldName: string, newName: string) {
    await perform(repoId, `Renamed to ${newName}`, () =>
      ipc.renameBranch(repoId, oldName, newName),
    )
  },

  async createTag(repoId: string, name: string, sha: string, message: string | null) {
    await perform(repoId, `Tagged ${name}`, () => ipc.createTag(repoId, name, sha, message))
  },

  async merge(repoId: string, refName: string) {
    await perform(repoId, `Merged ${refName}`, () => ipc.merge(repoId, refName))
  },

  async rebase(repoId: string, onto: string) {
    await perform(repoId, `Rebased onto ${onto}`, () => ipc.rebase(repoId, onto))
  },

  async cherryPick(repoId: string, sha: string) {
    await perform(repoId, `Cherry-picked ${sha.slice(0, 7)}`, () => ipc.cherryPick(repoId, sha))
  },

  async fetchAll(repoId: string) {
    await perform(repoId, 'Fetched from origin', () => ipc.fetchAll(repoId))
  },

  async fetchBranch(repoId: string, branch: string) {
    await perform(repoId, `Fetched ${branch}`, () => ipc.fetchBranch(repoId, branch))
  },

  async pull(repoId: string) {
    await perform(repoId, 'Pulled from origin', () => ipc.pull(repoId))
  },

  /**
   * Push, checking first whether it would discard commits on the remote. A push
   * that rewrites published history is never silent.
   */
  async push(repoId: string, branch: string): Promise<Confirmation | null> {
    let impact = { ahead: 0, behind: 0, rewrites: false }
    try {
      impact = await ipc.pushImpact(repoId, branch)
    } catch {
      // No upstream yet: an ordinary first push.
    }

    if (!impact.rewrites) {
      await perform(repoId, `Pushed ${branch}`, () => ipc.push(repoId, branch))
      return null
    }

    return {
      title: 'Force push?',
      message:
        `origin/${branch} has ${impact.behind} commit(s) you do not have. Pushing will ` +
        `discard them. This uses --force-with-lease, but it cannot be undone.`,
      confirmLabel: 'Force push',
      destructive: true,
      typeToConfirm: branch,
      run: () => perform(repoId, `Force-pushed ${branch}`, () => ipc.forcePush(repoId, branch)),
    }
  },

  deleteBranch(repoId: string, name: string, force: boolean): Confirmation {
    return {
      title: 'Delete branch?',
      message: force
        ? `${name} will be deleted even though it has unmerged commits.`
        : `${name} will be deleted locally. Unmerged commits will block the delete.`,
      confirmLabel: 'Delete',
      destructive: true,
      run: () => perform(repoId, `Deleted ${name}`, () => ipc.deleteBranch(repoId, name, force)),
    }
  },

  deleteRemoteBranch(repoId: string, branch: string): Confirmation {
    return {
      title: 'Delete remote branch?',
      message: `origin/${branch} will be deleted for everyone using this remote.`,
      confirmLabel: 'Delete remote branch',
      destructive: true,
      typeToConfirm: branch,
      run: () =>
        perform(repoId, `Deleted origin/${branch}`, () => ipc.deleteRemoteBranch(repoId, branch)),
    }
  },

  deleteTag(repoId: string, name: string): Confirmation {
    return {
      title: 'Delete tag?',
      message: `Tag ${name} will be deleted locally.`,
      confirmLabel: 'Delete tag',
      destructive: true,
      run: () => perform(repoId, `Deleted tag ${name}`, () => ipc.deleteTag(repoId, name)),
    }
  },

  reset(repoId: string, sha: string, mode: ResetMode): Confirmation {
    const short = sha.slice(0, 7)
    return {
      title: mode === 'hard' ? 'Hard reset?' : `Reset (${mode})?`,
      message:
        mode === 'hard'
          ? `The current branch moves to ${short}. Uncommitted changes and any commits after it are lost.`
          : `The current branch moves to ${short}. Your files are left as they are.`,
      confirmLabel: 'Reset',
      destructive: mode === 'hard',
      typeToConfirm: mode === 'hard' ? 'reset' : undefined,
      run: () => perform(repoId, `Reset to ${short}`, () => ipc.reset(repoId, sha, mode)),
    }
  },

  revert(repoId: string, sha: string): Confirmation {
    const short = sha.slice(0, 7)
    return {
      title: 'Revert commit?',
      message: `A new commit will be created that undoes ${short}.`,
      confirmLabel: 'Revert',
      run: () => perform(repoId, `Reverted ${short}`, () => ipc.revert(repoId, sha)),
    }
  },

  discardFile(repoId: string, path: string): Confirmation {
    return {
      title: 'Discard changes?',
      message: `Changes to ${path} will be thrown away. This cannot be undone.`,
      confirmLabel: 'Discard',
      destructive: true,
      run: () => perform(repoId, `Discarded changes in ${path}`, () => ipc.discardFile(repoId, path)),
    }
  },

  async copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text)
      showToast.info(`Copied ${label}`)
    } catch {
      showToast.error('Clipboard unavailable')
    }
  },
}
