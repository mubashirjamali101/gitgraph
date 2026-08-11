/**
 * Single-field prompt (branch name, tag name, …).
 *
 * The input is controlled React state. The previous version wrote these dialogs
 * inline and read the value back with `document.getElementById`, which meant the
 * value could be stale or missing depending on render timing.
 */
import { useEffect, useRef, useState } from 'react'

import './PromptDialog.css'

export interface PromptRequest {
  title: string
  label: string
  initial: string
  confirmLabel: string
  placeholder?: string
  onSubmit: (value: string) => void | Promise<void>
}

interface PromptDialogProps {
  request: PromptRequest | null
  onClose: () => void
}

export default function PromptDialog({ request, onClose }: PromptDialogProps) {
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!request) return
    setValue(request.initial)
    // Focus after the dialog exists, and select so typing replaces the default.
    const id = window.setTimeout(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }, 0)
    return () => window.clearTimeout(id)
  }, [request])

  useEffect(() => {
    if (!request) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [request, onClose])

  if (!request) return null

  const trimmed = value.trim()

  const submit = () => {
    if (trimmed === '') return
    void request.onSubmit(trimmed)
    onClose()
  }

  return (
    <div className="prompt-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="prompt-card" onClick={event => event.stopPropagation()}>
        <h2 className="prompt-title">{request.title}</h2>
        <label className="prompt-label" htmlFor="prompt-input">
          {request.label}
        </label>
        <input
          id="prompt-input"
          ref={inputRef}
          value={value}
          placeholder={request.placeholder}
          onChange={event => setValue(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter') {
              event.preventDefault()
              submit()
            }
          }}
        />
        <div className="prompt-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="primary" disabled={trimmed === ''} onClick={submit}>
            {request.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
