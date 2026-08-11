/**
 * File list for a commit or for the working tree, grouped into folders.
 *
 * Paths are folded so a chain of single-child directories renders as one row
 * (`src/components/graph`), which is what makes a deep tree readable in a short
 * panel.
 */
import { memo, useMemo, useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  File,
  FileCode,
  FileCog,
  FileJson,
  FileLock,
  FileText,
  Folder,
} from 'lucide-react'

import { CHANGE_LETTER, changeClass } from '../../graph/changes'
import type { FileChanged } from '../../types'
import './FileTree.css'

interface FileTreeProps {
  files: FileChanged[]
  selected: string | null
  onSelect: (path: string) => void
  /** Rendered at the right of each row; used for stage / unstage buttons. */
  renderActions?: (file: FileChanged) => React.ReactNode
}

interface TreeNode {
  name: string
  path: string
  children: Map<string, TreeNode>
  file: FileChanged | null
}

const ICON_COLOR: Record<string, string> = {
  ts: '#3178c6',
  tsx: '#3178c6',
  js: '#f7df1e',
  jsx: '#f7df1e',
  rs: '#dea584',
  py: '#3776ab',
  go: '#00add8',
  rb: '#cc342d',
  css: '#563d7c',
  scss: '#c6538c',
  html: '#e34c26',
  json: '#cbcb41',
  md: '#519aba',
  yml: '#cb171e',
  yaml: '#cb171e',
  toml: '#9c4221',
  lock: '#cb3837',
}

function FileIcon({ name }: { name: string }) {
  const lower = name.toLowerCase()
  const ext = lower.includes('.') ? lower.split('.').pop()! : ''
  const color = ICON_COLOR[ext] ?? 'var(--fg-tertiary)'
  const props = { size: 13, color, strokeWidth: 1.75 }

  if (lower.endsWith('.lock') || lower === 'pnpm-lock.yaml') return <FileLock {...props} />
  if (ext === 'json') return <FileJson {...props} />
  if (lower.startsWith('.git') || ext === 'toml' || ext === 'yml' || ext === 'yaml')
    return <FileCog {...props} />
  if (ext === 'md' || ext === 'txt') return <FileText {...props} />
  if (['ts', 'tsx', 'js', 'jsx', 'rs', 'py', 'go', 'rb', 'css', 'scss', 'html'].includes(ext))
    return <FileCode {...props} />
  return <File {...props} />
}

function buildTree(files: FileChanged[]): TreeNode {
  const root: TreeNode = { name: '', path: '', children: new Map(), file: null }
  for (const file of files) {
    const parts = file.path.split('/')
    let node = root
    parts.forEach((part, index) => {
      const path = parts.slice(0, index + 1).join('/')
      let child = node.children.get(part)
      if (!child) {
        child = { name: part, path, children: new Map(), file: null }
        node.children.set(part, child)
      }
      if (index === parts.length - 1) child.file = file
      node = child
    })
  }
  return root
}

/** Collapse `a` → `a/b` → `a/b/c` into a single `a/b/c` row. */
function fold(node: TreeNode): TreeNode {
  if (node.file === null && node.children.size === 1) {
    const [only] = [...node.children.values()]
    if (only.file === null) {
      return fold({ ...only, name: `${node.name}/${only.name}` })
    }
  }
  return {
    ...node,
    children: new Map([...node.children].map(([key, child]) => [key, fold(child)])),
  }
}

function Row({
  node,
  depth,
  selected,
  collapsed,
  onToggle,
  onSelect,
  renderActions,
}: {
  node: TreeNode
  depth: number
  selected: string | null
  collapsed: Set<string>
  onToggle: (path: string) => void
  onSelect: (path: string) => void
  renderActions?: (file: FileChanged) => React.ReactNode
}) {
  const isFolder = node.file === null
  const isCollapsed = collapsed.has(node.path)

  return (
    <>
      <div
        className={`tree-row${node.file && selected === node.path ? ' is-selected' : ''}`}
        style={{ paddingLeft: `${8 + depth * 12}px` }}
        onClick={() => (isFolder ? onToggle(node.path) : onSelect(node.path))}
        role="treeitem"
        aria-expanded={isFolder ? !isCollapsed : undefined}
      >
        {isFolder ? (
          <>
            {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
            <Folder size={13} color="var(--fg-tertiary)" strokeWidth={1.75} />
            <span className="tree-name">{node.name}</span>
          </>
        ) : (
          <>
            <FileIcon name={node.name} />
            <span className="tree-name">{node.name}</span>
            <span className={`tree-change ${changeClass(node.file!.change_type)}`}>
              {CHANGE_LETTER[node.file!.change_type]}
            </span>
            {node.file!.insertions > 0 && <span className="stat-add">+{node.file!.insertions}</span>}
            {node.file!.deletions > 0 && <span className="stat-remove">−{node.file!.deletions}</span>}
            {renderActions && <span className="tree-actions">{renderActions(node.file!)}</span>}
          </>
        )}
      </div>
      {isFolder &&
        !isCollapsed &&
        [...node.children.values()]
          .sort((a, b) => {
            const aFolder = a.file === null
            const bFolder = b.file === null
            if (aFolder !== bFolder) return aFolder ? -1 : 1
            return a.name.localeCompare(b.name)
          })
          .map(child => (
            <Row
              key={child.path}
              node={child}
              depth={depth + 1}
              selected={selected}
              collapsed={collapsed}
              onToggle={onToggle}
              onSelect={onSelect}
              renderActions={renderActions}
            />
          ))}
    </>
  )
}

function FileTree({ files, selected, onSelect, renderActions }: FileTreeProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const tree = useMemo(() => fold(buildTree(files)), [files])

  if (files.length === 0) {
    return <div className="tree-empty">No files changed</div>
  }

  const toggle = (path: string) => {
    setCollapsed(current => {
      const next = new Set(current)
      if (!next.delete(path)) next.add(path)
      return next
    })
  }

  return (
    <div className="file-tree" role="tree">
      {[...tree.children.values()]
        .sort((a, b) => {
          const aFolder = a.file === null
          const bFolder = b.file === null
          if (aFolder !== bFolder) return aFolder ? -1 : 1
          return a.name.localeCompare(b.name)
        })
        .map(child => (
          <Row
            key={child.path}
            node={child}
            depth={0}
            selected={selected}
            collapsed={collapsed}
            onToggle={toggle}
            onSelect={onSelect}
            renderActions={renderActions}
          />
        ))}
    </div>
  )
}

export default memo(FileTree)
