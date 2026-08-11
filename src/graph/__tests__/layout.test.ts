import { describe, expect, it } from 'vitest'
import { RowLayout } from '../layout'

const base = {
  rowCount: 100,
  rowHeight: 30,
  expandedIndex: -1,
  detailHeight: 420,
  footerHeight: 32,
}

describe('RowLayout', () => {
  it('places rows at a constant pitch when nothing is expanded', () => {
    const layout = new RowLayout(base)
    expect(layout.top(0)).toBe(0)
    expect(layout.top(10)).toBe(300)
    expect(layout.centre(10)).toBe(315)
    expect(layout.detailTop).toBe(-1)
    expect(layout.totalHeight).toBe(100 * 30 + 32)
  })

  it('pushes only the rows below an expanded commit', () => {
    const layout = new RowLayout({ ...base, expandedIndex: 5 })
    expect(layout.top(5)).toBe(150)
    expect(layout.top(6)).toBe(180 + 420)
    expect(layout.detailTop).toBe(180)
    expect(layout.totalHeight).toBe(100 * 30 + 420 + 32)
  })

  it('reports the same geometry to every consumer', () => {
    // The dot and the row it belongs to are computed from one function, so the
    // desync that appeared below an expanded panel cannot happen.
    const layout = new RowLayout({ ...base, expandedIndex: 3 })
    for (const index of [0, 3, 4, 50, 99]) {
      expect(layout.centre(index)).toBe(layout.top(index) + 15)
    }
  })

  it('ignores an expanded index that is not in the loaded range', () => {
    // Filtering or a shrinking page can leave a stale index behind; it must not
    // shift every row by the panel height.
    const layout = new RowLayout({ ...base, expandedIndex: 500 })
    expect(layout.detailTop).toBe(-1)
    expect(layout.top(1)).toBe(30)
    expect(layout.totalHeight).toBe(100 * 30 + 32)

    const empty = new RowLayout({ ...base, rowCount: 0, expandedIndex: 0 })
    expect(empty.totalHeight).toBe(32)
    expect(empty.visibleRange(0, 500)).toEqual({ start: 0, end: 0 })
  })

  it('derives the visible window from row positions', () => {
    const layout = new RowLayout(base)
    expect(layout.visibleRange(0, 300, 0)).toEqual({ start: 0, end: 11 })
    expect(layout.visibleRange(300, 300, 0)).toEqual({ start: 10, end: 21 })
    expect(layout.visibleRange(0, 300, 5)).toEqual({ start: 0, end: 16 })
  })

  it('accounts for the detail panel when windowing', () => {
    const layout = new RowLayout({ ...base, expandedIndex: 2 })
    // Rows 0-2, then 420px of panel: the window must not contain rows that are
    // pushed past the bottom of the viewport by the panel.
    expect(layout.visibleRange(0, 300, 0)).toEqual({ start: 0, end: 3 })
    // Scrolled past the panel, ordinary rows resume.
    const range = layout.visibleRange(500, 300, 0)
    expect(range.start).toBe(2)
    expect(layout.top(range.end - 1)).toBeLessThan(500 + 300)
  })

  it('maps offsets back to rows, including inside the panel', () => {
    const layout = new RowLayout({ ...base, expandedIndex: 4 })
    expect(layout.indexAtOffset(0)).toBe(0)
    expect(layout.indexAtOffset(135)).toBe(4)
    expect(layout.indexAtOffset(layout.detailTop + 10)).toBe(4)
    expect(layout.indexAtOffset(layout.top(5) + 1)).toBe(5)
    expect(layout.indexAtOffset(-100)).toBe(0)
    expect(layout.indexAtOffset(1e9)).toBe(99)
  })

  it('scrolls a row into view from either direction', () => {
    const layout = new RowLayout(base)
    expect(layout.scrollToReveal(20, 0, 300)).toBe(20 * 30 + 30 - 300)
    expect(layout.scrollToReveal(2, 300, 300)).toBe(60)
    expect(layout.scrollToReveal(5, 0, 300)).toBeNull()
  })

  it('reveals an expanded row with its panel', () => {
    const layout = new RowLayout({ ...base, expandedIndex: 20 })
    // The panel is taller than the viewport, so the top of the row wins.
    expect(layout.scrollToReveal(20, 0, 300)).toBe(layout.top(20))
  })

  it('scales with row height', () => {
    const comfortable = new RowLayout({ ...base, rowHeight: 40, expandedIndex: 2 })
    expect(comfortable.top(2)).toBe(80)
    expect(comfortable.detailTop).toBe(120)
    expect(comfortable.top(3)).toBe(120 + 420)
  })
})
