import { describe, expect, it } from 'vitest'

import { WORKING_TREE_SHA } from '../../store'
import type { GraphRow, WorkingTree } from '../../types'
import { buildDisplayRows, findMatches, nextMatch, summarizeWorkingTree } from '../rows'

function row(partial: Partial<GraphRow> & { sha: string }): GraphRow {
  return {
    short_sha: partial.sha.slice(0, 7),
    message: '',
    author_name: '',
    author_email: '',
    author_timestamp: 0,
    refs: [],
    lane: 0,
    color: 0,
    segments: [],
    parent_shas: [],
    ...partial,
  }
}

function tree(staged: string[], unstaged: string[]): WorkingTree {
  const file = (path: string, isStaged: boolean) => ({
    path,
    change_type: 'Modified' as const,
    staged: isStaged,
    insertions: 1,
    deletions: 0,
    binary: false,
  })
  return { staged: staged.map(p => file(p, true)), unstaged: unstaged.map(p => file(p, false)) }
}

describe('working tree row', () => {
  it('counts a file changed on both sides once', () => {
    const summary = summarizeWorkingTree(tree(['a.ts'], ['a.ts', 'b.ts']))
    expect(summary).toEqual({ staged: 1, unstaged: 2, total: 2 })
  })

  it('is omitted when the tree is clean', () => {
    const rows = [row({ sha: 'aaa' })]
    expect(buildDisplayRows(rows, tree([], []))).toBe(rows)
    expect(buildDisplayRows(rows, null)).toBe(rows)
  })

  it('joins the tip commit on its lane, carrying the lanes beside it', () => {
    const tip = row({
      sha: 'tip',
      lane: 1,
      color: 3,
      segments: [
        { from: 1, to: 1, color: 3 },
        { from: 0, to: 0, color: 5 },
      ],
    })
    const display = buildDisplayRows([tip], tree(['a.ts'], []))

    expect(display).toHaveLength(2)
    const synthetic = display[0]
    expect(synthetic.sha).toBe(WORKING_TREE_SHA)
    expect(synthetic.lane).toBe(1)
    expect(synthetic.message).toBe('1 uncommitted change')
    // Every lane that continues into the tip is drawn above it, so the band
    // between the two rows has no holes.
    expect(synthetic.segments).toContainEqual({ from: 1, to: 1, color: 3 })
    expect(synthetic.segments).toContainEqual({ from: 0, to: 0, color: 5 })
  })

  it('works on a repository with no commits yet', () => {
    const display = buildDisplayRows([], tree(['new.ts'], []))
    expect(display).toHaveLength(1)
    expect(display[0].lane).toBe(0)
    expect(display[0].parent_shas).toEqual([])
  })
})

describe('search', () => {
  const rows = [
    row({ sha: 'a1b2c3d4', message: 'Fix the parser', author_name: 'Ada' }),
    row({ sha: 'b2c3d4e5', message: 'Add tests', author_name: 'Grace' }),
    row({
      sha: 'c3d4e5f6',
      message: 'Release',
      author_name: 'Ada',
      refs: [{ kind: 'Tag', name: 'v1.2.0' }],
    }),
  ]

  it('matches message, author, sha prefix and ref name', () => {
    expect(findMatches(rows, 'parser')).toEqual([0])
    expect(findMatches(rows, 'ada')).toEqual([0, 2])
    expect(findMatches(rows, 'b2c3')).toEqual([1])
    expect(findMatches(rows, 'v1.2')).toEqual([2])
  })

  it('returns nothing for an empty query rather than everything', () => {
    expect(findMatches(rows, '   ')).toEqual([])
  })

  it('never matches the working tree row', () => {
    const display = buildDisplayRows(rows, tree(['uncommitted.ts'], []))
    expect(findMatches(display, 'uncommitted')).toEqual([])
  })

  it('steps through matches and wraps at both ends', () => {
    const matches = [2, 5, 9]
    expect(nextMatch(matches, -1, 1)).toBe(2)
    expect(nextMatch(matches, 2, 1)).toBe(5)
    expect(nextMatch(matches, 9, 1)).toBe(2)
    expect(nextMatch(matches, 9, -1)).toBe(5)
    expect(nextMatch(matches, 2, -1)).toBe(9)
    expect(nextMatch([], 0, 1)).toBeNull()
  })
})

