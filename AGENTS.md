# AGENTS.md

Guidance for working in this repository.

## Commands

```bash
pnpm dev                          # Tauri dev app (Rust + Vite)
pnpm dev:mock                     # UI only, in a browser, against a fixture
pnpm fixture /path/to/repo        # Generate that fixture (public/fixture.json)
pnpm typecheck                    # tsc --noEmit
pnpm test                         # vitest, once (test:watch to watch)
pnpm test src/graph               # a single directory or file
cd src-tauri && cargo test        # Rust suite
GITGRAPH_E2E_REPO=/path/to/repo cargo test --release perf -- --nocapture   # timings
cd src-tauri && cargo clippy --no-deps --all-targets -- -D warnings   # CI runs this
```

## Architecture

A Tauri 2 desktop git-graph viewer: React 19 + TypeScript frontend, Rust
backend. Three rules shape the design; each one exists because breaking it
produces a whole class of bug.

### 1. Rows are self-describing

`src-tauri/src/graph/lanes.rs` assigns lanes and emits, per row, the line
segments occupying the band between that row's centre and the next row's
centre (`{from, to, color}`). A renderer can therefore draw **any window of
rows** using only those rows — no repo-global parent index, no lookups outside
the window.

Lanes are freed when a chain ends and reused, so lane count tracks concurrent
branches (max 7 on a 6,783-commit repository with 713 merges) rather than
branches ever seen.

When changing the lane engine, keep the invariant asserted by
`segments_never_leave_a_gap_between_consecutive_rows`: every lane a row draws
into must be continued by the next row.

### 2. One layout model owns all geometry

`src/graph/layout.ts` (`RowLayout`) answers where every row, the expanded
detail panel and each graph dot sit. The row list, the canvas and
scroll-into-view all read from it.

The expanded panel is **a layout item**, not an offset applied afterwards. Do
not add a second place that computes positions — that is exactly how dots came
to be drawn 380px away from their rows.

Geometry constants live in `src/constants.ts` and are published to CSS as
custom properties by `applyGeometry()`. Do not hardcode a row or header height
in a stylesheet.

### 3. Scroll position is read, never mirrored

`src/hooks/useScrollTop.ts` subscribes to the scroll event and reads
`element.scrollTop` at render time via `useSyncExternalStore`. Do not copy
scroll position into React state or defer it to `requestAnimationFrame`: a
dropped or throttled frame then leaves the rendered window behind the viewport
and the list goes blank.

### Backend layout

- `repo.rs` — registry of open repositories; each handle owns a long-lived
  `git2::Repository` and caches the commit snapshot. libgit2 is not
  thread-safe, so access is serialized and runs on the blocking pool.
- `graph/snapshot.rs` — the walk is incremental: a first chunk is walked and
  served, and paging past it extends the walk, carrying `LaneState` across the
  join so lanes stay continuous. Loading page 1 always re-walks (a reload is a
  refresh). Ceiling: 250,000 commits.
- `graph/detail.rs` — the full message body and authorship, fetched when a
  commit is opened. The row carries only the summary: it is one string per
  commit for a list that can hold 250,000 of them.
- `repo.rs` — repositories keep a small pool of libgit2 handles. One mutex per
  repository meant a 200ms diff blocked that repository's graph reload.
- `diff.rs` — a `git2::Diff` walked once, hunks taken from libgit2's hunk
  callback. Never reconstruct hunk boundaries from line text: a source line
  starting with `@@` is content.
  **Diffs are fetched one file at a time.** Sending every file's hunks with a
  commit was 10 MB of JSON and 190ms for a 956-file commit, to show one file;
  `commit_file_diff` costs 0.08ms. Above `MAX_FILES_FOR_COUNTS` files, per-file
  line counts and rename detection are skipped — both force libgit2 to generate
  every patch, and rename detection compares every addition against every
  deletion.
- `worktree.rs` — staged (HEAD→index) and unstaged (index→workdir) are
  separate diffs and stay separate.
- `watch.rs` — debounced `.git` watcher emitting `repo-changed`.
- `safe_cmd.rs` — every `git` subprocess goes through here: hooks disabled,
  helper-program env vars stripped, prompting off, timeouts. Values are
  validated by `validate.rs` before reaching an argument list.
  **The repository is untrusted; the user is not.** `~/.gitconfig` and the
  system config are read normally — hiding them (`GIT_CONFIG_NOSYSTEM`,
  `GIT_CONFIG_GLOBAL=/dev/null`) protected nothing against a hostile
  repository, whose own config was still in effect, while breaking every
  credential helper and silently forging commit authorship.
- **libgit2 is built without transports.** Every network operation is a `git`
  subprocess (`commands/remote.rs`), so `git2` drops its default `https`/`ssh`
  features: no openssl-sys, no libssh2-sys. Re-enabling them costs a C library
  to keep patched and breaks cross-compilation, so if you need libgit2 to reach
  a remote, question that first.
- `commands/` — thin: validate, delegate, return.

### Frontend layout

- `src/ipc.ts` — the only module that calls `invoke`.
- `src/store.ts` — the only place state changes. No event bus, no prop-drilled
  setters. Scroll position is deliberately kept out of store state.
- `src/persist.ts` — the only module that touches localStorage (`gitgraph_v2`,
  with a one-time migration from the v1 keys). Holds open repositories, their
  view state and branch filter, recents, settings, column widths, sidebar width.
- `src/components/sidebar/` — the repository list, and the active repository's
  changes. Selecting here and selecting from the toolbar's Repo menu are the
  same action (`setActive`); there is no second notion of "current repo".
- `src/components/graph/GraphToolbar.tsx` — repo, branch filter, remotes
  toggle, search, fetch/pull/reload.
- `src/components/menus.ts` — context-menu contents as plain data, so the list
  stays a rendering component and the menus can be tested without a click.
- `src/hooks/useRepoAction.ts` — the shape every repository operation shares:
  busy state, refresh afterwards, and a readable error. Components should not
  write that loop again.
- `src/actions.ts` — repository operations. A destructive one returns a
  `Confirmation` for the caller to put a dialog in front of, so the decision to
  confirm lives with the action rather than with a menu.

## Conventions

- **Search highlights, it does not filter.** Removing rows from a graph leaves
  edges implying ancestry that does not exist.
- **The branch filter is part of the walk, not a view over it.** It seeds the
  revwalk in `graph/snapshot.rs`, so lanes and segments describe the filtered
  history. Filtering rows after the fact would reintroduce exactly the dangling
  edges the rule above is about. A snapshot therefore carries the filter it was
  walked under, and `RepoHandle::snapshot` re-walks when it differs.
- **Hiding remote branches hides their commits too.** A remote-only commit
  keeping a lane while its badge is gone is a line to nowhere.
- **No CSS transitions on `.commit-row`** or anything else virtualized.
- **The commit table never scrolls sideways.** The graph canvas is pinned
  beside it, so scrolling the columns would drag the lanes out of view. Column
  widths therefore have to add up to the pane: `graph/columns.ts` clamps them,
  and `message` absorbs the remainder. Stored widths are *intent* — they are
  fitted to the pane on render and never written back fitted, or a narrow
  window would shrink them for good.
- **Nothing that contains a popover may clip its overflow.** The graph toolbar
  is a 38px strip and both pickers hang below it; `overflow: hidden` there
  turned "open the menu" into a no-op that still passed every jsdom test,
  because a clipped element answers queries normally. Crowding is solved by
  what does not shrink and by the container queries in `GraphToolbar.css`.
  Anything that changes menu positioning has to be looked at in a browser.
- **Never inject HTML strings into the DOM.** highlight.js output is parsed
  into React elements in `utils/highlightCache.ts`; repository content must
  never become markup.
- **Anything the user can see is virtualized.** The commit list and the diff
  both render a window, both from `RowLayout`. A diff line is ~7 DOM nodes, so
  a 20,000-line file is 145,000 nodes if rendered whole.
- **Errors go through `describeError`** (`src/errors.ts`), which turns git's
  phrasing into a sentence that says what to do. Never surface a raw error.
- Components consume theme tokens (`var(--bg-primary)`, `var(--lane-3)`, …);
  no hardcoded colors. Lane colors come from `--lane-0…7` per theme.
- Dates are formatted once per row set, never inside the scroll path.
- Keep files small and single-purpose; extract when a component starts holding
  both state transitions and layout.

## Testing

Tests assert behaviour a user would notice, and are named for the claim they
make. Rust tests drive real git repositories (`testutil.rs`) rather than mocks,
because the behaviour under test *is* the interaction with git.

Useful entry points:

- `src-tauri/src/graph/lanes.rs` — lane assignment and segment continuity
- `src-tauri/src/graph/e2e_tests.rs` — invariants over a real repository
- `src/graph/__tests__/layout.test.ts` — geometry, including the expanded panel
- `src/graph/__tests__/rows.test.ts` — working-tree row, search, lane sizing

## Build & release

- Local macOS release: `pnpm tauri build --target universal-apple-darwin` →
  `src-tauri/target/universal-apple-darwin/release/bundle/{dmg,macos}/`.
  Requires both `aarch64-apple-darwin` and `x86_64-apple-darwin` rustup
  targets.
- **Cross-compilation is not possible locally.** Use
  `.github/workflows/release.yml` (macOS / Windows / Linux matrix), triggered
  by `gh workflow run "Release builds"` or a `v*` tag.
