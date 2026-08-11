/**
 * One row of the commit table.
 *
 * Memoized and free of layout maths: its position comes from the caller, which
 * got it from the shared layout. Dates are pre-formatted by the caller too —
 * `toLocaleString` in a virtualized render path is a measurable cost.
 */
import { memo, type MouseEvent } from 'react'

import { formatCommitDate } from '../../graph/dates'
import { isWorkingTreeRow } from '../../graph/rows'
import type { GitRef, GraphRow } from '../../types'
import RefBadges from './RefBadges'

interface CommitRowProps {
  row: GraphRow
  top: number
  height: number
  laneWidth: number
  badgeLimit: number
  selected: boolean
  expanded: boolean
  matched: boolean
  currentMatch: boolean
  onSelect: (row: GraphRow) => void
  onContextMenu: (row: GraphRow, event: MouseEvent) => void
  onRefActivate: (row: GraphRow, ref: GitRef, event: MouseEvent) => void
  onRefContextMenu: (row: GraphRow, ref: GitRef, event: MouseEvent) => void
  onShowAllRefs: (row: GraphRow, refs: GitRef[], event: MouseEvent) => void
}

function CommitRow({
  row,
  top,
  height,
  laneWidth,
  badgeLimit,
  selected,
  expanded,
  matched,
  currentMatch,
  onSelect,
  onContextMenu,
  onRefActivate,
  onRefContextMenu,
  onShowAllRefs,
}: CommitRowProps) {
  const working = isWorkingTreeRow(row)
  const className = [
    'commit-row',
    selected && 'is-selected',
    expanded && 'is-expanded',
    matched && 'is-match',
    currentMatch && 'is-current-match',
    working && 'is-working-tree',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      className={className}
      style={{ top: `${top}px`, height: `${height}px` }}
      onClick={() => onSelect(row)}
      onContextMenu={event => onContextMenu(row, event)}
      role="row"
      aria-selected={selected}
    >
      {/* The lane track is a transparent spacer: the canvas paints beneath it. */}
      <div className="cell cell-graph">
        <div className="lane-track" style={{ width: `${laneWidth}px` }} aria-hidden="true" />
        <RefBadges
          refs={row.refs}
          limit={badgeLimit}
          onActivate={(ref, event) => onRefActivate(row, ref, event)}
          onContextMenu={(ref, event) => onRefContextMenu(row, ref, event)}
          onShowAll={(refs, event) => onShowAllRefs(row, refs, event)}
        />
      </div>
      <div className="cell cell-message" title={row.message}>
        {row.message}
      </div>
      <div className="cell cell-author" title={row.author_email}>
        {row.author_name}
      </div>
      <div className="cell cell-date">
        {working ? '—' : formatCommitDate(row.author_timestamp)}
      </div>
      <div className="cell cell-sha">
        {working ? <span className="sha-placeholder">•</span> : <code>{row.short_sha}</code>}
      </div>
    </div>
  )
}

export default memo(CommitRow)
