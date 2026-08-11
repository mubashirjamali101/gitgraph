/**
 * Shown when no repository is open: open one, scan a folder for several, or
 * pick up where you left off.
 */
import { useState } from 'react'
import { FolderGit2, FolderOpen, FolderSearch } from 'lucide-react'
import { describeError } from '../errors'

import { ipc } from '../ipc'
import { useStore } from '../store'
import { showToast } from './Toast'
import type { DiscoveredRepo } from '../types'
import './HomeScreen.css'

export default function HomeScreen({ onOpenRepo }: { onOpenRepo: () => void }) {
  const recent = useStore(state => state.recent)
  const openPath = useStore(state => state.openPath)
  const [found, setFound] = useState<DiscoveredRepo[] | null>(null)
  const [scanning, setScanning] = useState(false)

  const open = async (path: string) => {
    try {
      await openPath(path)
    } catch (error) {
      showToast.error(describeError(error))
    }
  }

  const scanFolder = async () => {
    try {
      const directory = await ipc.pickDirectory()
      if (!directory) return
      setScanning(true)
      const repos = await ipc.scanRepos(directory)
      setFound(repos)
      if (repos.length === 1) await open(repos[0].path)
    } catch (error) {
      showToast.error(describeError(error))
    } finally {
      setScanning(false)
    }
  }

  return (
    <div className="home">
      <div className="home-hero">
        <FolderGit2 size={40} strokeWidth={1.4} />
        <h1>Open a repository</h1>
        <p>Pick a repository, or scan a folder to find the ones inside it.</p>
      </div>

      <div className="home-actions">
        <button type="button" className="primary" onClick={onOpenRepo}>
          <FolderOpen size={17} />
          Open repository…
        </button>
        <button type="button" onClick={() => void scanFolder()} disabled={scanning}>
          <FolderSearch size={17} />
          {scanning ? 'Scanning…' : 'Scan folder…'}
        </button>
      </div>

      {found !== null && (
        <section className="home-section">
          <h2>Found {found.length} repositor{found.length === 1 ? 'y' : 'ies'}</h2>
          {found.length === 0 ? (
            <p className="home-empty">No git repositories in that folder.</p>
          ) : (
            <ul className="home-list">
              {found.map(repo => (
                <li key={repo.path}>
                  <button type="button" onClick={() => void open(repo.path)} title={repo.path}>
                    <span className="home-name">{repo.name}</span>
                    <span className="home-path">{repo.path}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {recent.length > 0 && (
        <section className="home-section">
          <h2>Recent</h2>
          <ul className="home-list">
            {recent.slice(0, 8).map(path => (
              <li key={path}>
                <button type="button" onClick={() => void open(path)} title={path}>
                  <span className="home-name">{path.split('/').pop()}</span>
                  <span className="home-path">{path}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
