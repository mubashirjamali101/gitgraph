import { describe, expect, it } from 'vitest'

import { newlineOf, splitLines } from '../fileEdits'

describe('fileEdits', () => {
  it('splits a trailing newline off rather than inventing an extra line', () => {
    expect(splitLines('a\nb\n')).toEqual(['a', 'b'])
    expect(splitLines('a\nb')).toEqual(['a', 'b'])
    expect(splitLines('')).toEqual([''])
  })

  it('remembers CRLF so a Windows file is written back as one', () => {
    expect(newlineOf('a\r\nb\r\n')).toBe('\r\n')
    expect(newlineOf('a\nb\n')).toBe('\n')
  })
})
