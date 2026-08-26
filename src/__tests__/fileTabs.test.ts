import { beforeEach, describe, expect, it } from 'vitest'
import { useStore, type FileTab, type OpenFile } from '../store'

describe('file tab context actions in store', () => {
  const repoId = 'test-repo-id'

  const mockFile = (key: string): OpenFile => ({
    key,
    diff: null,
    loading: false,
    error: null,
  })

  beforeEach(() => {
    useStore.setState({
      activeId: repoId,
      tabs: [
        {
          id: repoId,
          path: '/test/repo',
          name: 'repo',
          rows: [],
          cursor: null,
          total: 0,
          laneCount: 1,
          truncated: false,
          loading: false,
          loadingMore: false,
          error: null,
          status: null,
          workingTree: null,
          stashes: [],
          conflict: null,
          refs: [],
          revealSha: null,
          filter: { branches: [], includeRemotes: true },
          selectedSha: null,
          expandedSha: null,
          search: '',
          scrollTop: 0,
          detailFile: null,
          draft: { message: '', amend: false, file: null, fileStaged: false },
          detail: null,
          file: null,
          files: {
            t1: mockFile('t1'),
            t2: mockFile('t2'),
            t3: mockFile('t3'),
            t4: mockFile('t4'),
          },
          editorTabs: [
            { id: 't1', path: 'file1.txt', kind: 'worktree', sha: null, staged: false },
            { id: 't2', path: 'file2.txt', kind: 'worktree', sha: null, staged: false },
            { id: 't3', path: 'file3.txt', kind: 'worktree', sha: null, staged: false },
            { id: 't4', path: 'file4.txt', kind: 'worktree', sha: null, staged: false },
          ] as FileTab[],
          activeEditor: 't2',
        },
      ],
    })
  })

  it('closeOtherFileTabs keeps only the targeted tab', () => {
    useStore.getState().closeOtherFileTabs(repoId, 't2')

    const tab = useStore.getState().tabs.find(t => t.id === repoId)!
    expect(tab.editorTabs.map(t => t.id)).toEqual(['t2'])
    expect(Object.keys(tab.files)).toEqual(['t2'])
    expect(tab.activeEditor).toBe('t2')
  })

  it('closeFileTabsToRight closes tabs to the right of targeted tab', () => {
    useStore.getState().closeFileTabsToRight(repoId, 't2')

    const tab = useStore.getState().tabs.find(t => t.id === repoId)!
    expect(tab.editorTabs.map(t => t.id)).toEqual(['t1', 't2'])
    expect(Object.keys(tab.files).sort()).toEqual(['t1', 't2'])
    expect(tab.activeEditor).toBe('t2')
  })

  it('closeFileTabsToLeft closes tabs to the left of targeted tab', () => {
    useStore.getState().closeFileTabsToLeft(repoId, 't3')

    const tab = useStore.getState().tabs.find(t => t.id === repoId)!
    expect(tab.editorTabs.map(t => t.id)).toEqual(['t3', 't4'])
    expect(Object.keys(tab.files).sort()).toEqual(['t3', 't4'])
    expect(tab.activeEditor).toBe('t3')
  })

  it('closeAllFileTabs closes all open tabs', () => {
    useStore.getState().closeAllFileTabs(repoId)

    const tab = useStore.getState().tabs.find(t => t.id === repoId)!
    expect(tab.editorTabs).toHaveLength(0)
    expect(tab.files).toEqual({})
    expect(tab.activeEditor).toBeNull()
  })
})
