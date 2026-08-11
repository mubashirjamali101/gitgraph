/**
 * The graph column is shared between lanes and ref badges. Both halves are
 * sized from the repository's lane count, so they stay put while you scroll.
 */
import { describe, expect, it } from 'vitest'

import { DEFAULT_COLUMN_WIDTH, LANE_WIDTH } from '../../constants'
import { graphGeometry } from '../geometry'

describe('graph column geometry', () => {
  it('spaces lanes at their natural width when there is room', () => {
    expect(graphGeometry(DEFAULT_COLUMN_WIDTH.graph, 3).laneGap).toBe(LANE_WIDTH)
  })

  it('compresses lanes rather than dropping them', () => {
    // A lane that is not drawn is a line that silently disappears, so a busy
    // repository squeezes the gap instead.
    const many = graphGeometry(DEFAULT_COLUMN_WIDTH.graph, 40)
    expect(many.laneGap).toBeLessThan(LANE_WIDTH)
    expect(many.laneGap).toBeGreaterThan(0)
    expect(many.laneWidth).toBeLessThanOrEqual(DEFAULT_COLUMN_WIDTH.graph)
  })

  it('always leaves room for at least one badge', () => {
    for (const width of [60, 140, 300, 900]) {
      for (const lanes of [1, 7, 40]) {
        expect(graphGeometry(width, lanes).badgeLimit).toBeGreaterThanOrEqual(1)
      }
    }
  })

  it('shows more badges as the column widens', () => {
    const narrow = graphGeometry(200, 2).badgeLimit
    const wide = graphGeometry(600, 2).badgeLimit
    expect(wide).toBeGreaterThan(narrow)
  })

  it('treats a repository with no lanes as having one', () => {
    expect(graphGeometry(300, 0)).toEqual(graphGeometry(300, 1))
  })
})
