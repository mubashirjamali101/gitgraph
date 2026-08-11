/**
 * The date column is a fixed width, so the format has to stay inside it.
 */
import { describe, expect, it } from 'vitest'

import { formatCommitDate } from '../dates'

const AUGUST_2026 = 1_786_567_500 // 2026-08-11, mid-evening UTC

describe('commit dates', () => {
  it('joins date and time without the locale\'s spelled-out connector', () => {
    const formatted = formatCommitDate(AUGUST_2026)
    // "Aug 11, 2026 at 06:45 PM" overflowed the column on first run.
    expect(formatted).not.toMatch(/\bat\b/)
    expect(formatted).toMatch(/2026/)
    expect(formatted).toMatch(/\d{1,2}:\d{2}/)
  })

  it('stays short enough for the column it lives in', () => {
    // 24 characters is roughly where the default 170px column truncates at
    // 12px; the joined form lands well inside it.
    expect(formatCommitDate(AUGUST_2026).length).toBeLessThanOrEqual(22)
  })

  it('returns the same string for the same instant', () => {
    expect(formatCommitDate(AUGUST_2026)).toBe(formatCommitDate(AUGUST_2026))
  })
})
