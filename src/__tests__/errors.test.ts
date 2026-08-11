import { describe, expect, it } from 'vitest'

import { describeError } from '../errors'

describe('describeError', () => {
  it('explains what to do about a blocked checkout', () => {
    const message = describeError(
      "error: Your local changes to the following files would be overwritten by checkout:\n\tsrc/main.rs",
    )
    expect(message).toContain('Commit or stash')
  })

  it('explains a stale index lock', () => {
    const message = describeError(
      "cannot lock ref 'refs/heads/main': Unable to create '.git/refs/heads/main.lock': File exists.",
    )
    expect(message).toContain('Another git process')
  })

  it('says why a push was rejected', () => {
    expect(describeError('! [rejected] main -> main (non-fast-forward)')).toContain('Fetch')
  })

  it('never offers to collect credentials itself', () => {
    for (const failure of [
      'fatal: Authentication failed for https://example.com/repo.git',
      "fatal: could not read Username for 'https://github.com': terminal prompts disabled",
      'git@github.com: Permission denied (publickey).',
    ]) {
      expect(describeError(failure)).not.toMatch(/enter|type|provide/i)
    }
  })

  /*
   * These three used to share one message, which sent everyone to "set up
   * credentials on the command line" — including the case where the app had
   * simply hidden the credential helper from git (see safe_cmd.rs).
   */
  it('tells apart no helper, bad credentials and a rejected key', () => {
    expect(
      describeError("fatal: could not read Username for 'https://github.com': terminal prompts disabled"),
    ).toMatch(/no credential helper/i)

    expect(describeError('fatal: Authentication failed for https://example.com/x.git')).toMatch(
      /expired/i,
    )

    expect(describeError('git@github.com: Permission denied (publickey).')).toMatch(/ssh key/i)
  })

  it('says that a missing repository may just be the wrong account', () => {
    expect(describeError('remote: Repository not found.')).toMatch(/cannot access it/i)
  })

  it('passes through anything it does not recognise, tidied', () => {
    expect(describeError('fatal: some brand new git message')).toBe('Some brand new git message')
  })

  it('handles Error objects and empty input', () => {
    expect(describeError(new Error('nothing to commit, working tree clean'))).toContain(
      'nothing to commit',
    )
    expect(describeError('')).toBe('Something went wrong.')
  })

  it('keeps the useful line out of a multi-line failure', () => {
    const message = describeError('\n\nfatal: pathspec \'docs/gone.md\' did not match any files')
    expect(message).toBe('docs/gone.md does not exist in this repository.')
  })
})
