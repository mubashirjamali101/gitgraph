/**
 * Browser-only dev mode: `pnpm dev:mock`.
 *
 * Runs the real frontend against `src/mock/core.ts` instead of the Tauri IPC
 * bridge, using a fixture generated from a real repository:
 *
 *   node scripts/gen-fixture.mjs /path/to/repo
 *   pnpm dev:mock
 *
 * Useful for UI work without a Rust build, and for driving large-repo
 * behaviour deterministically.
 */
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const mock = fileURLToPath(new URL('./src/mock/core.ts', import.meta.url))
const { version } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as { version: string }

export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  resolve: {
    alias: {
      '@tauri-apps/api/core': mock,
    },
  },
  server: {
    port: 5199,
    strictPort: true,
  },
})
