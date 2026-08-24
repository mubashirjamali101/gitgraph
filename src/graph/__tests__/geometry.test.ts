/**
 * The graph column is only lanes. Width is sized from the repository's lane
 * count, so they stay put while you scroll.
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

  it('gives lanes the whole graph column', () => {
    const geo = graphGeometry(200, 2)
    expect(geo.laneGap).toBe(LANE_WIDTH)
    expect(geo.laneWidth).toBeLessThanOrEqual(200)
  })

  it('treats a repository with no lanes as having one', () => {
    expect(graphGeometry(300, 0)).toEqual(graphGeometry(300, 1))
  })
})
