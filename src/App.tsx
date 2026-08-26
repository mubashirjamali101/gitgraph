/**
 * Application root: window chrome, session restore, and the wiring between
 * repository events and the store.
 */
import { useCallback, useEffect, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { Settings } from 'lucide-react'
import { describeError } from './errors'

import { applyGeometry } from './constants'
import { ipc, type RepoChangedEvent } from './ipc'
import { activeTab, useStore } from './store'
import HomeScreen from './components/HomeScreen'
import RepoView from './components/RepoView'
import SettingsPanel from './components/SettingsPanel'
import Sidebar from './components/sidebar/Sidebar'
import { showToast } from './components/Toast'
import './App.css'

export default function App() {
  const tabs = useStore(state => state.tabs)
  const tab = useStore(activeTab)
  const settings = useStore(state => state.settings)
  const restoring = useStore(state => state.restoring)
  const restoreSession = useStore(state => state.restoreSession)
  const openPath = useStore(state => state.openPath)
  const reload = useStore(state => state.reload)
  const [settingsOpen, setSettingsOpen] = useState(false)

  useEffect(() => {
    void restoreSession()
  }, [restoreSession])

  // A folder on the command line opens after session restore, so a launch like
  // `GitGraph.app /path/to/repo` lands on that graph instead of the home screen.
  useEffect(() => {
    if (restoring) return
    void ipc
      .takeCliOpen()
      .then(path => {
        if (path) return openPath(path)
      })
      .catch(() => {})
  }, [openPath, restoring])

  // Theme, density and font size are applied to the root element, and the
  // geometry constants are published as CSS variables from the same place they
  // are defined in TypeScript.
  useEffect(() => {
    const root = document.documentElement
    root.dataset.density = settings.density
    root.style.fontSize = `${settings.fontSize}px`

    const ua = navigator.userAgent || ''
    const plat = navigator.platform || ''
    const isMac = ua.includes('Mac') || plat.includes('Mac')
    const isWin = ua.includes('Win') || plat.includes('Win')
    root.dataset.platform = isMac ? 'macos' : isWin ? 'windows' : 'linux'

    const applyTheme = () => {
      let activeTheme = settings.theme
      if (settings.theme === 'system') {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
        activeTheme = prefersDark ? 'github-dark' : 'light'
      }
      root.dataset.theme = activeTheme
    }

    applyTheme()
    applyGeometry(settings.density)

    if (settings.theme === 'system') {
      const media = window.matchMedia('(prefers-color-scheme: dark)')
      const listener = () => applyTheme()
      media.addEventListener('change', listener)
      return () => media.removeEventListener('change', listener)
    }
  }, [settings])

  // The backend watches each repository and tells us when it changes on disk,
  // so commits made in a terminal appear without a manual refresh.
  useEffect(() => {
    const unlisten = listen<RepoChangedEvent>('repo-changed', event => {
      const repoId = event.payload.repo_id
      if (useStore.getState().tabs.some(entry => entry.id === repoId)) {
        void useStore.getState().reload(repoId)
      }
    })
    return () => {
      void unlisten.then(stop => stop()).catch(() => {})
    }
  }, [])

  // Staging done outside the app changes only `.git/index`, which the watcher
  // deliberately ignores (see watch.rs). Picking it up when the window regains
  // focus covers that case without a reload loop.
  useEffect(() => {
    const onFocus = () => {
      const { activeId, refreshWorkingState } = useStore.getState()
      if (activeId) void refreshWorkingState(activeId)
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  const openRepository = useCallback(async () => {
    try {
      const path = await ipc.pickDirectory()
      if (!path) return
      await openPath(path)
    } catch (error) {
      showToast.error(describeError(error))
    }
  }, [openPath])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return
      const active = useStore.getState()
      switch (event.key.toLowerCase()) {
        case 'r':
          if (active.activeId) {
            event.preventDefault()
            void reload(active.activeId)
          }
          break
        case 'o':
          event.preventDefault()
          void openRepository()
          break
        case 'w': {
          const repo = active.tabs.find(entry => entry.id === active.activeId)
          if (repo?.activeEditor) {
            event.preventDefault()
            active.closeFileTab(repo.id, repo.activeEditor)
          } else if (active.activeId) {
            event.preventDefault()
            active.closeTab(active.activeId)
          }
          break
        }
        case ',':
          event.preventDefault()
          setSettingsOpen(true)
          break
        case '=':
        case '+':
          event.preventDefault()
          active.setSettings({ fontSize: Math.min(20, active.settings.fontSize + 1) })
          break
        case '-':
          event.preventDefault()
          active.setSettings({ fontSize: Math.max(10, active.settings.fontSize - 1) })
          break
        default:
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openRepository, reload])

  return (
    <div className="app">
      {/*
        `data-tauri-drag-region` gives the header the platform's own title-bar
        behaviour: drag to move, double-click to zoom or minimise according to
        the user's macOS setting. Interactive children simply omit the
        attribute, so they keep receiving clicks.
      */}
      <header className="app-header" data-tauri-drag-region>
        <span className="app-title" data-tauri-drag-region>
          {tab ? tab.name : 'GitGraph'}
        </span>
        <button
          type="button"
          className="app-settings"
          title="Settings (⌘,)"
          aria-label="Settings"
          onClick={() => setSettingsOpen(true)}
        >
          <Settings size={22} strokeWidth={1.75} />
        </button>
      </header>

      <div className="app-body">
        <Sidebar onOpen={() => void openRepository()} />

        <main className="app-main">
          {tabs.length === 0 ? (
            restoring ? (
              <div className="app-restoring">Restoring your session…</div>
            ) : (
              <HomeScreen onOpenRepo={() => void openRepository()} />
            )
          ) : tab ? (
            <RepoView key={tab.id} tab={tab} />
          ) : null}
        </main>
      </div>

      <SettingsPanel isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  )
}
