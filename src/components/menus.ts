/**
 * What the context menus contain.
 *
 * Built as plain data so the list stays a rendering component — it reports
 * "the user right-clicked this ref" and nothing more — and so the menus can be
 * read in one place instead of being scattered through a component that also
 * owns dialogs, keyboard handling and layout.
 */
import { actions, type Confirmation } from '../actions'
import { isWorkingTreeRow } from '../graph/rows'
import type { GitRef, GraphRow } from '../types'
import type { PromptRequest } from './PromptDialog'

export interface MenuItem {
  id: string
  label: string
  disabled?: boolean
  onClick: () => void
}

/**
 * The things a menu needs from its host: somewhere to put a confirmation, and
 * somewhere to put a prompt. Both are dialogs the caller owns.
 */
export interface MenuHost {
  repoId: string
  /** Current branch name, for menu labels; null when HEAD is detached. */
  currentBranch: string | null
  ask: (confirmation: Confirmation | null) => void
  prompt: (request: PromptRequest) => void
}

/** "Create branch here…", shared by the ref and row menus. */
function branchHere(host: MenuHost, row: GraphRow): MenuItem {
  return {
    id: 'branch-here',
    label: 'Create branch here…',
    onClick: () =>
      host.prompt({
        title: `New branch at ${row.short_sha}`,
        label: 'Branch name',
        initial: '',
        confirmLabel: 'Create',
        onSubmit: value => actions.createBranch(host.repoId, value, row.sha, true),
      }),
  }
}

function localBranchItems(host: MenuHost, name: string, isCurrent: boolean): MenuItem[] {
  const { repoId, currentBranch } = host
  const items: MenuItem[] = []

  if (!isCurrent) {
    items.push(
      {
        id: 'checkout',
        label: `Check out ${name}`,
        onClick: () => void actions.checkout(repoId, name),
      },
      {
        id: 'merge',
        label: `Merge ${name} into ${currentBranch ?? 'current branch'}`,
        onClick: () => void actions.merge(repoId, name),
      },
      {
        id: 'rebase',
        label: `Rebase ${currentBranch ?? 'current branch'} onto ${name}`,
        onClick: () => void actions.rebase(repoId, name),
      },
    )
  }

  items.push(
    {
      id: 'push',
      label: `Push ${name}`,
      onClick: () => void actions.push(repoId, name).then(host.ask),
    },
    {
      id: 'rename',
      label: 'Rename branch…',
      onClick: () =>
        host.prompt({
          title: `Rename ${name}`,
          label: 'New branch name',
          initial: name,
          confirmLabel: 'Rename',
          onSubmit: value => actions.renameBranch(repoId, name, value),
        }),
    },
    {
      id: 'delete',
      label: 'Delete branch…',
      disabled: isCurrent,
      onClick: () => host.ask(actions.deleteBranch(repoId, name, false)),
    },
  )

  return items
}

function remoteBranchItems(host: MenuHost, name: string): MenuItem[] {
  const { repoId } = host
  const local = name.replace(/^origin\//, '')
  return [
    {
      id: 'checkout',
      label: `Check out ${local}`,
      onClick: () => void actions.checkout(repoId, name),
    },
    { id: 'fetch', label: `Fetch ${local}`, onClick: () => void actions.fetchBranch(repoId, local) },
    { id: 'pull', label: 'Pull into current branch', onClick: () => void actions.pull(repoId) },
    {
      id: 'delete-remote',
      label: 'Delete remote branch…',
      onClick: () => host.ask(actions.deleteRemoteBranch(repoId, local)),
    },
  ]
}

function tagItems(host: MenuHost, name: string): MenuItem[] {
  return [
    {
      id: 'checkout',
      label: `Check out ${name}`,
      onClick: () => void actions.checkout(host.repoId, name),
    },
    {
      id: 'delete-tag',
      label: 'Delete tag…',
      onClick: () => host.ask(actions.deleteTag(host.repoId, name)),
    },
  ]
}

/** Menu for a ref badge: branch, remote branch, tag or HEAD. */
export function refMenuItems(host: MenuHost, row: GraphRow, ref: GitRef): MenuItem[] {
  const items: MenuItem[] = []

  switch (ref.kind) {
    case 'LocalBranch':
      items.push(...localBranchItems(host, ref.name, ref.is_current))
      break
    case 'RemoteBranch':
      items.push(...remoteBranchItems(host, ref.name))
      break
    case 'Tag':
      items.push(...tagItems(host, ref.name))
      break
    case 'Head':
      break
  }

  items.push({
    id: 'copy',
    label: 'Copy name',
    onClick: () => void actions.copy(ref.kind === 'Head' ? 'HEAD' : ref.name, 'ref name'),
  })
  items.push(branchHere(host, row))

  return items
}

/** Menu for a commit row. The working-tree row has no history to act on. */
export function rowMenuItems(host: MenuHost, row: GraphRow): MenuItem[] {
  if (isWorkingTreeRow(row)) return []
  const { repoId } = host

  return [
    { ...branchHere(host, row), id: 'branch' },
    {
      id: 'tag',
      label: 'Create tag here…',
      onClick: () =>
        host.prompt({
          title: `New tag at ${row.short_sha}`,
          label: 'Tag name',
          initial: '',
          confirmLabel: 'Create tag',
          onSubmit: value => actions.createTag(repoId, value, row.sha, null),
        }),
    },
    {
      id: 'cherry-pick',
      label: 'Cherry-pick onto current branch',
      onClick: () => void actions.cherryPick(repoId, row.sha),
    },
    {
      id: 'revert',
      label: 'Revert commit…',
      onClick: () => host.ask(actions.revert(repoId, row.sha)),
    },
    {
      id: 'reset-mixed',
      label: 'Reset current branch here (keep changes)…',
      onClick: () => host.ask(actions.reset(repoId, row.sha, 'mixed')),
    },
    {
      id: 'reset-hard',
      label: 'Reset current branch here (discard changes)…',
      onClick: () => host.ask(actions.reset(repoId, row.sha, 'hard')),
    },
    { id: 'copy-sha', label: 'Copy commit SHA', onClick: () => void actions.copy(row.sha, 'SHA') },
    {
      id: 'copy-message',
      label: 'Copy commit message',
      onClick: () => void actions.copy(row.message, 'message'),
    },
  ]
}
