# Changelog

All notable changes to GitGraph. Loosely follows [Keep a Changelog](https://keepachangelog.com/).

## [0.1.0] — unreleased

First release. A desktop git graph viewer: React 19 and TypeScript in front of
a Rust backend, in a Tauri 2 window.

### The graph

- Commit history drawn on a canvas beside a virtualized list, loaded in pages
  with no commit-count ceiling short of a 250,000-commit safety limit.
- Lanes are assigned in the backend, which emits per row the line segments
  between that row's centre and the next. Any window of rows can therefore be
  drawn from those rows alone, which is what keeps virtualized rendering
  correct. Lanes are freed and reused when a chain ends, so lane count tracks
  concurrent branches rather than branches ever seen.
- A **Branches** filter and a **Show Remote Branches** toggle. The selection
  seeds the revwalk, so filtering removes commits rather than leaving edges
  pointing at commits that are no longer drawn.
- Search highlights and jumps (`Enter`, `n`, `N`) instead of filtering, for the
  same reason.
- Branch, tag and HEAD chips in the VS Code Git Graph style.

### The window

- Repositories listed in a sidebar, each with its uncommitted changes, commit
  box and stashes; the graph follows the selection, or the toolbar's **Repo**
  menu.
- Per-repository scroll position, selection, expanded commit, search and branch
  filter, restored across switches and across restarts.
- Four themes (GitHub Dark, GitHub Light, Dracula, Night Owl), compact or
  comfortable density, and a font-size slider.

### Working with a repository

- Stage and unstage per file or all at once, commit, and amend.
- Right-click a ref to check out, merge, rebase, push, rename, delete, fetch or
  pull; right-click a commit to branch, tag, cherry-pick, revert, reset, or
  copy its SHA or message.
- Stash list with push, pop, apply and drop.
- A conflict banner for an interrupted merge, rebase, cherry-pick or revert,
  offering Continue or Abort.
- Force-push detection: a push that would discard commits on the remote is
  gated behind a typed confirmation and uses `--force-with-lease`.
- Inline and side-by-side diffs with syntax highlighting and real per-side line
  numbers.
- Auto-refresh: commits, checkouts and rebases made outside the app appear on
  their own, through a debounced `.git` watcher.

### Performance

- Diffs are fetched one file at a time: 0.08ms and about 1 KB for a file, where
  sending a whole 956-file commit costs 190ms and 10 MB of JSON.
- The diff view is virtualized like the commit list — 32 to 46 lines in the DOM
  whatever the file size.
- History is walked in chunks and extended as you page past it, rather than
  walking all of it before the first page can appear.
- Repositories keep a small pool of libgit2 handles, so a slow diff does not
  block that repository's graph reload.

### Safety

- Opening an unknown repository does not run its code: hooks are disabled,
  helper-program environment variables are stripped, git is never allowed to
  prompt, and every subprocess is bounded by a timeout. Ref names, paths and
  object ids are validated before they reach an argument list.
- libgit2 is built without its HTTPS and SSH transports — network operations
  run through your own `git`, so OpenSSL and libssh2 are not part of the app.
- Repository content never becomes markup: highlighter output is parsed into
  elements rather than injected as HTML.

See [SECURITY.md](SECURITY.md) for the threat model and the known gaps.
