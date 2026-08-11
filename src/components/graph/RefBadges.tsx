/**
 * Branch / tag / HEAD chips shown next to a commit.
 *
 * Visibility is decided by *count*, not by measuring pixels against the graph
 * column's remaining width. The measuring approach silently hid every badge on
 * repositories with many lanes; here at most three are shown, each ellipsized by
 * CSS, and the rest are one click away.
 */
import type { MouseEvent } from 'react'

import type { GitRef } from '../../types'

const MAX_VISIBLE = 3

interface RefBadgesProps {
  refs: GitRef[]
  /** How many badges the space allows; the rest go behind the "+N" chip. */
  limit?: number
  onActivate: (ref: GitRef, event: MouseEvent) => void
  onContextMenu: (ref: GitRef, event: MouseEvent) => void
  onShowAll: (refs: GitRef[], event: MouseEvent) => void
}

export function refLabel(ref: GitRef): string {
  switch (ref.kind) {
    case 'LocalBranch':
      return ref.name
    case 'RemoteBranch':
      return ref.name
    case 'Tag':
      return ref.name
    case 'Head':
      return ref.detached ? 'HEAD (detached)' : 'HEAD'
  }
}

function badgeClass(ref: GitRef): string {
  const kind = ref.kind === 'LocalBranch' && ref.is_current ? 'current' : ref.kind.toLowerCase()
  return `ref-badge ref-${kind}`
}

export default function RefBadges({
  refs,
  limit = MAX_VISIBLE,
  onActivate,
  onContextMenu,
  onShowAll,
}: RefBadgesProps) {
  if (refs.length === 0) return null

  const visible = refs.slice(0, Math.max(1, Math.min(limit, MAX_VISIBLE)))
  const hidden = refs.length - visible.length

  return (
    <span className="ref-badges">
      {visible.map(ref => (
        <span
          key={`${ref.kind}-${refLabel(ref)}`}
          className={badgeClass(ref)}
          title={
            ref.kind === 'LocalBranch'
              ? `${ref.name} — double-click to check out, right-click for actions`
              : refLabel(ref)
          }
          onDoubleClick={event => onActivate(ref, event)}
          onContextMenu={event => onContextMenu(ref, event)}
        >
          <span className="ref-dot" aria-hidden="true" />
          <span className="ref-name">{refLabel(ref)}</span>
          {ref.kind === 'LocalBranch' && ref.is_current && <span className="ref-current">✓</span>}
        </span>
      ))}
      {hidden > 0 && (
        <button
          type="button"
          className="ref-more"
          title={`${refs.length} refs on this commit`}
          onClick={event => {
            event.stopPropagation()
            onShowAll(refs, event)
          }}
        >
          +{hidden}
        </button>
      )}
    </span>
  )
}
