# Contributing to GitGraph

## Setup

```bash
# pnpm 9+ (corepack enable, or `npm i -g pnpm`)
pnpm install --frozen-lockfile

# Tauri dev server with hot reload
pnpm dev
```

See [docs/BUILD.md](docs/BUILD.md) for build / packaging instructions.

## Required gates before opening a PR

All three must be green locally. CI runs the same on every push.

```bash
pnpm typecheck                                # tsc --noEmit
pnpm test                                     # vitest run
cd src-tauri && cargo test --no-fail-fast
cd src-tauri && cargo clippy --no-deps --all-targets -- -D warnings
```

## House rules

- **Don't hardcode colors.** Use the CSS custom properties in
  [`src/theme/tokens.css`](src/theme/tokens.css). Four themes share the
  codebase; a hardcoded `#7ab8f5` will look wrong in Dracula or Light.
  Add a new semantic token if you need a new color category.
- **Don't add `window.dispatchEvent` back‑channels.** The typed event bus
  on the zustand store (`emit({ type: '…' })` / `lastEvent`) replaces them.
- **Don't reach into `localStorage` directly.** Everything goes through
  [`src/utils/storage.ts`](src/utils/storage.ts) (the path validator there
  is also the gate against bad data sneaking in).
- **Don't bypass `safe_cmd`.** Any new git subprocess call goes through
  `run_git_safe` / `run_git_safe_output` so hook suppression / env scrub /
  timeout / safe.directory all apply automatically. Direct
  `std::process::Command::new("git")` is a review failure.
- **Don't use the `--` pathspec separator before a ref.** `git checkout -- foo`
  means "restore the file `foo`", not "switch to branch `foo`". Use
  `git switch <ref>` or `git checkout <ref>` (no `--`). The ref‑name
  validator already blocks the `-flag` injection vector.
- **Keep files under ~300 lines.** `CommitList.tsx` is the closest to that
  budget — don't extend it; split new behaviour into its own file, the way
  `graph/columns.ts` and `hooks/useColumnResize.ts` came out of it.
- **Don't put CSS `transition` on `.commit-row`** or any virtualized row
  class. Hundreds of absolutely‑positioned rows with hover transitions
  tank scroll performance.

## Where to find architecture notes

[AGENTS.md](AGENTS.md) is the long‑form architecture / gotchas reference,
including:

- The three rules the design rests on, and the bug each one prevents
- Which module owns what, on both sides of the IPC boundary
- The conventions a change is expected to respect — what may not scroll, what
  may not clip, what may not become markup

## Branches / PRs

- Land changes against `main` unless coordinating with the maintainer.
- One feature or one bug per PR.
- What is planned versus deferred lives in the Roadmap section of
  [README.md](README.md).
- Run the gates above. Don't merge if anything is red.

## Reporting issues

Open an issue with:

- macOS / Windows / Linux version
- Output of `app_log_dir()/gitgraph.log` if the bug is a runtime error.
  On macOS that's `~/Library/Logs/com.gitgraph.desktop/gitgraph.log`.
- A minimal repro repo if possible.

## Code of conduct

Be respectful. Don't ship code you wouldn't want to maintain.
