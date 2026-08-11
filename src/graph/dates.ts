/**
 * Commit date formatting.
 *
 * Formatting every loaded row on each change cost 177ms at 200,000 rows, and it
 * ran again on every page append and every working-tree refresh. Rows format
 * their own date instead, so the work is proportional to what is on screen; the
 * cache keeps a re-render from redoing it.
 */
/*
 * Date and time are formatted separately and joined with a space, rather than
 * asked for together. A single formatter spells the pair out in full — "Aug
 * 11, 2026 at 06:45 PM" in en-US — and those three characters were enough to
 * push the date past its column and have it truncated on first run. Each part
 * keeps the locale's own ordering and notation; only the connector is dropped.
 */
const dateFormatter = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
})

const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
})

const cache = new Map<number, string>()
const MAX_CACHE = 5000

export function formatCommitDate(unixSeconds: number): string {
  const hit = cache.get(unixSeconds)
  if (hit !== undefined) return hit

  const when = new Date(unixSeconds * 1000)
  const formatted = `${dateFormatter.format(when)} ${timeFormatter.format(when)}`
  cache.set(unixSeconds, formatted)
  if (cache.size > MAX_CACHE) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  return formatted
}
