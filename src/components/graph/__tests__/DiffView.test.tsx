/**
 * The diff renders what is in view, not the whole file.
 *
 * A diff line is roughly seven DOM nodes, so a file at the backend's
 * 20,000-line cap was 145,000 nodes and a frozen window.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import { act } from 'react'

import { DIFF_LINE_HEIGHT } from '../../../constants'
import type { DiffLine, FileDiff } from '../../../types'
import DiffView from '../DiffView'

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never
})

function file(lineCount: number, options: Partial<FileDiff> = {}): FileDiff {
  const lines: DiffLine[] = Array.from({ length: lineCount }, (_, index) => ({
    content: `line ${index}`,
    line_type: index % 3 === 0 ? 'Added' : 'Context',
    old_lineno: index % 3 === 0 ? null : index + 1,
    new_lineno: index + 1,
  }))
  return {
    old_path: 'src/big.ts',
    new_path: 'src/big.ts',
    change_type: 'Modified',
    binary: false,
    truncated: false,
    hunks: [{ header: '@@ -1,100 +1,100 @@', old_start: 1, new_start: 1, lines }],
    ...options,
  }
}

/** jsdom gives every element zero height; give the scroller a viewport. */
function withViewport(container: HTMLElement, height = 400) {
  const scroller = container.querySelector('.diff-view') as HTMLElement
  Object.defineProperty(scroller, 'clientHeight', { value: height, configurable: true })
  return scroller
}

describe('DiffView', () => {
  it('renders a window of lines, not the file', () => {
    const { container } = render(<DiffView diff={file(20_000)} mode="inline" />)
    withViewport(container)

    const rendered = container.querySelectorAll('.diff-line').length
    expect(rendered).toBeGreaterThan(0)
    expect(rendered).toBeLessThan(200)

    // The scrollable height still describes the whole file.
    const canvas = container.querySelector('.diff-canvas') as HTMLElement
    // 20,000 lines plus the hunk header.
    expect(canvas.style.height).toBe(`${20_001 * DIFF_LINE_HEIGHT}px`)
  })

  it('shows the lines belonging to the scrolled position', () => {
    const { container } = render(<DiffView diff={file(5_000)} mode="inline" />)
    const scroller = withViewport(container)

    const first = container.querySelector('.diff-line .line-content')?.textContent
    expect(first).toBe('line 0')

    act(() => {
      scroller.scrollTop = 100 * DIFF_LINE_HEIGHT
      scroller.dispatchEvent(new Event('scroll'))
    })

    const afterScroll = [...container.querySelectorAll('.diff-line .line-content')].map(
      node => node.textContent,
    )
    expect(afterScroll).not.toContain('line 0')
    expect(afterScroll.some(text => text?.startsWith('line 9') || text?.startsWith('line 1'))).toBe(
      true,
    )
  })

  it('pairs removals with their replacements side by side', () => {
    const diff: FileDiff = {
      ...file(0),
      hunks: [
        {
          header: '@@ -1,2 +1,2 @@',
          old_start: 1,
          new_start: 1,
          lines: [
            { content: 'before', line_type: 'Removed', old_lineno: 1, new_lineno: null },
            { content: 'after', line_type: 'Added', old_lineno: null, new_lineno: 1 },
          ],
        },
      ],
    }
    const { container } = render(<DiffView diff={diff} mode="side-by-side" />)
    withViewport(container)

    const pair = container.querySelector('.diff-pair')
    expect(pair?.textContent).toContain('before')
    expect(pair?.textContent).toContain('after')
  })

  it('says so for a binary file instead of rendering nothing', () => {
    const { container } = render(
      <DiffView diff={file(0, { binary: true, hunks: [] })} mode="inline" />,
    )
    expect(container.textContent).toContain('Binary file')
  })

  it('reports truncation, which only the backend can know about', () => {
    const { container } = render(<DiffView diff={file(50, { truncated: true })} mode="inline" />)
    withViewport(container)
    expect(container.textContent).toContain('too large to show in full')
  })

  it('renders file content as text, never as markup', () => {
    const hostile = file(0, {
      hunks: [
        {
          header: '@@',
          old_start: 1,
          new_start: 1,
          lines: [
            {
              content: '<img src=x onerror="alert(1)">',
              line_type: 'Added',
              old_lineno: null,
              new_lineno: 1,
            },
          ],
        },
      ],
    })
    const { container } = render(<DiffView diff={hostile} mode="inline" />)
    withViewport(container)

    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toContain('<img src=x onerror="alert(1)">')
  })
})

// jsdom does not implement canvas; nothing here needs it, but React may warn.
vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
  callback(0)
  return 0
})
