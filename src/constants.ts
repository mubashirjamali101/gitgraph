/**
 * Geometry shared by layout maths, canvas drawing and CSS.
 *
 * These used to be duplicated between a TypeScript constant and a CSS rule,
 * which drifted (a 36px header against a 32px one) and put every row four
 * pixels away from its graph dot. CSS reads them from custom properties written
 * at startup, so there is one definition.
 */

export const ROW_HEIGHT = {
  compact: 30,
  comfortable: 40,
} as const

export type Density = keyof typeof ROW_HEIGHT

/** Column header strip above the commit list. */
export const HEADER_HEIGHT = 32

/** Expanded commit detail panel. */
export const DETAIL_HEIGHT = 420

/** End-of-history marker below the last row. */
export const FOOTER_HEIGHT = 34

/** Horizontal distance between graph lanes. */
export const LANE_WIDTH = 14

/** Gutter before the first lane, so dots do not hug the window edge. */
export const LANE_PADDING = 12

/**
 * Height of one diff line. Fixed, so the diff can be virtualized — which means
 * lines do not wrap and long ones scroll sideways, as in every diff viewer.
 */
export const DIFF_LINE_HEIGHT = 18

/** Commit dot radius. */
export const DOT_RADIUS = 3.5

/** Rows rendered beyond the viewport on each side. */
export const OVERSCAN = 8

/** Load the next page when scrolling within this many pixels of the end. */
export const PREFETCH_MARGIN = 2000

export const PAGE_SIZE = 2000

export const MIN_COLUMN_WIDTH = {
  graph: 140,
  message: 240,
  author: 90,
  date: 120,
  sha: 72,
} as const

export const DEFAULT_COLUMN_WIDTH = {
  graph: 300,
  message: 520,
  author: 150,
  date: 170,
  sha: 84,
} as const

export type ColumnWidths = Record<keyof typeof DEFAULT_COLUMN_WIDTH, number>

/** Publish geometry to CSS so stylesheets and TypeScript cannot disagree. */
export function applyGeometry(density: Density): void {
  const root = document.documentElement.style
  root.setProperty('--row-height', `${ROW_HEIGHT[density]}px`)
  root.setProperty('--header-height', `${HEADER_HEIGHT}px`)
  root.setProperty('--detail-height', `${DETAIL_HEIGHT}px`)
  root.setProperty('--footer-height', `${FOOTER_HEIGHT}px`)
  root.setProperty('--diff-line-height', `${DIFF_LINE_HEIGHT}px`)
}
