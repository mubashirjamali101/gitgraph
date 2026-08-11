# Security

## Reporting a vulnerability

Primary contact: **security@mubashirjamali.com**
Product contact: **gitgraph@mubashirjamali.com**


Email **security@mubashirjamali.com** (or <gitgraph@mubashirjamali.com>). Please do not open a public issue for
something exploitable — a private report gives everyone using the app time to
update. A reply should come within a week.

Useful things to include: what an attacker can do, the repository or input that
triggers it, and the version or commit you saw it on.

## What this app defends against

GitGraph opens repositories it did not create, so **a repository's contents and
its `.git/config` are untrusted input**. Every `git` subprocess goes through
`src-tauri/src/safe_cmd.rs`, which:

- disables hooks (`core.hooksPath` pointed at the null device),
- strips the environment variables git uses to launch helper programs
  (`GIT_SSH`, `GIT_SSH_COMMAND`, `GIT_ASKPASS`, `SSH_ASKPASS`,
  `GIT_EXTERNAL_DIFF`, `GIT_PAGER`, `GIT_EDITOR`, `GIT_PROXY_COMMAND`),
- refuses to prompt (`GIT_TERMINAL_PROMPT=0`) — nothing can block on a question
  no one can answer,
- sets `protocol.allow=user` and `safe.directory=*`,
- bounds every run: 30 s locally, 300 s for network verbs.

Ref names, paths, object ids and messages are validated in
`src-tauri/src/validate.rs` before reaching an argument list — no leading `-`,
no `..`, `@{`, `^`, `~`, `:`, `?`, `*`, and no control bytes.

Repository content never becomes markup: highlight.js output is parsed into
React elements in `src/utils/highlightCache.ts` rather than injected as HTML.

## What it does not defend against

- **Your own git configuration is trusted.** `~/.gitconfig` and the system
  config are read as any other git client reads them; that is where credential
  helpers and your commit identity live.
- **A repository's own `.git/config` can still set `credential.helper`**, and
  git will run it. Clearing that is not expressible through `git -c` — a reset
  drops the user's helpers too, and URL-scoped keys cannot be enumerated in
  advance. Treat cloning an untrusted repository and opening it here with the
  same caution as running `git fetch` in it from a shell.
- Vulnerabilities in git, libgit2, Tauri or the system WebView. (libgit2 is
  built without its HTTPS and SSH transports, so OpenSSL and libssh2 are not
  part of this app — network operations run through your own `git`.) Report those
  upstream; tell us too, so the dependency can be pinned or bumped.
