/**
 * Everything shown for one open repository: the conflict banner, the commit
 * list, and the menus and dialogs those raise.
 *
 * The menus themselves are built in `menus.ts`. This component owns only the
 * three pieces of transient UI state they need — which menu is open, which
 * confirmation is pending, which prompt is showing.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'

import { actions, type Confirmation } from '../actions'
import { useStore, type Tab } from '../store'
import type { GitRef, GraphRow } from '../types'
import CommitList from './graph/CommitList'
import ConflictBanner from './ConflictBanner'
import ConfirmDialog from './ConfirmDialog'
import ContextMenu from './ContextMenu'
import PromptDialog, { type PromptRequest } from './PromptDialog'
import RefPicker from './RefPicker'
import { refMenuItems, rowMenuItems, type MenuHost, type MenuItem } from './menus'
import './RepoView.css'

interface MenuState {
  x: number
  y: number
  items: MenuItem[]
}

export default function RepoView({ tab }: { tab: Tab }) {
  const reload = useStore(state => state.reload)
  const reveal = useStore(state => state.reveal)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [confirm, setConfirm] = useState<Confirmation | null>(null)
  const [prompt, setPrompt] = useState<PromptRequest | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)

  // ⌘P anywhere in a repository opens the ref picker.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'p') {
        event.preventDefault()
        setPickerOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const host: MenuHost = useMemo(
    () => ({
      repoId: tab.id,
      currentBranch: tab.status?.branch ?? null,
      ask: confirmation => {
        if (confirmation) setConfirm(confirmation)
      },
      prompt: setPrompt,
    }),
    [tab.id, tab.status?.branch],
  )

  const refMenu = useCallback(
    (row: GraphRow, ref: GitRef, position: { x: number; y: number }) => {
      setMenu({ ...position, items: refMenuItems(host, row, ref) })
    },
    [host],
  )

  const rowMenu = useCallback(
    (row: GraphRow, position: { x: number; y: number }) => {
      const items = rowMenuItems(host, row)
      if (items.length > 0) setMenu({ ...position, items })
    },
    [host],
  )

  // Stable, so the memoized rows are not invalidated on every render.
  const checkout = useCallback(
    (ref: GitRef) => {
      if (ref.kind === 'Head') return
      void actions.checkout(tab.id, ref.name)
    },
    [tab.id],
  )

  const banner = useMemo(
    () => <ConflictBanner tab={tab} onResolved={() => void reload(tab.id)} />,
    [reload, tab],
  )

  if (tab.error && tab.rows.length === 0) {
    return (
      <div className="repo-error">
        <h2>Could not open this repository</h2>
        <p>{tab.error}</p>
        <button type="button" onClick={() => void reload(tab.id)}>
          Try again
        </button>
      </div>
    )
  }

  return (
    <div className="repo-view">
      {banner}
      {tab.loading && tab.rows.length === 0 ? (
        <div className="graph-skeleton" aria-label="Loading history">
          {Array.from({ length: 14 }, (_, index) => (
            <div key={index} className="skeleton-row" style={{ opacity: 1 - index * 0.06 }} />
          ))}
        </div>
      ) : (
        <CommitList tab={tab} onRefMenu={refMenu} onRowMenu={rowMenu} onCheckout={checkout} />
      )}

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />
      )}

      <ConfirmDialog
        isOpen={confirm !== null}
        title={confirm?.title ?? ''}
        message={confirm?.message ?? ''}
        confirmLabel={confirm?.confirmLabel}
        destructive={confirm?.destructive}
        typeToConfirm={confirm?.typeToConfirm}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const pending = confirm
          setConfirm(null)
          void pending?.run()
        }}
      />

      <PromptDialog request={prompt} onClose={() => setPrompt(null)} />

      <RefPicker
        repoId={tab.id}
        isOpen={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onReveal={sha => reveal(tab.id, sha)}
      />
    </div>
  )
}
