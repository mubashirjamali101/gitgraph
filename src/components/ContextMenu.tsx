/**
 * Right-click menu.
 *
 * Position is clamped to the viewport after mounting — a menu opened near the
 * bottom or right edge would otherwise render partly off-screen, which is where
 * the destructive items tend to sit.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import './ContextMenu.css'

export interface MenuItem {
  id: string
  label: string
  disabled?: boolean
  onClick: () => void
}

interface ContextMenuProps {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
}

const MARGIN = 8

export default function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: x, top: y })

  useLayoutEffect(() => {
    const menu = menuRef.current
    if (!menu) return
    const { width, height } = menu.getBoundingClientRect()
    setPosition({
      left: Math.max(MARGIN, Math.min(x, window.innerWidth - width - MARGIN)),
      top: Math.max(MARGIN, Math.min(y, window.innerHeight - height - MARGIN)),
    })
  }, [x, y, items.length])

  useEffect(() => {
    const close = () => onClose()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    // Any click outside dismisses; the menu's own buttons close themselves.
    window.addEventListener('click', close)
    window.addEventListener('resize', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('resize', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <div
      ref={menuRef}
      className="context-menu"
      style={{ left: position.left, top: position.top }}
      role="menu"
      onClick={event => event.stopPropagation()}
    >
      {items.map(item => (
        <button
          key={item.id}
          type="button"
          className="context-item"
          role="menuitem"
          disabled={item.disabled}
          onClick={() => {
            onClose()
            if (!item.disabled) item.onClick()
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
