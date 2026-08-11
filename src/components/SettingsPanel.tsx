import { useEffect, useRef } from 'react'

import { useStore } from '../store'
import { THEMES } from '../persist'
import './SettingsPanel.css'

/** Every binding the app answers to, in the order you meet them. */
const SHORTCUTS: [keys: string[], what: string][] = [
  [['j', 'k'], 'Move between commits'],
  [['⏎'], 'Expand the selected commit'],
  [['/'], 'Search'],
  [['n', 'N'], 'Next / previous match'],
  [['⌘P'], 'Go to a branch or tag'],
  [['⌘F'], 'Focus the search box'],
  [['⌘R'], 'Reload history'],
  [['⌘O'], 'Open a repository'],
  [['⌘W'], 'Close the repository'],
  [['⌘⏎'], 'Commit staged changes'],
  [['⌘,'], 'Settings'],
]

export default function SettingsPanel({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const settings = useStore(state => state.settings)
  const setSettings = useStore(state => state.setSettings)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!isOpen) return
    closeRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div
      className="settings-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
      onClick={onClose}
    >
      <div className="settings-card" onClick={event => event.stopPropagation()}>
        <header className="settings-header">
          <h2 id="settings-title">Settings</h2>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        {/*
          The site is plain text, not a link: opening a URL needs the opener
          plugin and a matching capability, and a link that silently does
          nothing is worse than one you can read and copy.
        */}
        <section className="about">
          <p className="about-credit">
            Built by <strong>Mubashir Jamali</strong>
          </p>
          <p className="about-site">mubashirjamali.com</p>
          <p className="about-meta">
            GitGraph {__APP_VERSION__} · MIT licensed
          </p>
        </section>

        <section>
          <span className="settings-label">Theme</span>
          <div className="theme-grid">
            {THEMES.map(theme => (
              <button
                key={theme.id}
                type="button"
                className={`theme-option theme-${theme.id}${settings.theme === theme.id ? ' is-active' : ''}`}
                aria-pressed={settings.theme === theme.id}
                onClick={() => setSettings({ theme: theme.id })}
              >
                <span className="theme-preview" aria-hidden="true">
                  <span className="swatch bg" />
                  <span className="swatch accent" />
                  <span className="swatch add" />
                </span>
                {theme.label}
              </button>
            ))}
          </div>
        </section>

        <section>
          <span className="settings-label">Density</span>
          <div className="segmented">
            <button
              type="button"
              className={settings.density === 'compact' ? 'is-active' : ''}
              onClick={() => setSettings({ density: 'compact' })}
            >
              Compact
            </button>
            <button
              type="button"
              className={settings.density === 'comfortable' ? 'is-active' : ''}
              onClick={() => setSettings({ density: 'comfortable' })}
            >
              Comfortable
            </button>
          </div>
        </section>

        <section>
          <span className="settings-label">Diff layout</span>
          <div className="segmented">
            <button
              type="button"
              className={settings.diffMode === 'inline' ? 'is-active' : ''}
              onClick={() => setSettings({ diffMode: 'inline' })}
            >
              Inline
            </button>
            <button
              type="button"
              className={settings.diffMode === 'side-by-side' ? 'is-active' : ''}
              onClick={() => setSettings({ diffMode: 'side-by-side' })}
            >
              Side by side
            </button>
          </div>
        </section>

        <section>
          <div className="settings-row">
            <span className="settings-label">Font size</span>
            <span className="settings-value">{settings.fontSize}px</span>
          </div>
          <input
            type="range"
            min={10}
            max={20}
            step={1}
            value={settings.fontSize}
            onChange={event => setSettings({ fontSize: Number(event.target.value) })}
          />
        </section>

        <section>
          <span className="settings-label">Keyboard</span>
          <dl className="shortcut-list">
            {SHORTCUTS.map(([keys, what]) => (
              <div key={what} className="shortcut">
                <dt>
                  {keys.map(key => (
                    <kbd key={key}>{key}</kbd>
                  ))}
                </dt>
                <dd>{what}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </div>
  )
}
