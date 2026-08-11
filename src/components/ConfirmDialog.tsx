import { useEffect, useRef, useState } from 'react'
import './ConfirmDialog.css'

interface ConfirmDialogProps {
  isOpen: boolean
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
  /** If set, user must type this string verbatim before "Confirm" is enabled. */
  typeToConfirm?: string
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  typeToConfirm,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const [typed, setTyped] = useState('')
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!isOpen) { setTyped(''); return }
    cancelRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onCancel() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, onCancel])

  if (!isOpen) return null
  const confirmReady = !typeToConfirm || typed === typeToConfirm

  return (
    <div className="confirm-overlay" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
      <div className="confirm-card">
        <h3 id="confirm-title">{title}</h3>
        <p className="confirm-message">{message}</p>
        {typeToConfirm && (
          <div className="confirm-type-block">
            <label>Type <code>{typeToConfirm}</code> to confirm:</label>
            <input
              autoFocus
              value={typed}
              onChange={e => setTyped(e.target.value)}
              spellCheck={false}
              autoComplete="off"
            />
          </div>
        )}
        <div className="confirm-actions">
          <button ref={cancelRef} onClick={onCancel}>{cancelLabel}</button>
          <button
            className={destructive ? 'confirm-destructive' : 'confirm-primary'}
            disabled={!confirmReady}
            onClick={onConfirm}
          >{confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}
