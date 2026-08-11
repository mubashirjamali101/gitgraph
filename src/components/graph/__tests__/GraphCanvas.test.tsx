/**
 * What the canvas actually draws.
 *
 * The 2D context is recorded rather than rendered, so these assert the geometry
 * the user sees: a dot on every row at its own centre, and a line for every
 * segment that lands where the next row continues it.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'

import { DETAIL_HEIGHT, FOOTER_HEIGHT, LANE_PADDING } from '../../../constants'
import { RowLayout } from '../../../graph/layout'
import type { GraphRow } from '../../../types'
import GraphCanvas from '../GraphCanvas'

interface Recorded {
  arcs: { x: number; y: number }[]
  moves: { x: number; y: number }[]
  lines: { x: number; y: number }[]
  curves: { x: number; y: number }[]
}

let recorded: Recorded

function stubContext() {
  recorded = { arcs: [], moves: [], lines: [], curves: [] }
  const context = {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    setLineDash: vi.fn(),
    arc: (x: number, y: number) => recorded.arcs.push({ x, y }),
    moveTo: (x: number, y: number) => recorded.moves.push({ x, y }),
    lineTo: (x: number, y: number) => recorded.lines.push({ x, y }),
    bezierCurveTo: (_a: number, _b: number, _c: number, _d: number, x: number, y: number) =>
      recorded.curves.push({ x, y }),
    lineCap: '',
    lineWidth: 0,
    strokeStyle: '',
    fillStyle: '',
  }
  HTMLCanvasElement.prototype.getContext = vi.fn(() => context) as never
}

function row(sha: string, lane: number, segments: GraphRow['segments']): GraphRow {
  return {
    sha,
    short_sha: sha.slice(0, 7),
    message: sha,
    author_name: 'A',
    author_email: 'a@example.com',
    author_timestamp: 0,
    refs: [],
    lane,
    color: lane,
    segments,
    parent_shas: [],
  }
}

const ROW_HEIGHT = 30
const LANE_GAP = 14
const laneX = (lane: number) => LANE_PADDING + LANE_GAP / 2 + lane * LANE_GAP

function draw(rows: GraphRow[], options: { expandedIndex?: number; scrollTop?: number } = {}) {
  const layout = new RowLayout({
    rowCount: rows.length,
    rowHeight: ROW_HEIGHT,
    expandedIndex: options.expandedIndex ?? -1,
    detailHeight: DETAIL_HEIGHT,
    footerHeight: FOOTER_HEIGHT,
  })
  render(
    <GraphCanvas
      rows={rows}
      layout={layout}
      scrollTop={options.scrollTop ?? 0}
      width={200}
      height={2000}
      laneGap={LANE_GAP}
      start={0}
      end={rows.length}
    />,
  )
  return layout
}

describe('GraphCanvas', () => {
  beforeEach(stubContext)

  it('puts a dot on every row, at that row‘s centre', () => {
    const rows = [
      row('a', 0, [{ from: 0, to: 0, color: 0 }]),
      row('b', 0, [{ from: 0, to: 0, color: 0 }]),
      row('c', 0, []),
    ]
    const layout = draw(rows)

    expect(recorded.arcs).toHaveLength(3)
    recorded.arcs.forEach((dot, index) => {
      expect(dot.y).toBe(layout.centre(index))
      expect(dot.x).toBe(laneX(0))
    })
  })

  it('keeps dots on their rows below an expanded commit', () => {
    // The defect this replaces: rows shifted down by the detail panel while the
    // graph kept drawing at the unshifted positions.
    const rows = [
      row('a', 0, [{ from: 0, to: 0, color: 0 }]),
      row('b', 0, [{ from: 0, to: 0, color: 0 }]),
      row('c', 0, []),
    ]
    const layout = draw(rows, { expandedIndex: 0 })

    expect(recorded.arcs[1].y).toBe(layout.centre(1))
    expect(recorded.arcs[1].y).toBeGreaterThan(DETAIL_HEIGHT)
    expect(recorded.arcs[2].y - recorded.arcs[1].y).toBe(ROW_HEIGHT)
  })

  it('offsets by the scroll position and skips dots scrolled out of view', () => {
    const rows = [
      row('a', 0, [{ from: 0, to: 0, color: 0 }]),
      row('b', 0, [{ from: 0, to: 0, color: 0 }]),
      row('c', 0, []),
    ]
    const layout = draw(rows, { scrollTop: 2 * ROW_HEIGHT })

    // Rows above the viewport cost nothing: their dots are never drawn.
    expect(recorded.arcs).toHaveLength(1)
    expect(recorded.arcs[0].y).toBe(layout.centre(2) - 2 * ROW_HEIGHT)
  })

  it('draws a straight line for a lane that continues, and a curve for one that moves', () => {
    const rows = [
      // A merge: first parent stays in lane 0, the second opens lane 1.
      row('m', 0, [
        { from: 0, to: 0, color: 0 },
        { from: 0, to: 1, color: 1 },
      ]),
      row('p', 0, [{ from: 0, to: 0, color: 0 }, { from: 1, to: 1, color: 1 }]),
      row('q', 1, []),
    ]
    draw(rows)

    // The lane that stays put is a straight segment...
    expect(recorded.lines).toContainEqual({ x: laneX(0), y: ROW_HEIGHT * 1.5 })
    // ...and the one that changes lane is a curve ending in the new lane.
    expect(recorded.curves).toContainEqual({ x: laneX(1), y: ROW_HEIGHT * 1.5 })
  })

  it('lands every line where the next row continues it', () => {
    // A line that ends somewhere the next row does not pick up is a line
    // hanging in mid-air, which is what "the graph looks broken" means.
    const rows = [
      row('m', 0, [
        { from: 0, to: 0, color: 0 },
        { from: 0, to: 1, color: 1 },
      ]),
      row('a', 0, [
        { from: 0, to: 0, color: 0 },
        { from: 1, to: 1, color: 1 },
      ]),
      row('b', 1, [{ from: 0, to: 0, color: 0 }]),
      row('c', 0, []),
    ]
    const layout = draw(rows)

    const endpoints = [...recorded.lines, ...recorded.curves]
    for (let index = 0; index < rows.length - 1; index++) {
      const y = layout.centre(index + 1)
      const landing = endpoints.filter(point => point.y === y).map(point => point.x)
      for (const segment of rows[index].segments) {
        expect(landing).toContain(laneX(segment.to))
      }
      // And the row it lands on has its dot in one of those lanes.
      expect(landing).toContain(laneX(rows[index + 1].lane))
    }
  })

  it('draws nothing at all for an empty history', () => {
    draw([])
    expect(recorded.arcs).toHaveLength(0)
    expect(recorded.lines).toHaveLength(0)
  })
})
