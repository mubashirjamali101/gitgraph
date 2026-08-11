import '@testing-library/jest-dom'

function createMemoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    clear() {
      map.clear()
    },
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null
    },
    key(index: number) {
      return Array.from(map.keys())[index] ?? null
    },
    removeItem(key: string) {
      map.delete(key)
    },
    setItem(key: string, value: string) {
      map.set(String(key), String(value))
    },
  }
}

Object.defineProperty(window, 'localStorage', {
  configurable: true,
  writable: true,
  value: createMemoryStorage(),
})
Object.defineProperty(window, 'sessionStorage', {
  configurable: true,
  writable: true,
  value: createMemoryStorage(),
})
// Also bind globals some codepaths use
// @ts-expect-error assign global
globalThis.localStorage = window.localStorage
// @ts-expect-error assign global
globalThis.sessionStorage = window.sessionStorage
