/**
 * Syntax highlighting for diff lines.
 *
 * highlight.js emits an HTML string. That string is never injected: it is
 * scanned into React elements here, keeping only the `<span class>` wrappers
 * highlight.js produces and decoding everything else as text. Repository
 * content therefore cannot become markup — a file containing `<img onerror=…>`
 * is displayed, not executed.
 *
 * Results are cached because diffs repeat lines constantly: a context line
 * appears again in every hunk that touches it.
 */
import { createElement, type ReactNode } from 'react'
import hljs from 'highlight.js/lib/core'

// Only the grammars this app maps are registered. The full highlight.js build
// carries ~190 of them and would be most of the bundle for an application that
// parses its own source tree at startup.
import bash from 'highlight.js/lib/languages/bash'
import c from 'highlight.js/lib/languages/c'
import clojure from 'highlight.js/lib/languages/clojure'
import cpp from 'highlight.js/lib/languages/cpp'
import csharp from 'highlight.js/lib/languages/csharp'
import css from 'highlight.js/lib/languages/css'
import dockerfile from 'highlight.js/lib/languages/dockerfile'
import go from 'highlight.js/lib/languages/go'
import ini from 'highlight.js/lib/languages/ini'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import kotlin from 'highlight.js/lib/languages/kotlin'
import less from 'highlight.js/lib/languages/less'
import lua from 'highlight.js/lib/languages/lua'
import makefile from 'highlight.js/lib/languages/makefile'
import markdown from 'highlight.js/lib/languages/markdown'
import php from 'highlight.js/lib/languages/php'
import python from 'highlight.js/lib/languages/python'
import ruby from 'highlight.js/lib/languages/ruby'
import rust from 'highlight.js/lib/languages/rust'
import scala from 'highlight.js/lib/languages/scala'
import scss from 'highlight.js/lib/languages/scss'
import sql from 'highlight.js/lib/languages/sql'
import swift from 'highlight.js/lib/languages/swift'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'

for (const [name, language] of Object.entries({
  bash, c, clojure, cpp, csharp, css, dockerfile, go, ini, java, javascript, json, kotlin,
  less, lua, makefile, markdown, php, python, ruby, rust, scala, scss, sql, swift,
  typescript, xml, yaml,
})) {
  hljs.registerLanguage(name, language)
}

/** Files with no grammar are shown verbatim. */
const PLAIN = 'plaintext'

const MAX_CACHE = 3000
const cache = new Map<string, ReactNode[]>()

export const LANG_MAP: Record<string, string> = {
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  java: 'java',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  h: 'c',
  c: 'c',
  cs: 'csharp',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  php: 'php',
  html: 'xml',
  htm: 'xml',
  xml: 'xml',
  vue: 'xml',
  svelte: 'xml',
  css: 'css',
  scss: 'scss',
  less: 'less',
  json: 'json',
  jsonc: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  fish: 'bash',
  toml: 'ini',
  ini: 'ini',
  md: 'markdown',
  markdown: 'markdown',
  swift: 'swift',
  kt: 'kotlin',
  kts: 'kotlin',
  scala: 'scala',
  clj: 'clojure',
  lua: 'lua',
  sql: 'sql',
  dockerfile: 'dockerfile',
}

const NAMED_FILES: Record<string, string> = {
  dockerfile: 'dockerfile',
  makefile: 'makefile',
  '.gitignore': 'bash',
  '.env': 'bash',
}

export function languageFor(fileName: string): string {
  const base = fileName.split('/').pop()?.toLowerCase() ?? ''
  if (NAMED_FILES[base]) return NAMED_FILES[base]
  const ext = base.includes('.') ? base.split('.').pop()! : ''
  return LANG_MAP[ext] ?? PLAIN
}

/** The five entities highlight.js escapes. */
function decodeEntities(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|#x27|#39);/g, (_, entity: string) => {
    switch (entity) {
      case 'amp':
        return '&'
      case 'lt':
        return '<'
      case 'gt':
        return '>'
      case 'quot':
        return '"'
      default:
        return "'"
    }
  })
}

interface Frame {
  className?: string
  children: ReactNode[]
}

/**
 * Scan highlight.js output into React nodes.
 *
 * The grammar is tiny and fully known: `<span class="…">`, `</span>`, and
 * escaped text. Anything else is treated as text.
 */
function parseHighlighted(html: string): ReactNode[] {
  const stack: Frame[] = [{ children: [] }]
  let key = 0
  let cursor = 0

  const pushText = (text: string) => {
    if (text) stack[stack.length - 1].children.push(decodeEntities(text))
  }

  const closeFrame = () => {
    const frame = stack.pop()!
    stack[stack.length - 1].children.push(
      createElement('span', { key: key++, className: frame.className }, ...frame.children),
    )
  }

  for (const match of html.matchAll(/<span class="([a-zA-Z0-9 _-]*)">|<\/span>/g)) {
    pushText(html.slice(cursor, match.index))
    cursor = match.index + match[0].length

    if (match[0] === '</span>') {
      // Ignore an unbalanced close rather than unwinding past the root.
      if (stack.length > 1) closeFrame()
    } else {
      stack.push({ className: match[1], children: [] })
    }
  }
  pushText(html.slice(cursor))

  // Close anything left open (highlight.js does not, but be total).
  while (stack.length > 1) closeFrame()

  return stack[0].children
}

export function highlightLine(language: string, content: string): ReactNode[] {
  if (content === '') return []
  // No grammar: render the line as-is rather than paying for a failed lookup.
  if (language === PLAIN || !hljs.getLanguage(language)) return [content]

  const key = `${language} ${content}`
  const hit = cache.get(key)
  if (hit) {
    // Re-insert so recently used entries survive eviction.
    cache.delete(key)
    cache.set(key, hit)
    return hit
  }

  let nodes: ReactNode[]
  try {
    nodes = parseHighlighted(hljs.highlight(content, { language, ignoreIllegals: true }).value)
  } catch {
    // Unknown language, or a line that trips the grammar: plain text is fine.
    nodes = [content]
  }

  cache.set(key, nodes)
  if (cache.size > MAX_CACHE) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  return nodes
}
