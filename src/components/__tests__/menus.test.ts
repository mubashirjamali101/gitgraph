/**
 * Menu contents are data, so they can be asserted without a right-click.
 */
import { describe, expect, it, vi } from 'vitest'

import { refMenuItems, rowMenuItems, type MenuHost } from '../menus'
import { WORKING_TREE_SHA } from '../../store'
import type { GraphRow } from '../../types'

const host: MenuHost = {
  repoId: 'repo',
  currentBranch: 'main',
  ask: vi.fn(),
  prompt: vi.fn(),
}

function row(sha = 'a'.repeat(40)): GraphRow {
  return {
    sha,
    short_sha: sha.slice(0, 7),
    message: 'a commit',
    author_name: 'Ada',
    author_email: 'ada@example.com',
    author_timestamp: 1_700_000_000,
    refs: [],
    lane: 0,
    color: 0,
    segments: [],
    parent_shas: [],
  }
}

const ids = (items: { id: string }[]) => items.map(item => item.id)

describe('ref menus', () => {
  it('offers to check out, merge and rebase another branch', () => {
    const items = refMenuItems(host, row(), {
      kind: 'LocalBranch',
      name: 'feature',
      is_current: false,
    })
    expect(ids(items)).toEqual(
      expect.arrayContaining(['checkout', 'merge', 'rebase', 'push', 'rename', 'delete']),
    )
  })

  it('does not offer to merge the branch you are on into itself', () => {
    const items = refMenuItems(host, row(), { kind: 'LocalBranch', name: 'main', is_current: true })
    expect(ids(items)).not.toContain('merge')
    expect(ids(items)).not.toContain('rebase')
    expect(ids(items)).not.toContain('checkout')
    // Deleting the branch you are on is offered but refused.
    expect(items.find(item => item.id === 'delete')?.disabled).toBe(true)
  })

  it('names the local branch when acting on its remote counterpart', () => {
    const items = refMenuItems(host, row(), { kind: 'RemoteBranch', name: 'origin/feature' })
    expect(items.find(item => item.id === 'checkout')?.label).toBe('Check out feature')
    expect(ids(items)).toContain('delete-remote')
  })

  it('gives a tag only the things a tag can do', () => {
    const items = refMenuItems(host, row(), { kind: 'Tag', name: 'v1.0' })
    expect(ids(items)).toEqual(['checkout', 'delete-tag', 'copy', 'branch-here'])
  })

  it('still copies and branches from a detached HEAD', () => {
    const items = refMenuItems(host, row(), { kind: 'Head', detached: true })
    expect(ids(items)).toEqual(['copy', 'branch-here'])
  })
})

describe('row menus', () => {
  it('offers the history-editing actions on a commit', () => {
    expect(ids(rowMenuItems(host, row()))).toEqual([
      'branch',
      'tag',
      'cherry-pick',
      'revert',
      'reset-mixed',
      'reset-hard',
      'copy-sha',
      'copy-message',
    ])
  })

  it('has nothing to offer on the uncommitted-changes row', () => {
    // There is no commit there to tag, revert or reset to.
    expect(rowMenuItems(host, row(WORKING_TREE_SHA))).toEqual([])
  })
})
