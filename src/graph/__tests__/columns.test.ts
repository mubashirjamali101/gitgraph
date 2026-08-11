/**
 * The table never scrolls sideways, so a column that does not fit is a column
 * you cannot see or reach. These are the cases that produced one.
 */
import { describe, expect, it } from 'vitest'

import { DEFAULT_COLUMN_WIDTH, MIN_COLUMN_WIDTH, type ColumnWidths } from '../../constants'
import { SIZED_COLUMNS, clampColumn, fitColumns, maxColumnWidth } from '../columns'

const widths = (overrides: Partial<ColumnWidths> = {}): ColumnWidths => ({
  ...DEFAULT_COLUMN_WIDTH,
  ...overrides,
})

/** What the grid actually needs: the sized columns plus a readable message. */
const required = (value: ColumnWidths) =>
  SIZED_COLUMNS.reduce((sum, key) => sum + value[key], 0) + MIN_COLUMN_WIDTH.message

describe('column widths', () => {
  it('leaves widths alone when they already fit', () => {
    const value = widths()
    expect(fitColumns(value, 1400)).toEqual(value)
  })

  it('never lets a column grow past the edge of the pane', () => {
    // The reported bug: with `message` already at its floor, dragging `date`
    // wider pushed `sha` out of the window, and nothing scrolls to reach it.
    const value = widths({ graph: 380, author: 230 })
    const pane = 1090

    const date = clampColumn(value, 'date', 900, pane)
    expect(required({ ...value, date })).toBeLessThanOrEqual(pane)
  })

  it('still allows a column to grow into space another one is not using', () => {
    const value = widths()
    expect(maxColumnWidth(value, 'author', 1400)).toBeGreaterThan(value.author)
    expect(clampColumn(value, 'author', value.author + 60, 1400)).toBe(value.author + 60)
  })

  it('refuses to shrink a column below its minimum', () => {
    const value = widths()
    expect(clampColumn(value, 'sha', 10, 1400)).toBe(MIN_COLUMN_WIDTH.sha)
  })

  it('takes a pane getting narrower out of the columns that have slack', () => {
    // Dragging the sidebar wider is the everyday case: widths chosen in a
    // wide window have to survive the pane shrinking under them.
    const value = widths({ graph: 420, author: 260, date: 260, sha: 140 })
    const pane = 900

    const fitted = fitColumns(value, pane)
    expect(required(fitted)).toBeLessThanOrEqual(pane)
    for (const key of SIZED_COLUMNS) {
      expect(fitted[key]).toBeGreaterThanOrEqual(MIN_COLUMN_WIDTH[key])
      expect(fitted[key]).toBeLessThanOrEqual(value[key])
    }
    // The column with the most room to spare gives up the most.
    expect(value.graph - fitted.graph).toBeGreaterThan(value.sha - fitted.sha)
  })

  it('falls back to the minimums when the pane cannot fit even those', () => {
    const fitted = fitColumns(widths(), 200)
    for (const key of SIZED_COLUMNS) {
      expect(fitted[key]).toBe(MIN_COLUMN_WIDTH[key])
    }
  })

  it('does not fit against an unmeasured pane', () => {
    // First render reports zero; fitting to it would persist a collapsed table.
    const value = widths()
    expect(fitColumns(value, 0)).toEqual(value)
  })
})
