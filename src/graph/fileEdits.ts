/** Preserve the file's newline when writing an edited buffer back to disk. */

export function newlineOf(text: string): '\r\n' | '\n' {
  return text.includes('\r\n') ? '\r\n' : '\n'
}

export function splitLines(text: string): string[] {
  if (text.length === 0) return ['']
  const parts = text.split(/\r?\n/)
  if (parts.length > 1 && parts[parts.length - 1] === '') parts.pop()
  return parts
}
