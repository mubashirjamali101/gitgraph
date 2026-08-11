/**
 * Column widths that always add up to the pane.
 *
 * The table does not scroll sideways: the graph canvas is pinned to the left
 * of it, so scrolling the columns would drag the lanes out of view. Every
 * column is therefore sized against the space actually available, with
 * `message` as the flexible one that absorbs the difference.
 *
 * Getting this wrong is not cosmetic. Widening `date` once `message` had
 * bottomed out pushed the total past the pane, and since nothing scrolls, the
 * SHA column simply left the window with no way to bring it back.
 */
import { MIN_COLUMN_WIDTH, type ColumnWidths } from '../constants'

/** Columns with a width of their own. `message` takes whatever is left. */
export const SIZED_COLUMNS = ['graph', 'author', 'date', 'sha'] as const

/** The CSS grid tracks for one set of widths. */
export function gridTemplate(widths: ColumnWidths, available: number): string {
  const sized = SIZED_COLUMNS.reduce((total, key) => total + widths[key], 0)
  // On a pane too narrow even for every minimum, `message` gives up its floor
  // rather than the table overflowing: a cramped commit column is worse than a
  // readable one, but not as bad as a SHA column that has left the window with
  // nothing to scroll it back.
  const messageMin =
    available > 0
      ? Math.max(0, Math.min(MIN_COLUMN_WIDTH.message, available - sized))
      : MIN_COLUMN_WIDTH.message
  return `${widths.graph}px minmax(${messageMin}px, 1fr) ${widths.author}px ${widths.date}px ${widths.sha}px`
}

export type SizedColumn = (typeof SIZED_COLUMNS)[number]

/** Space the sized columns may share before `message` is squeezed too far. */
function budget(available: number): number {
  return available - MIN_COLUMN_WIDTH.message
}

/**
 * The widest `column` may be without pushing another column off the pane.
 *
 * Returns its minimum when there is no room at all — a pane narrower than the
 * columns' minimums has no valid answer, and refusing to shrink below the
 * minimum keeps the table readable rather than collapsing it to slivers.
 */
export function maxColumnWidth(
  widths: ColumnWidths,
  column: SizedColumn,
  available: number,
): number {
  const others = SIZED_COLUMNS.filter(key => key !== column).reduce(
    (total, key) => total + widths[key],
    0,
  )
  return Math.max(MIN_COLUMN_WIDTH[column], budget(available) - others)
}

/** Clamp one column to what it may be, given the others. */
export function clampColumn(
  widths: ColumnWidths,
  column: SizedColumn,
  wanted: number,
  available: number,
): number {
  return Math.min(
    maxColumnWidth(widths, column, available),
    Math.max(MIN_COLUMN_WIDTH[column], Math.round(wanted)),
  )
}

/**
 * Fit stored widths into the space there is now.
 *
 * Widths outlive the window they were chosen in: they are restored on start-up
 * and survive both the window resizing and the sidebar being dragged. When
 * they no longer fit, every column gives up a share of its slack proportional
 * to how much it has, so no single column collapses while another keeps room
 * it is not using.
 */
export function fitColumns(widths: ColumnWidths, available: number): ColumnWidths {
  // No measurement yet (first render): leave the widths alone rather than
  // fitting them to a zero-width pane and persisting the result.
  if (!Number.isFinite(available) || available <= 0) return widths

  const total = SIZED_COLUMNS.reduce((sum, key) => sum + widths[key], 0)
  let excess = total - budget(available)
  if (excess <= 0) return widths

  const slack = (key: SizedColumn) => Math.max(0, widths[key] - MIN_COLUMN_WIDTH[key])
  const totalSlack = SIZED_COLUMNS.reduce((sum, key) => sum + slack(key), 0)
  // Everything is already at its minimum: the pane is simply too narrow, and
  // the columns keep their floors instead of becoming unreadable.
  if (totalSlack <= 0) {
    return { ...widths, ...Object.fromEntries(SIZED_COLUMNS.map(key => [key, MIN_COLUMN_WIDTH[key]])) }
  }

  const fitted = { ...widths }
  for (const key of SIZED_COLUMNS) {
    const share = Math.min(slack(key), Math.round((excess * slack(key)) / totalSlack))
    fitted[key] = widths[key] - share
  }

  // Rounding can leave a pixel or two over; take it from whoever still has it.
  excess = SIZED_COLUMNS.reduce((sum, key) => sum + fitted[key], 0) - budget(available)
  for (const key of SIZED_COLUMNS) {
    if (excess <= 0) break
    const give = Math.min(excess, fitted[key] - MIN_COLUMN_WIDTH[key])
    fitted[key] -= give
    excess -= give
  }

  return fitted
}
