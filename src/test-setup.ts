import '@testing-library/jest-dom'

/**
 * Node 22+ installs a global `localStorage` stub that is not a real Storage
 * (no `clear` / `getItem`). jsdom then reuses that stub instead of providing
 * its own, which breaks any test that resets persisted state. Replace it when
 * the environment is incomplete.
 */
function ensureStorage(name: 'localStorage' | 'sessionStorage'): void {
  const current = (globalThis as Record<string, unknown>)[name] as Storage | undefined
  if (current && typeof current.clear === 'function' && typeof current.getItem === 'function') {
    return
  }
  const map = new Map<string, string>()
  const storage: Storage = {
    get length() {
      return map.size
    },
    clear() {
      map.clear()
    },
    getItem(key) {
      return map.has(key) ? map.get(key)! : null
    },
    key(index) {
      return [...map.keys()][index] ?? null
    },
    removeItem(key) {
      map.delete(key)
    },
    setItem(key, value) {
      map.set(String(key), String(value))
    },
  }
  Object.defineProperty(globalThis, name, {
    value: storage,
    configurable: true,
    writable: true,
  })
  if (typeof window !== 'undefined') {
    Object.defineProperty(window, name, {
      value: storage,
      configurable: true,
      writable: true,
    })
  }
}

ensureStorage('localStorage')
ensureStorage('sessionStorage')
