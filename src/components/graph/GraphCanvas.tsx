/**
 * The commit graph, drawn on a single viewport-sized canvas.
 *
 * Two properties are deliberate:
 *
 * - It draws only the rows in view. The previous SVG kept a path element for
 *   every parent link in the repository — 7,495 nodes on a mid-sized repo —
 *   which is what made scrolling stall.
 * - Every y coordinate comes from the same `RowLayout` the row list uses, so
 *   dots cannot drift away from the rows they belong to.
 */
import { useEffect, useRef } from 'react'

import { DOT_RADIUS, LANE_PADDING } from '../../constants'
import type { RowLayout } from '../../graph/layout'
import { isWorkingTreeRow } from '../../graph/rows'
import type { GraphRow } from '../../types'

interface GraphCanvasProps {
  rows: GraphRow[]
  layout: RowLayout
  scrollTop: number
  width: number
  height: number
  /** Horizontal distance between lanes; narrows when many lanes are in view. */
  laneGap: number
  /** First and last row to draw; the same window the list renders. */
  start: number
  end: number
}

/** Palette index → CSS custom property, so lanes follow the active theme. */
function readPalette(element: HTMLElement): string[] {
  const styles = getComputedStyle(element)
  return Array.from({ length: 8 }, (_, index) => {
    const value = styles.getPropertyValue(`--lane-${index}`).trim()
    return value || '#8b949e'
  })
}

export default function GraphCanvas({
  rows,
  layout,
  scrollTop,
  width,
  height,
  laneGap,
  start,
  end,
}: GraphCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    if (!context) return

    // Draw in device pixels so lines stay crisp on retina displays.
    const ratio = window.devicePixelRatio || 1
    if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
      canvas.width = Math.round(width * ratio)
      canvas.height = Math.round(height * ratio)
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    context.clearRect(0, 0, width, height)

    const palette = readPalette(canvas)
    const muted = getComputedStyle(canvas).getPropertyValue('--fg-tertiary').trim() || '#8b949e'
    const background = getComputedStyle(canvas).getPropertyValue('--bg-primary').trim() || '#0d1117'

    const laneX = (lane: number) => LANE_PADDING + laneGap / 2 + lane * laneGap
    const colorOf = (index: number) => palette[index % palette.length]

    context.lineCap = 'round'
    context.lineWidth = 1.75

    // Segments first, so dots sit on top of the lines they terminate.
    for (let index = start; index < end; index++) {
      const row = rows[index]
      if (!row) continue
      const next = rows[index + 1]
      if (!next) continue

      const fromY = layout.centre(index) - scrollTop
      const toY = layout.centre(index + 1) - scrollTop
      const dashed = isWorkingTreeRow(row)

      for (const segment of row.segments) {
        const x1 = laneX(segment.from)
        const x2 = laneX(segment.to)
        context.beginPath()
        context.strokeStyle = dashed ? muted : colorOf(segment.color)
        context.setLineDash(dashed ? [3, 3] : [])

        if (x1 === x2) {
          context.moveTo(x1, fromY)
          context.lineTo(x2, toY)
        } else {
          // Ease across lanes rather than cutting a diagonal, so merges read as
          // a branch rejoining instead of a stray line.
          const midY = (fromY + toY) / 2
          context.moveTo(x1, fromY)
          context.bezierCurveTo(x1, midY, x2, midY, x2, toY)
        }
        context.stroke()
      }
    }

    context.setLineDash([])

    for (let index = start; index < end; index++) {
      const row = rows[index]
      if (!row) continue
      const y = layout.centre(index) - scrollTop
      if (y < -DOT_RADIUS * 2 || y > height + DOT_RADIUS * 2) continue

      const x = laneX(row.lane)
      context.beginPath()
      context.arc(x, y, DOT_RADIUS, 0, Math.PI * 2)

      if (isWorkingTreeRow(row)) {
        // Hollow: this row is a pending state, not a commit.
        context.fillStyle = background
        context.fill()
        context.lineWidth = 1.5
        context.strokeStyle = muted
        context.stroke()
        context.lineWidth = 1.75
      } else {
        context.fillStyle = colorOf(row.color)
        context.fill()
      }
    }
  }, [rows, layout, scrollTop, width, height, laneGap, start, end])

  return (
    <canvas
      ref={canvasRef}
      className="graph-canvas"
      style={{ width: `${width}px`, height: `${height}px` }}
      aria-hidden="true"
    />
  )
}
