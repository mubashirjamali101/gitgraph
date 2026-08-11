import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'

import { highlightLine, languageFor } from '../highlightCache'

const render = (language: string, content: string) =>
  renderToStaticMarkup(createElement('span', null, ...highlightLine(language, content)))

describe('languageFor', () => {
  it('maps extensions and well-known filenames', () => {
    expect(languageFor('src/main.tsx')).toBe('typescript')
    expect(languageFor('Cargo.toml')).toBe('ini')
    expect(languageFor('Dockerfile')).toBe('dockerfile')
    expect(languageFor('.gitignore')).toBe('bash')
    expect(languageFor('notes')).toBe('plaintext')
    expect(languageFor('weird.zzz')).toBe('plaintext')
  })
})

describe('highlightLine', () => {
  it('keeps the source text intact', () => {
    const markup = render('typescript', 'const answer = 42')
    expect(markup).toContain('const')
    expect(markup).toContain('42')
  })

  it('renders file content as text, never as markup', () => {
    // A repository can contain anything; none of it may become DOM.
    const markup = render('plaintext', '<img src=x onerror="alert(1)">')
    // The tag is inert text: no element is created and the quotes that would
    // delimit an attribute are escaped.
    expect(markup).not.toContain('<img')
    expect(markup).toContain('&lt;img')
    expect(markup).toContain('onerror=&quot;alert(1)&quot;')
  })

  it('round-trips escaped characters', () => {
    const nodes = highlightLine('plaintext', `a && b < c > d "e" 'f'`)
    const text = renderToStaticMarkup(createElement('span', null, ...nodes))
    expect(text).toContain('&amp;&amp;')
    expect(text).toContain('&lt; c &gt;')
  })

  it('returns nothing for an empty line', () => {
    expect(highlightLine('typescript', '')).toEqual([])
  })

  it('serves repeated lines from cache', () => {
    const first = highlightLine('typescript', 'const shared = true')
    const second = highlightLine('typescript', 'const shared = true')
    expect(second).toBe(first)
  })

  it('falls back to plain text for an unknown language', () => {
    expect(render('not-a-language', 'plain text')).toContain('plain text')
  })
})
