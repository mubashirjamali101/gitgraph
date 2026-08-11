/**
 * Row geometry — the single source of truth for where things are drawn.
 *
 * The previous implementation positioned rows from one formula and the graph
 * from another, so anything that shifted rows (an expanded commit, a filtered
 * list) desynced the two. Here every consumer — the row list, the canvas, the
 * scroll-into-view helpers — asks the same object, so they cannot disagree.
 *
 * The expanded detail panel is part of the layout, not an offset applied
 * afterwards.
 */

export interface LayoutOptions {
  rowCount: number
  rowHeight: number
  /** Index of the row whose detail panel is open, or -1. */
  expandedIndex: number
  detailHeight: number
  /** Height of the end-of-history marker below the last row. */
  footerHeight: number
}

export interface VisibleRange {
  /** First row index to render (inclusive). */
  start: number
  /** Last row index to render (exclusive). */
  end: number
}

export class RowLayout {
  readonly rowCount: number
  readonly rowHeight: number
  readonly expandedIndex: number
  readonly detailHeight: number
  readonly footerHeight: number

  constructor(options: LayoutOptions) {
    this.rowCount = Math.max(0, options.rowCount)
    this.rowHeight = options.rowHeight
    // An out-of-range index means nothing is expanded — this is what happens
    // when the expanded commit scrolls out of the loaded set.
    this.expandedIndex =
      options.expandedIndex >= 0 && options.expandedIndex < this.rowCount ? options.expandedIndex : -1
    this.detailHeight = this.expandedIndex >= 0 ? options.detailHeight : 0
    this.footerHeight = options.footerHeight
  }

  /** Y offset of a row's top edge, in content coordinates. */
  top(index: number): number {
    const base = index * this.rowHeight
    return index > this.expandedIndex ? base + this.detailHeight : base
  }

  /** Y offset of a row's centre — where its graph dot sits. */
  centre(index: number): number {
    return this.top(index) + this.rowHeight / 2
  }

  /** Y offset of the detail panel, or -1 when nothing is expanded. */
  get detailTop(): number {
    return this.expandedIndex < 0 ? -1 : (this.expandedIndex + 1) * this.rowHeight
  }

  get totalHeight(): number {
    return this.rowCount * this.rowHeight + this.detailHeight + this.footerHeight
  }

  get footerTop(): number {
    return this.rowCount * this.rowHeight + this.detailHeight
  }

  /**
   * Rows intersecting a viewport, plus `overscan` rows of margin.
   *
   * Derived from `top()` rather than a separate calculation, so the window
   * always matches where rows are actually positioned.
   */
  visibleRange(scrollTop: number, viewportHeight: number, overscan = 8): VisibleRange {
    if (this.rowCount === 0) return { start: 0, end: 0 }

    const first = this.indexAtOffset(scrollTop)
    const last = this.indexAtOffset(scrollTop + viewportHeight)
    return {
      start: Math.max(0, first - overscan),
      end: Math.min(this.rowCount, last + 1 + overscan),
    }
  }

  /**
   * Index of the row containing a content offset. Offsets inside the detail
   * panel resolve to the row it belongs to, and offsets past the end clamp to
   * the last row, so callers never have to range-check.
   */
  indexAtOffset(offset: number): number {
    const clamped = Math.max(0, offset)
    if (this.expandedIndex < 0) {
      return Math.min(this.rowCount - 1, Math.floor(clamped / this.rowHeight))
    }
    const detailTop = this.detailTop
    if (clamped < detailTop) {
      return Math.floor(clamped / this.rowHeight)
    }
    if (clamped < detailTop + this.detailHeight) {
      return this.expandedIndex
    }
    return Math.min(this.rowCount - 1, Math.floor((clamped - this.detailHeight) / this.rowHeight))
  }

  /**
   * Scroll offset that brings a row fully into view, or `null` if it already
   * is. Keeps an expanded row's panel in view too, since expanding a row the
   * user just selected should show its contents.
   */
  scrollToReveal(index: number, scrollTop: number, viewportHeight: number): number | null {
    const top = this.top(index)
    const bottom =
      index === this.expandedIndex
        ? top + this.rowHeight + this.detailHeight
        : top + this.rowHeight

    if (top < scrollTop) return top
    if (bottom > scrollTop + viewportHeight) {
      // Prefer showing the top of a tall block over its bottom.
      return Math.min(top, bottom - viewportHeight)
    }
    return null
  }
}
