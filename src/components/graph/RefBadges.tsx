/**
 * Branch / tag / HEAD chips shown in front of a commit message.
 *
 * Every ref on the row is rendered. The message column truncates if they take
 * the space — the expanded row still has the full list.
 */
import type { MouseEvent } from 'react'

import type { GitRef } from '../../types'

interface RefBadgesProps {
  refs: GitRef[]
  onActivate: (ref: GitRef, event: MouseEvent) => void
  onContextMenu: (ref: GitRef, event: MouseEvent) => void
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

export default function RefBadges({ refs, onActivate, onContextMenu }: RefBadgesProps) {
  if (refs.length === 0) return null

  return (
    <span className="ref-badges">
      {refs.map(ref => (
        <span
          key={`${ref.kind}-${refLabel(ref)}`}
          className={badgeClass(ref)}
          title={
            ref.kind === 'LocalBranch'
              ? `${ref.name} — double-click to check out, right-click for actions`
              : refLabel(ref)
          }
          onDoubleClick={event => {
            event.stopPropagation()
            onActivate(ref, event)
          }}
          onContextMenu={event => onContextMenu(ref, event)}
        >
          <span className="ref-dot" aria-hidden="true" />
          <span className="ref-name">{refLabel(ref)}</span>
          {ref.kind === 'LocalBranch' && ref.is_current && <span className="ref-current">✓</span>}
        </span>
      ))}
    </span>
  )
}
