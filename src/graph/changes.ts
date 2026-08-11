/**
 * How a changed file is labelled, in one place.
 *
 * The letter and the colour are shown by the file tree, the sidebar's change
 * list and anything else listing files. They were written out twice, in two
 * different CSS vocabularies (`change-added` against `status-added`), so a new
 * change type meant finding both.
 */
import type { ChangeType } from '../types'

/** Single-letter status, as `git status --short` writes it. */
export const CHANGE_LETTER: Record<ChangeType, string> = {
  Added: 'A',
  Modified: 'M',
  Deleted: 'D',
  Renamed: 'R',
  Copied: 'C',
  Typechange: 'T',
}

/** Class carrying the change's colour; styled once, in `theme/global.css`. */
export function changeClass(change: ChangeType): string {
  return `change-${change.toLowerCase()}`
}
