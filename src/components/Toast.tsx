import { useEffect, useState } from 'react'
import './Toast.css'

export type ToastKind = 'info' | 'success' | 'error'

export interface ToastEntry {
  id: number
  kind: ToastKind
  message: string
}

let nextId = 1
const listeners = new Set<(t: ToastEntry) => void>()

export function toast(kind: ToastKind, message: string) {
  const entry: ToastEntry = { id: nextId++, kind, message }
  listeners.forEach(fn => fn(entry))
}

export const showToast = {
  info: (msg: string) => toast('info', msg),
  success: (msg: string) => toast('success', msg),
  error: (msg: string) => toast('error', msg),
}

const DISPLAY_MS = 4000

export default function ToastHost() {
  const [items, setItems] = useState<ToastEntry[]>([])

  useEffect(() => {
    const onToast = (t: ToastEntry) => {
      setItems(prev => [...prev, t])
      window.setTimeout(() => {
        setItems(prev => prev.filter(x => x.id !== t.id))
      }, DISPLAY_MS)
    }
    listeners.add(onToast)
    return () => { listeners.delete(onToast) }
  }, [])

  return (
    <div className="toast-host" role="status" aria-live="polite">
      {items.map(t => (
        <div key={t.id} className={`toast toast-${t.kind}`}>
          <span className="toast-message">{t.message}</span>
          <button
            className="toast-close"
            aria-label="Dismiss"
            onClick={() => setItems(prev => prev.filter(x => x.id !== t.id))}
          >×</button>
        </div>
      ))}
    </div>
  )
}
