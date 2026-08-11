import { invoke } from '@tauri-apps/api/core'

type Level = 'error' | 'warn' | 'info' | 'debug'

interface Entry {
  ts: number
  level: Level
  message: string
}

const RING_CAPACITY = 200
const ring: Entry[] = []

function push(level: Level, message: string) {
  ring.push({ ts: Date.now(), level, message })
  if (ring.length > RING_CAPACITY) ring.shift()
  // Best-effort persistence; ignore failures (e.g. in unit tests where Tauri isn't running).
  try {
    const result = invoke('log_line', { level, message }) as Promise<void> | undefined
    if (result && typeof result.catch === 'function') result.catch(() => {})
  } catch { /* ignore */ }
}

export const log = {
  error: (msg: string) => push('error', msg),
  warn: (msg: string) => push('warn', msg),
  info: (msg: string) => push('info', msg),
  debug: (msg: string) => push('debug', msg),
}

export function snapshotRing(): Entry[] {
  return ring.slice()
}

function formatArg(arg: unknown): string {
  if (arg instanceof Error) return `${arg.name}: ${arg.message}\n${arg.stack ?? ''}`
  if (typeof arg === 'string') return arg
  try {
    return JSON.stringify(arg)
  } catch {
    return String(arg)
  }
}

let installed = false

export function installConsoleTee() {
  if (installed) return
  installed = true
  const origError = console.error
  const origWarn = console.warn
  console.error = (...args: unknown[]) => {
    push('error', args.map(formatArg).join(' '))
    origError.apply(console, args)
  }
  console.warn = (...args: unknown[]) => {
    push('warn', args.map(formatArg).join(' '))
    origWarn.apply(console, args)
  }
  window.addEventListener('error', (e) => {
    push('error', `uncaught: ${e.message} @ ${e.filename}:${e.lineno}`)
  })
  window.addEventListener('unhandledrejection', (e) => {
    push('error', `unhandledrejection: ${formatArg(e.reason)}`)
  })
}
