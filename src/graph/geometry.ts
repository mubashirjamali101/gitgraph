/**
 * How the graph column is divided between lanes and ref badges.
 *
 * Both halves are sized from the *repository's* lane count, never from the
 * rows currently on screen: a per-window width made every lane and every badge
 * slide sideways as you scrolled past a merge.
 */
import { LANE_PADDING, LANE_WIDTH } from '../constants'

/** Narrowest a badge is allowed to get before it stops being readable. */
const MIN_BADGE_WIDTH = 96

/** Breathing room between the lanes, the badges and the next column. */
const GUTTER = 24

export interface GraphGeometry {
  /** Horizontal distance between lane centres. */
  laneGap: number
  /** Width the lanes occupy, where the badges start. */
  laneWidth: number
  /** How many ref badges fit before the rest collapse into a "+N" chip. */
  badgeLimit: number
}

export function graphGeometry(columnWidth: number, laneCount: number): GraphGeometry {
  const lanes = Math.max(1, laneCount)

  // Lanes compress rather than clip when a repository needs more of them than
  // fit: a lane that is not drawn is a line that silently disappears.
  const area = Math.max(GUTTER, columnWidth - LANE_PADDING - MIN_BADGE_WIDTH - GUTTER)
  const laneGap = Math.max(4, Math.min(LANE_WIDTH, area / lanes))
  const laneWidth = LANE_PADDING + Math.min(area, lanes * laneGap)

  // Whatever the lanes leave over decides how many badges are shown; the rest
  // stay reachable behind the chip instead of being clipped mid-word.
  const badgeLimit = Math.max(1, Math.floor((columnWidth - laneWidth - GUTTER) / MIN_BADGE_WIDTH))

  return { laneGap, laneWidth, badgeLimit }
}
