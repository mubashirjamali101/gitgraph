/**
 * How the graph column is divided among lanes.
 *
 * Width is sized from the *repository's* lane count, never from the rows
 * currently on screen: a per-window width made every lane slide sideways as
 * you scrolled past a merge. Branch chips live in the commit column, so this
 * column is only the canvas.
 */
import { LANE_PADDING, LANE_WIDTH } from '../constants'

/** Breathing room after the last lane so a dot does not hug the next column. */
const GUTTER = 8

export interface GraphGeometry {
  /** Horizontal distance between lane centres. */
  laneGap: number
  /** Width the lanes occupy. */
  laneWidth: number
}

export function graphGeometry(columnWidth: number, laneCount: number): GraphGeometry {
  const lanes = Math.max(1, laneCount)

  // Lanes compress rather than clip when a repository needs more of them than
  // fit: a lane that is not drawn is a line that silently disappears.
  const area = Math.max(GUTTER, columnWidth - LANE_PADDING - GUTTER)
  const laneGap = Math.max(4, Math.min(LANE_WIDTH, area / lanes))
  const laneWidth = LANE_PADDING + Math.min(area, lanes * laneGap)

  return { laneGap, laneWidth }
}
