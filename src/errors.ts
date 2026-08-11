/**
 * Turning backend failures into sentences.
 *
 * git and libgit2 phrase errors for people who already know what went wrong.
 * The app surfaced them verbatim, so a toast could read "cannot lock ref
 * 'refs/heads/main': Unable to create '.git/refs/heads/main.lock': File
 * exists." — accurate, and no help at all about what to do.
 *
 * Anything not recognised is passed through: a message we do not understand is
 * still better than a generic one that hides it.
 */

interface Rule {
  match: RegExp
  message: (groups: string[]) => string
}

const RULES: Rule[] = [
  {
    match: /would be overwritten by (checkout|merge)/i,
    message: () =>
      'You have local changes to files this would overwrite. Commit or stash them first.',
  },
  {
    match: /unable to create '.*\.lock': File exists/i,
    message: () =>
      'Another git process is using this repository. Wait for it to finish, or remove the stale lock file.',
  },
  {
    match: /not something we can merge|merge: (.+) - not something we can merge/i,
    message: () => 'That ref no longer exists. Fetch and try again.',
  },
  {
    match: /refusing to merge unrelated histories/i,
    message: () => 'These branches share no history, so git will not merge them.',
  },
  {
    match: /you have unmerged files|fix conflicts and run/i,
    message: () => 'Resolve the conflicted files first, then continue.',
  },
  {
    match: /the branch '(.+)' is not fully merged/i,
    message: ([name]) =>
      `${name} has commits that are not merged anywhere else. Delete it with force if you are sure.`,
  },
  {
    match: /couldn't find remote ref|does not appear to be a git repository/i,
    message: () => 'The remote does not have that branch, or it cannot be reached.',
  },
  {
    // No helper answered. GitGraph reads the same config as your shell, so
    // this means git has nothing configured for this host at all.
    match: /could not read Username|terminal prompts disabled/i,
    message: () =>
      'No credential helper is set up for this remote. Configure one with git (for example `gh auth login`, or `git config --global credential.helper osxkeychain`), then try again.',
  },
  {
    match: /authentication failed|invalid username or password|401/i,
    message: () =>
      'The remote rejected your credentials — they are probably expired. Refresh them with git, then try again.',
  },
  {
    match: /permission denied \(publickey\)|host key verification failed/i,
    message: () =>
      'The remote refused your SSH key. Check that the key is loaded (`ssh-add -l`) and authorised for this host.',
  },
  {
    // GitHub says this both when a repository is missing and when the account
    // you authenticated as cannot see it, which is worth spelling out.
    match: /repository not found|403 forbidden/i,
    message: () =>
      'The remote rejected the request: either the repository no longer exists, or the account you are authenticated as cannot access it.',
  },
  {
    match: /stale info|non-fast-forward|fetch first/i,
    message: () =>
      'The remote has moved on since you last fetched. Fetch, then push again.',
  },
  {
    match: /nothing to commit|no changes added to commit/i,
    message: () => 'Nothing is staged, so there is nothing to commit.',
  },
  {
    match: /pathspec '(.+)' did not match/i,
    message: ([name]) => `${name} does not exist in this repository.`,
  },
  {
    match: /timed out after (\d+)s/i,
    message: ([seconds]) =>
      `git did not finish within ${seconds} seconds. It may be waiting on the network or a lock.`,
  },
  {
    match: /Repository is not open|Repository is no longer accessible/i,
    message: () => 'This repository is no longer available — it may have been moved or deleted.',
  },
]

/** A sentence for the user, given whatever the backend threw. */
export function describeError(error: unknown): string {
  const raw = String(
    error instanceof Error ? error.message : typeof error === 'string' ? error : error,
  ).trim()
  if (!raw) return 'Something went wrong.'

  for (const rule of RULES) {
    const found = raw.match(rule.match)
    if (found) return rule.message(found.slice(1))
  }

  // Unrecognised: show git's own words, tidied up.
  const firstLine = raw.split('\n').find(line => line.trim() !== '') ?? raw
  const trimmed = firstLine.replace(/^(error|fatal):\s*/i, '').trim()
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1)
}
