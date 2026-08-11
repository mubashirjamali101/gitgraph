/**
 * Dragging a column divider.
 *
 * The drag is tracked on the window rather than the handle, so the pointer may
 * leave the 6px strip — or the window — without the column sticking to it.
 */
import { useCallback, useEffect, useRef, type MouseEvent } from 'react'

import { clampColumn, type SizedColumn } from '../graph/columns'
import type { ColumnWidths } from '../constants'

interface ColumnResizeOptions {
  /** Widths as displayed: what the drag starts from. */
  shown: ColumnWidths
  /** Widths as chosen by the user: what gets written back. */
  chosen: ColumnWidths
  /** Space the columns must fit into. */
  available: number
  onChange: (widths: ColumnWidths) => void
}

export function useColumnResize({ shown, chosen, available, onChange }: ColumnResizeOptions) {
  // The listeners outlive the render that installed them, so they read the
  // current values through a ref instead of closing over stale ones.
  const latest = useRef({ shown, chosen, available, onChange })
  latest.current = { shown, chosen, available, onChange }

  const cleanup = useRef<() => void>(() => {})
  useEffect(() => () => cleanup.current(), [])

  return useCallback((column: SizedColumn, event: MouseEvent) => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = latest.current.shown[column]

    const onMove = (move: globalThis.MouseEvent) => {
      const { shown, chosen, available, onChange } = latest.current
      // Clamped against the pane, not just the column's own minimum: this
      // table has nowhere to scroll a column back from once it is pushed off
      // the right-hand edge.
      const width = clampColumn(shown, column, startWidth + move.clientX - startX, available)
      onChange({ ...chosen, [column]: width })
    }

    const stop = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', stop)
      document.body.style.cursor = ''
      cleanup.current = () => {}
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', stop)
    // Held for the whole drag, so the cursor does not flicker back to a
    // pointer whenever it strays off the divider.
    document.body.style.cursor = 'col-resize'
    cleanup.current = stop
  }, [])
}
