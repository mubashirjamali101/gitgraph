/**
 * File diff rendering, inline or side by side.
 *
 * Virtualized: a diff line is ~7 DOM nodes, so a file at the backend's
 * 20,000-line cap would be 145,000 nodes and a frozen window. Only the lines in
 * view are rendered, positioned from the same `RowLayout` the commit list uses.
 *
 * Lines do not wrap. That is what makes every row the same height — and it is
 * how every other diff viewer behaves; long lines scroll sideways.
 *
 * Line numbers come from git (`old_lineno` / `new_lineno`) rather than being
 * counted while rendering: a counted index is only correct for the first hunk.
 */
import { memo, useMemo, useState } from 'react'

import { DIFF_LINE_HEIGHT } from '../../constants'
import { RowLayout } from '../../graph/layout'
import { useElementHeight, useScrollTop } from '../../hooks/useScrollTop'
import { highlightLine, languageFor } from '../../utils/highlightCache'
import type { DiffLine, FileDiff } from '../../types'
import './DiffView.css'

interface DiffViewProps {
  diff: FileDiff
  mode: 'inline' | 'side-by-side'
}

/** One rendered row: a hunk header, or a line (paired, when side by side). */
type Row =
  | { kind: 'header'; text: string }
  | { kind: 'line'; left: DiffLine | null; right: DiffLine | null }

/** Flatten hunks into a single addressable list of rows. */
function buildRows(diff: FileDiff, mode: 'inline' | 'side-by-side'): Row[] {
  const rows: Row[] = []

  for (const hunk of diff.hunks) {
    rows.push({ kind: 'header', text: hunk.header })

    if (mode === 'inline') {
      for (const line of hunk.lines) {
        rows.push({ kind: 'line', left: line, right: line })
      }
      continue
    }

    // Side by side pairs each removal with the addition that replaced it.
    let index = 0
    while (index < hunk.lines.length) {
      const line = hunk.lines[index]
      if (line.line_type === 'Removed') {
        const removed: DiffLine[] = []
        const added: DiffLine[] = []
        while (index < hunk.lines.length && hunk.lines[index].line_type === 'Removed') {
          removed.push(hunk.lines[index++])
        }
        while (index < hunk.lines.length && hunk.lines[index].line_type === 'Added') {
          added.push(hunk.lines[index++])
        }
        for (let offset = 0; offset < Math.max(removed.length, added.length); offset++) {
          rows.push({ kind: 'line', left: removed[offset] ?? null, right: added[offset] ?? null })
        }
      } else if (line.line_type === 'Added') {
        rows.push({ kind: 'line', left: null, right: line })
        index++
      } else {
        rows.push({ kind: 'line', left: line, right: line })
        index++
      }
    }
  }

  return rows
}

function sign(line: DiffLine | null): string {
  if (!line) return ' '
  return line.line_type === 'Added' ? '+' : line.line_type === 'Removed' ? '−' : ' '
}

function DiffView({ diff, mode }: DiffViewProps) {
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null)
  const scrollTop = useScrollTop(scroller)
  const viewportHeight = useElementHeight(scroller)

  const language = useMemo(
    () => languageFor(diff.new_path || diff.old_path),
    [diff.new_path, diff.old_path],
  )
  const rows = useMemo(() => buildRows(diff, mode), [diff, mode])

  const layout = useMemo(
    () =>
      new RowLayout({
        rowCount: rows.length,
        rowHeight: DIFF_LINE_HEIGHT,
        expandedIndex: -1,
        detailHeight: 0,
        footerHeight: diff.truncated ? DIFF_LINE_HEIGHT * 2 : 0,
      }),
    [rows.length, diff.truncated],
  )

  const range = layout.visibleRange(scrollTop, viewportHeight || 400, 12)

  if (diff.binary) {
    return <div className="diff-empty">Binary file — no textual diff</div>
  }
  if (rows.length === 0) {
    return <div className="diff-empty">No changes in this file</div>
  }

  const visible = []
  for (let index = range.start; index < range.end; index++) {
    const row = rows[index]
    if (!row) continue
    const top = layout.top(index)

    if (row.kind === 'header') {
      visible.push(
        <div key={index} className="hunk-header" style={{ top }}>
          {row.text}
        </div>,
      )
      continue
    }

    if (mode === 'inline') {
      const line = row.left!
      visible.push(
        <div key={index} className={`diff-line line-${line.line_type.toLowerCase()}`} style={{ top }}>
          <span className="line-no">{line.old_lineno ?? ''}</span>
          <span className="line-no">{line.new_lineno ?? ''}</span>
          <span className="line-sign">{sign(line)}</span>
          <span className="line-content">{highlightLine(language, line.content)}</span>
        </div>,
      )
      continue
    }

    visible.push(
      <div key={index} className="diff-pair" style={{ top }}>
        <div
          className={`diff-side ${row.left ? `line-${row.left.line_type.toLowerCase()}` : 'line-blank'}`}
        >
          {row.left && (
            <>
              <span className="line-no">{row.left.old_lineno ?? ''}</span>
              <span className="line-sign">{sign(row.left)}</span>
              <span className="line-content">{highlightLine(language, row.left.content)}</span>
            </>
          )}
        </div>
        <div
          className={`diff-side ${row.right ? `line-${row.right.line_type.toLowerCase()}` : 'line-blank'}`}
        >
          {row.right && (
            <>
              <span className="line-no">{row.right.new_lineno ?? ''}</span>
              <span className="line-sign">{sign(row.right)}</span>
              <span className="line-content">{highlightLine(language, row.right.content)}</span>
            </>
          )}
        </div>
      </div>,
    )
  }

  return (
    <div className={`diff-view diff-${mode}`} ref={setScroller}>
      <div className="diff-canvas" style={{ height: `${layout.totalHeight}px` }}>
        {visible}
        {diff.truncated && (
          <div className="diff-truncated" style={{ top: layout.footerTop }}>
            This file is too large to show in full — displaying the first part only.
          </div>
        )}
      </div>
    </div>
  )
}

export default memo(DiffView)
