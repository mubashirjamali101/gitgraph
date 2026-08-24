/**
 * Full-pane view of one open file.
 *
 * History and staged files stay a hunk diff. An unstaged file is the live
 * working tree: original on the left (read-only), current on the right
 * (editable). Saving writes the buffer and does not reload the pane, so the
 * caret is not thrown away mid-keystroke.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type UIEvent } from 'react'

import { ipc } from '../../ipc'
import { useStore, type Tab } from '../../store'
import type { FileText } from '../../types'
import { highlightLine, languageFor } from '../../utils/highlightCache'
import DiffView from './DiffView'
import './DiffView.css'
import './FileDiffPage.css'

export default function FileDiffPage({ tab }: { tab: Tab }) {
  const diffMode = useStore(state => state.settings.diffMode)
  const setSettings = useStore(state => state.setSettings)
  const editor = tab.editorTabs.find(entry => entry.id === tab.activeEditor)
  const open = editor ? tab.files[editor.id] ?? tab.file : null

  if (!editor) {
    return <div className="file-diff-empty">No file selected</div>
  }

  const editable = editor.kind === 'worktree' && !editor.staged
  const binary = open?.diff?.binary === true

  return (
    <div className="file-diff-page">
      <header className="file-diff-header">
        <span className="file-diff-path" title={editor.path}>
          {editor.path}
        </span>
        <span className="file-diff-meta">
          {editor.kind === 'commit'
            ? editor.sha?.slice(0, 7)
            : editor.staged
              ? 'Staged'
              : 'Working tree'}
        </span>
        {!editable && (
          <div className="diff-mode">
            <button
              type="button"
              className={diffMode === 'inline' ? 'active' : ''}
              onClick={() => setSettings({ diffMode: 'inline' })}
            >
              Inline
            </button>
            <button
              type="button"
              className={diffMode === 'side-by-side' ? 'active' : ''}
              onClick={() => setSettings({ diffMode: 'side-by-side' })}
            >
              Split
            </button>
          </div>
        )}
      </header>

      <div className="file-diff-body">
        {editable && !binary ? (
          <WorktreeEditor repoId={tab.id} path={editor.path} />
        ) : open?.loading && !open.diff ? (
          <div className="diff-empty">Loading diff…</div>
        ) : open?.error && !open.diff ? (
          <div className="diff-empty">{open.error}</div>
        ) : open?.diff ? (
          <DiffView diff={open.diff} mode={diffMode} />
        ) : (
          <div className="diff-empty">No diff for this file</div>
        )}
      </div>
    </div>
  )
}

function HighlightedSource({ text, language }: { text: string; language: string }) {
  const lines = useMemo(() => text.split('\n'), [text])
  return (
    <>
      {lines.map((line, index) => (
        <div key={index} className="file-editor-line">
          {line === '' ? '\n' : highlightLine(language, line)}
        </div>
      ))}
    </>
  )
}

function WorktreeEditor({ repoId, path }: { repoId: string; path: string }) {
  const language = languageFor(path)
  const [sides, setSides] = useState<FileText | null>(null)
  const [current, setCurrent] = useState('')
  const [status, setStatus] = useState<'loading' | 'dirty' | 'saving' | 'saved' | 'error'>(
    'loading',
  )
  const [error, setError] = useState<string | null>(null)
  const dirty = useRef(false)
  const currentRef = useRef('')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const leftRef = useRef<HTMLTextAreaElement | null>(null)
  const rightRef = useRef<HTMLTextAreaElement | null>(null)
  const leftGutter = useRef<HTMLPreElement | null>(null)
  const rightGutter = useRef<HTMLPreElement | null>(null)
  const leftHighlight = useRef<HTMLPreElement | null>(null)
  const rightHighlight = useRef<HTMLPreElement | null>(null)

  useEffect(() => {
    let cancelled = false
    dirty.current = false
    setStatus('loading')
    setError(null)
    void ipc
      .worktreeFileText(repoId, path, false)
      .then(text => {
        if (cancelled) return
        setSides(text)
        setCurrent(text.current)
        currentRef.current = text.current
        setStatus('saved')
      })
      .catch(err => {
        if (cancelled) return
        setError(String(err))
        setStatus('error')
      })
    return () => {
      cancelled = true
      if (timer.current) clearTimeout(timer.current)
    }
  }, [repoId, path])

  const flush = useCallback(() => {
    if (!dirty.current) return
    const value = currentRef.current
    setStatus('saving')
    void ipc
      .writeWorktreeFile(repoId, path, value)
      .then(() => {
        if (currentRef.current !== value) return
        dirty.current = false
        setStatus('saved')
      })
      .catch(err => {
        setError(String(err))
        setStatus('error')
      })
  }, [path, repoId])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        if (timer.current) clearTimeout(timer.current)
        flush()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [flush])

  const syncLayer = (
    source: HTMLTextAreaElement,
    gutter: HTMLPreElement | null,
    highlight: HTMLPreElement | null,
  ) => {
    if (gutter) gutter.scrollTop = source.scrollTop
    if (highlight) {
      highlight.scrollTop = source.scrollTop
      highlight.scrollLeft = source.scrollLeft
    }
  }

  const syncScroll = (event: UIEvent<HTMLTextAreaElement>) => {
    const source = event.currentTarget
    const fromRight = source === rightRef.current
    syncLayer(
      source,
      fromRight ? rightGutter.current : leftGutter.current,
      fromRight ? rightHighlight.current : leftHighlight.current,
    )
    const other = fromRight ? leftRef.current : rightRef.current
    if (!other) return
    if (other.scrollTop !== source.scrollTop) other.scrollTop = source.scrollTop
    if (other.scrollLeft !== source.scrollLeft) other.scrollLeft = source.scrollLeft
    syncLayer(
      other,
      fromRight ? leftGutter.current : rightGutter.current,
      fromRight ? leftHighlight.current : rightHighlight.current,
    )
  }

  if (status === 'loading' && !sides) {
    return <div className="diff-empty">Loading file…</div>
  }
  if (error && !sides) {
    return <div className="diff-empty">{error}</div>
  }
  if (sides?.binary) {
    return <div className="diff-empty">Binary file — not editable</div>
  }

  const original = sides?.original ?? ''
  const leftLines = original.split('\n')
  const rightLines = current.split('\n')

  return (
    <div className="file-editor">
      <div className="file-editor-pane">
        <div className="file-editor-label">Original</div>
        <div className="file-editor-code">
          <pre className="file-editor-gutter" ref={leftGutter} aria-hidden>
            {leftLines.map((_, index) => `${index + 1}\n`).join('')}
          </pre>
          <div className="file-editor-stack">
            <pre className="file-editor-highlight is-original" ref={leftHighlight} aria-hidden>
              <HighlightedSource text={original} language={language} />
            </pre>
            <textarea
              ref={leftRef}
              className="file-editor-text is-original"
              readOnly
              wrap="off"
              spellCheck={false}
              value={original}
              aria-readonly="true"
              onScroll={syncScroll}
            />
          </div>
        </div>
      </div>
      <div className="file-editor-pane">
        <div className="file-editor-label">
          Current
          <span className={`file-editor-status${status === 'error' ? ' is-error' : ''}`}>
            {status === 'dirty' && 'Unsaved'}
            {status === 'saving' && 'Saving…'}
            {status === 'saved' && 'Saved'}
            {status === 'error' && (error ?? 'Save failed')}
          </span>
          <span className="file-editor-hint">⌘S to save</span>
        </div>
        <div className="file-editor-code">
          <pre className="file-editor-gutter" ref={rightGutter} aria-hidden>
            {rightLines.map((_, index) => `${index + 1}\n`).join('')}
          </pre>
          <div className="file-editor-stack">
            <pre className="file-editor-highlight" ref={rightHighlight} aria-hidden>
              <HighlightedSource text={current} language={language} />
            </pre>
            <textarea
              ref={rightRef}
              className="file-editor-text"
              wrap="off"
              spellCheck={false}
              value={current}
            onKeyDown={event => {
              if (event.key !== 'Tab' || event.metaKey || event.ctrlKey) return
              event.preventDefault()
              const box = event.currentTarget
              const start = box.selectionStart
              const end = box.selectionEnd
              const next = `${currentRef.current.slice(0, start)}\t${currentRef.current.slice(end)}`
              currentRef.current = next
              dirty.current = true
              setCurrent(next)
              setStatus('dirty')
              requestAnimationFrame(() => {
                box.selectionStart = box.selectionEnd = start + 1
              })
            }}
            onChange={event => {
              const value = event.target.value
              currentRef.current = value
              dirty.current = true
              setCurrent(value)
              setStatus('dirty')
              if (timer.current) clearTimeout(timer.current)
              timer.current = setTimeout(flush, 700)
            }}
            onBlur={flush}
            onScroll={syncScroll}
          />
          </div>
        </div>
      </div>
    </div>
  )
}
