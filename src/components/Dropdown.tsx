/**
 * A button that opens a panel beneath itself.
 *
 * Both toolbar pickers use it, so "click outside to close", Escape, and the
 * arrow affordance are written once. The panel renders in flow rather than in
 * a portal: it only ever hangs off a toolbar, and a portal would need the
 * trigger's position measured and re-measured on every scroll and resize.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'

import './Dropdown.css'

interface DropdownProps {
  /** Shown inside the trigger button. */
  label: ReactNode
  title?: string
  disabled?: boolean
  /** Which edge of the trigger the panel lines up with. */
  align?: 'start' | 'end'
  className?: string
  /** Panel contents. `close` dismisses the panel from inside. */
  children: (close: () => void) => ReactNode
  /**
   * Called after the panel closes, for pickers that apply on dismissal.
   * `cancelled` is true when the user pressed Escape, which every other menu
   * in the app treats as "never mind" rather than as confirmation.
   */
  onClose?: (cancelled: boolean) => void
}

export default function Dropdown({
  label,
  title,
  disabled,
  align = 'start',
  className = '',
  children,
  onClose,
}: DropdownProps) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  // Held in a ref so the effect below does not re-subscribe whenever the
  // caller passes a fresh closure.
  const closed = useRef(onClose)
  closed.current = onClose

  /** Set by the Escape handler so the close effect can tell dismissal apart. */
  const cancelled = useRef(false)

  const close = () => setOpen(false)

  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      // Stopped here so Escape closes the menu without also collapsing the
      // expanded commit behind it.
      event.stopPropagation()
      cancelled.current = true
      setOpen(false)
    }

    // Capture phase: a click inside the graph would otherwise select a commit
    // on the way to closing the menu.
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [open])

  // Fires on the transition to closed, including a close from inside the
  // panel — but not on mount, which is not a dismissal.
  const wasOpen = useRef(false)
  useEffect(() => {
    if (wasOpen.current && !open) {
      closed.current?.(cancelled.current)
      cancelled.current = false
    }
    wasOpen.current = open
  }, [open])

  return (
    <div className={`dropdown ${className}`.trim()} ref={root}>
      <button
        type="button"
        className="dropdown-trigger"
        title={title}
        disabled={disabled}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => {
          cancelled.current = false
          setOpen(value => !value)
        }}
      >
        <span className="dropdown-label">{label}</span>
        <span className="dropdown-caret" aria-hidden="true">
          ▾
        </span>
      </button>

      {open && (
        <div className={`dropdown-panel align-${align}`} role="menu">
          {children(close)}
        </div>
      )}
    </div>
  )
}
