/**
 * The commit table: virtualized rows, the graph canvas beside them, search
 * navigation and keyboard control.
 *
 * The single rule this component enforces is that **everything positional comes
 * from one `RowLayout`** — rows, the detail panel, the canvas, scroll-into-view.
 * Nothing recomputes geometry on its own.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from 'react'

import {
  DEFAULT_COLUMN_WIDTH,
  DETAIL_HEIGHT,
  FOOTER_HEIGHT,
  OVERSCAN,
  PREFETCH_MARGIN,
  ROW_HEIGHT,
  type ColumnWidths,
} from '../../constants'
import { SIZED_COLUMNS, fitColumns, gridTemplate, type SizedColumn } from '../../graph/columns'
import { graphGeometry } from '../../graph/geometry'
import { RowLayout } from '../../graph/layout'
import { buildDisplayRows, findMatches, nextMatch } from '../../graph/rows'
import { useColumnResize } from '../../hooks/useColumnResize'
import { useElementHeight, useScrollTop } from '../../hooks/useScrollTop'
import { useStore, type Tab } from '../../store'
import { showToast } from '../Toast'
import type { GitRef, GraphRow } from '../../types'
import CommitDetails from './CommitDetails'
import CommitRow from './CommitRow'
import GraphCanvas from './GraphCanvas'
import GraphToolbar from './GraphToolbar'
import './CommitList.css'

interface CommitListProps {
  tab: Tab
  onRefMenu: (row: GraphRow, ref: GitRef, position: { x: number; y: number }) => void
  onRowMenu: (row: GraphRow, position: { x: number; y: number }) => void
  onCheckout: (ref: GitRef) => void
}

const COLUMNS = ['graph', 'message', 'author', 'date', 'sha'] as const
type ColumnKey = (typeof COLUMNS)[number]

const COLUMN_LABEL: Record<ColumnKey, string> = {
  graph: 'Graph',
  message: 'Commit',
  author: 'Author',
  date: 'Date',
  sha: 'SHA',
}

/**
 * `message` is the column that absorbs whatever the others leave, so it has no
 * width of its own to drag — its divider used to be a handle that did nothing
 * at all. Widen it by narrowing something else.
 */
const RESIZABLE = new Set<ColumnKey>(SIZED_COLUMNS)

export default function CommitList({ tab, onRefMenu, onRowMenu, onCheckout }: CommitListProps) {
  const settings = useStore(state => state.settings)
  const clearReveal = useStore(state => state.reveal)
  const storedColumns = useStore(state => state.columns)
  const setColumnWidths = useStore(state => state.setColumnWidths)
  const select = useStore(state => state.select)
  const toggleExpanded = useStore(state => state.toggleExpanded)
  const rememberScroll = useStore(state => state.rememberScroll)
  const loadMore = useStore(state => state.loadMore)

  const [scroller, setScroller] = useState<HTMLDivElement | null>(null)
  const scrollTop = useScrollTop(scroller)
  const viewportHeight = useElementHeight(scroller)
  const [viewportWidth, setViewportWidth] = useState(0)

  const searchRef = useRef<HTMLInputElement | null>(null)
  const restoredFor = useRef<string | null>(null)
  /** Last position seen while the scroller was live and attached. */
  const lastScrollTop = useRef(0)

  // Two sets of widths, deliberately.
  //
  // `chosen` is what the user asked for and what is stored. `columns` is that
  // fitted to the pane there is right now — the window resizes and the sidebar
  // is dragged, and the table has to keep adding up to the space available.
  //
  // Only `chosen` is ever written back. Persisting the fitted widths would let
  // a temporarily narrow pane shrink the columns for good: they would not grow
  // again when the room came back.
  const chosen: ColumnWidths = useMemo(
    () => ({ ...DEFAULT_COLUMN_WIDTH, ...storedColumns }) as ColumnWidths,
    [storedColumns],
  )
  const columns: ColumnWidths = useMemo(
    () => fitColumns(chosen, viewportWidth),
    [chosen, viewportWidth],
  )

  const rowHeight = ROW_HEIGHT[settings.density]
  const rows = useMemo(
    () => buildDisplayRows(tab.rows, tab.workingTree),
    [tab.rows, tab.workingTree],
  )

  const expandedIndex = useMemo(
    () => (tab.expandedSha ? rows.findIndex(row => row.sha === tab.expandedSha) : -1),
    [rows, tab.expandedSha],
  )

  const layout = useMemo(
    () =>
      new RowLayout({
        rowCount: rows.length,
        rowHeight,
        expandedIndex,
        detailHeight: DETAIL_HEIGHT,
        footerHeight: FOOTER_HEIGHT,
      }),
    [rows.length, rowHeight, expandedIndex],
  )

  const range = useMemo(
    () => layout.visibleRange(scrollTop, viewportHeight, OVERSCAN),
    [layout, scrollTop, viewportHeight],
  )

  const matches = useMemo(() => findMatches(rows, tab.search), [rows, tab.search])
  const matchSet = useMemo(() => new Set(matches), [matches])
  const selectedIndex = useMemo(
    () => (tab.selectedSha ? rows.findIndex(row => row.sha === tab.selectedSha) : -1),
    [rows, tab.selectedSha],
  )

  const { laneGap, laneWidth, badgeLimit } = useMemo(
    () => graphGeometry(columns.graph, tab.laneCount),
    [columns.graph, tab.laneCount],
  )

  const grid = useMemo(() => gridTemplate(columns, viewportWidth), [columns, viewportWidth])

  const startResize = useColumnResize({
    shown: columns,
    chosen,
    available: viewportWidth,
    onChange: setColumnWidths,
  })

  const scrollTo = useCallback(
    (offset: number) => {
      if (scroller) scroller.scrollTop = offset
    },
    [scroller],
  )

  const revealRow = useCallback(
    (index: number) => {
      if (!scroller) return
      const target = layout.scrollToReveal(index, scroller.scrollTop, scroller.clientHeight)
      if (target !== null) scroller.scrollTop = Math.max(0, target)
    },
    [layout, scroller],
  )

  // Restore the tab's scroll position when it is shown, once per tab. Waits
  // for rows, since there is nothing to scroll through before they arrive.
  useEffect(() => {
    if (!scroller || restoredFor.current === tab.id) return
    if (tab.rows.length === 0) return
    restoredFor.current = tab.id
    lastScrollTop.current = tab.scrollTop
    scroller.scrollTop = tab.scrollTop
  }, [scroller, tab.id, tab.rows.length, tab.scrollTop])

  // Remember it as the user scrolls.
  //
  // The position is read from the DOM rather than from the render-time value:
  // on mount that value is still 0 while the effect above has already restored
  // the real one, and writing it back overwrote the saved position with 0 —
  // which is why a tab came back at the top. Nothing is recorded until this
  // tab has been restored, so a switch cannot clobber the stored position.
  useEffect(() => {
    if (!scroller || restoredFor.current !== tab.id) return
    lastScrollTop.current = scroller.scrollTop
    rememberScroll(tab.id, scroller.scrollTop)
  }, [rememberScroll, scroller, tab.id, scrollTop])

  // Leaving the tab: record the last position seen while the element was still
  // attached. Reading the DOM here would report 0 — by the time an unmount
  // cleanup runs the scroller is detached, and a detached element has no scroll
  // position, which is precisely how the saved position got zeroed.
  useEffect(
    () => () => {
      if (restoredFor.current === tab.id) {
        rememberScroll(tab.id, lastScrollTop.current)
      }
    },
    [rememberScroll, tab.id],
  )

  useEffect(() => {
    if (!scroller) return
    const observer = new ResizeObserver(entries => {
      setViewportWidth(entries[0].contentRect.width)
    })
    observer.observe(scroller)
    setViewportWidth(scroller.clientWidth)
    return () => observer.disconnect()
  }, [scroller])

  // Pull the next page as the end of the loaded history approaches.
  useEffect(() => {
    if (tab.cursor === null || tab.loadingMore) return
    if (scrollTop + viewportHeight + PREFETCH_MARGIN < layout.totalHeight) return
    void loadMore(tab.id)
  }, [scrollTop, viewportHeight, layout.totalHeight, tab.cursor, tab.loadingMore, tab.id, loadMore])

  // Bring a commit into view when something outside the list asks for it:
  // the ref picker, or a file opened from the sidebar.
  useEffect(() => {
    const wanted = tab.revealSha
    if (!wanted) return
    const index = rows.findIndex(row => row.sha === wanted)
    if (index >= 0) {
      select(tab.id, rows[index].sha)
      revealRow(index)
    } else {
      showToast.info('That commit has not been loaded yet — scroll further back.')
    }
    clearReveal(tab.id, null)
  }, [tab.revealSha, rows, revealRow, select, tab.id, clearReveal])

  const jumpToMatch = useCallback(
    (direction: 1 | -1) => {
      const from = selectedIndex >= 0 ? selectedIndex : -1
      const target = nextMatch(matches, from, direction)
      if (target === null) return
      select(tab.id, rows[target].sha)
      revealRow(target)
    },
    [matches, revealRow, rows, select, selectedIndex, tab.id],
  )

  const moveSelection = useCallback(
    (delta: number) => {
      if (rows.length === 0) return
      const from = selectedIndex >= 0 ? selectedIndex : delta > 0 ? -1 : rows.length
      const target = Math.max(0, Math.min(rows.length - 1, from + delta))
      select(tab.id, rows[target].sha)
      revealRow(target)
    },
    [revealRow, rows, select, selectedIndex, tab.id],
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const typing =
        !!target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
        return
      }

      // While typing in the search field, only navigation keys are ours.
      if (typing) {
        if (event.key === 'Enter' && target === searchRef.current) {
          event.preventDefault()
          jumpToMatch(event.shiftKey ? -1 : 1)
        }
        if (event.key === 'Escape' && target === searchRef.current) {
          searchRef.current?.blur()
        }
        return
      }

      switch (event.key) {
        case 'j':
        case 'ArrowDown':
          event.preventDefault()
          moveSelection(1)
          break
        case 'k':
        case 'ArrowUp':
          event.preventDefault()
          moveSelection(-1)
          break
        case 'n':
          event.preventDefault()
          jumpToMatch(event.shiftKey ? -1 : 1)
          break
        case 'N':
          event.preventDefault()
          jumpToMatch(-1)
          break
        case 'Enter':
          if (tab.selectedSha) {
            event.preventDefault()
            toggleExpanded(tab.id, tab.selectedSha)
          }
          break
        case 'Escape':
          if (tab.expandedSha) toggleExpanded(tab.id, tab.expandedSha)
          break
        case '/':
          event.preventDefault()
          searchRef.current?.focus()
          break
        case 'Home':
          event.preventDefault()
          scrollTo(0)
          break
        case 'End':
          event.preventDefault()
          scrollTo(layout.totalHeight)
          break
        default:
          break
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [jumpToMatch, layout.totalHeight, moveSelection, scrollTo, tab.expandedSha, tab.id, tab.selectedSha, toggleExpanded])

  // Every handler passed to a row is stable. Inline arrows here would be new
  // props on each render, which defeats `memo` on CommitRow and re-renders the
  // whole window on every scroll event — the difference between updating a few
  // changed rows and rebuilding forty of them per frame.
  const handleSelect = useCallback(
    (row: GraphRow) => {
      select(tab.id, row.sha)
      toggleExpanded(tab.id, row.sha)
    },
    [select, tab.id, toggleExpanded],
  )

  const handleRowMenu = useCallback(
    (row: GraphRow, event: MouseEvent) => {
      event.preventDefault()
      onRowMenu(row, { x: event.clientX, y: event.clientY })
    },
    [onRowMenu],
  )

  const handleRefActivate = useCallback(
    (_row: GraphRow, ref: GitRef) => onCheckout(ref),
    [onCheckout],
  )

  const handleRefMenu = useCallback(
    (row: GraphRow, ref: GitRef, event: MouseEvent) => {
      event.preventDefault()
      event.stopPropagation()
      onRefMenu(row, ref, { x: event.clientX, y: event.clientY })
    },
    [onRefMenu],
  )

  const handleShowAllRefs = useCallback(
    (row: GraphRow, refs: GitRef[], event: MouseEvent) => {
      onRefMenu(row, refs[0], { x: event.clientX, y: event.clientY })
    },
    [onRefMenu],
  )

  const visible = []
  for (let index = range.start; index < range.end; index++) {
    const row = rows[index]
    if (!row) continue
    visible.push(
      <CommitRow
        key={row.sha}
        row={row}
        top={layout.top(index)}
        height={rowHeight}
        laneWidth={laneWidth}
        badgeLimit={badgeLimit}
        selected={tab.selectedSha === row.sha}
        expanded={tab.expandedSha === row.sha}
        matched={matchSet.has(index)}
        currentMatch={matchSet.has(index) && selectedIndex === index}
        onSelect={handleSelect}
        onContextMenu={handleRowMenu}
        onRefActivate={handleRefActivate}
        onRefContextMenu={handleRefMenu}
        onShowAllRefs={handleShowAllRefs}
      />,
    )
  }

  return (
    <div className="commit-list">
      <GraphToolbar
        tab={tab}
        searchRef={searchRef}
        matchCount={matches.length}
        onJump={jumpToMatch}
      />

      {/*
        Sized to the scroller's *content* width, not its own. The header sits
        outside the scroller, so it is a scrollbar wider than the rows are —
        and the flexible column then resolves to a different size in each,
        leaving every heading standing a scrollbar's width to the right of its
        own column.
      */}
      <div
        className="list-header"
        style={{ gridTemplateColumns: grid, width: viewportWidth || undefined }}
        role="row"
      >
        {COLUMNS.map(column => (
          <div key={column} className={`cell cell-${column}`} role="columnheader">
            {COLUMN_LABEL[column]}
            {RESIZABLE.has(column) && (
              <span
                // The last column's handle sits inside its own edge: at the
                // very end of the row there is no gutter to hang it over.
                className={`column-resize${column === 'sha' ? ' at-edge' : ''}`}
                onMouseDown={event => startResize(column as SizedColumn, event)}
                role="separator"
                aria-orientation="vertical"
                aria-label={`Resize ${COLUMN_LABEL[column]} column`}
              />
            )}
          </div>
        ))}
      </div>

      <div className="list-body">
        <div className="list-scroll" ref={setScroller} role="rowgroup">
          <div
            className="list-content"
            style={{ height: `${layout.totalHeight}px`, ['--grid' as string]: grid }}
          >
            {visible}

            {expandedIndex >= 0 && (
              <div
                className="detail-slot"
                style={{
                  top: `${layout.detailTop}px`,
                  height: `${DETAIL_HEIGHT}px`,
                  left: `${columns.graph}px`,
                }}
              >
                <CommitDetails tab={tab} row={rows[expandedIndex]} />
              </div>
            )}

            <div className="list-footer" style={{ top: `${layout.footerTop}px` }}>
              {tab.loadingMore
                ? 'Loading more history…'
                : tab.cursor !== null
                  ? `${tab.rows.length.toLocaleString()} commits loaded — scroll for more`
                  : tab.truncated
                    ? `History truncated at ${tab.total.toLocaleString()} commits`
                    : `End of history — ${tab.total.toLocaleString()} commit${tab.total === 1 ? '' : 's'}`}
            </div>
          </div>
        </div>

        {/* Painted beneath the rows, sized to the viewport rather than the list. */}
        <GraphCanvas
          rows={rows}
          layout={layout}
          scrollTop={scrollTop}
          width={Math.max(0, Math.min(columns.graph, viewportWidth))}
          height={viewportHeight}
          laneGap={laneGap}
          start={range.start}
          end={range.end}
        />
      </div>
    </div>
  )
}
