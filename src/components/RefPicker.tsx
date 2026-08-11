/**
 * Ref picker (⌘P).
 *
 * The graph only shows a branch when its commit happens to be on screen, so
 * reaching one meant scrolling until it appeared. This lists every branch and
 * tag: Enter reveals the ref in the graph, ⌘Enter checks it out.
 */
import { useEffect, useMemo, useRef, useState } from 'react'

import { actions } from '../actions'
import { describeError } from '../errors'
import { ipc } from '../ipc'
import { showToast } from './Toast'
import type { RefEntry } from '../types'
import './RefPicker.css'

interface RefPickerProps {
  repoId: string
  isOpen: boolean
  onClose: () => void
  /** Bring a ref's commit into view. */
  onReveal: (sha: string) => void
}

/** Subsequence match, so "ofl" finds "origin/feature/login". */
function matches(name: string, query: string): boolean {
  if (query === '') return true
  let index = 0
  for (const character of name.toLowerCase()) {
    if (character === query[index]) index++
    if (index === query.length) return true
  }
  return false
}

export default function RefPicker({ repoId, isOpen, onClose, onReveal }: RefPickerProps) {
  const [refs, setRefs] = useState<RefEntry[]>([])
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  useEffect(() => {
    if (!isOpen) return
    setQuery('')
    setActive(0)
    ipc
      .listRefs(repoId)
      .then(setRefs)
      .catch(error => showToast.error(describeError(error)))
    const id = window.setTimeout(() => inputRef.current?.focus(), 0)
    return () => window.clearTimeout(id)
  }, [isOpen, repoId])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return refs.filter(ref => matches(ref.name, needle)).slice(0, 200)
  }, [refs, query])

  // Keep the highlighted row in view as the arrow keys move it.
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [active, filtered.length])

  if (!isOpen) return null

  const choose = (ref: RefEntry | undefined, checkout: boolean) => {
    if (!ref) return
    onClose()
    if (checkout) {
      void actions.checkout(repoId, ref.kind === 'remote' ? ref.name : ref.name)
    } else {
      onReveal(ref.sha)
    }
  }

  return (
    <div className="picker-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="picker" onClick={event => event.stopPropagation()}>
        <input
          ref={inputRef}
          className="picker-input"
          placeholder="Go to branch or tag…"
          value={query}
          onChange={event => {
            setQuery(event.target.value)
            setActive(0)
          }}
          onKeyDown={event => {
            switch (event.key) {
              case 'ArrowDown':
                event.preventDefault()
                setActive(index => Math.min(filtered.length - 1, index + 1))
                break
              case 'ArrowUp':
                event.preventDefault()
                setActive(index => Math.max(0, index - 1))
                break
              case 'Enter':
                event.preventDefault()
                choose(filtered[active], event.metaKey || event.ctrlKey)
                break
              case 'Escape':
                event.preventDefault()
                onClose()
                break
              default:
                break
            }
          }}
        />

        <ul className="picker-list" ref={listRef} role="listbox">
          {filtered.length === 0 ? (
            <li className="picker-empty">No branch or tag matches</li>
          ) : (
            filtered.map((ref, index) => (
              <li
                key={`${ref.kind}-${ref.name}`}
                role="option"
                aria-selected={index === active}
                data-active={index === active}
                className={`picker-item${index === active ? ' is-active' : ''}`}
                onMouseEnter={() => setActive(index)}
                onClick={event => choose(ref, event.metaKey || event.ctrlKey)}
              >
                <span className={`picker-kind kind-${ref.kind}`}>{ref.kind}</span>
                <span className="picker-name">{ref.name}</span>
                {ref.is_current && <span className="picker-current">current</span>}
                <code className="picker-sha">{ref.sha.slice(0, 7)}</code>
              </li>
            ))
          )}
        </ul>

        <footer className="picker-hint">
          <span>
            <kbd>↵</kbd> go to
          </span>
          <span>
            <kbd>⌘↵</kbd> check out
          </span>
          <span>
            <kbd>esc</kbd> close
          </span>
        </footer>
      </div>
    </div>
  )
}
