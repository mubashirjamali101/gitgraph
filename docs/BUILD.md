# Building GitGraph

This document covers everything needed to produce a runnable binary on
**macOS**, **Windows**, and **Linux**, including the non‑obvious gotchas we hit.

## TL;DR

| Target | How |
|---|---|
| macOS, your local arch (arm64 *or* x64) | `pnpm tauri build` |
| macOS universal (arm64 + x64) | `pnpm tauri build --target universal-apple-darwin`, but **the active `rustc` must be rustup's, not Homebrew's** — see below |
| Windows / Linux from a macOS host | Not possible. Use [CI](#cicd-release-workflow). |
| All three OSes at once | Push a `v*` tag *or* run `gh workflow run "Release builds"` |

## Repo prerequisites (one‑time, all platforms)

- **Node 20+** and **pnpm 9+** (`corepack enable` works, or `npm i -g pnpm`)
- **Rust stable** via `rustup`
- **A C compiler / linker** — XCode CLT (macOS), MSVC Build Tools (Windows), `build-essential` (Linux)

> ⚠️ Do **not** use Homebrew's `rust` formula. It installs `rustc` and `cargo`
> under `/opt/homebrew/bin` and has its own private `rust-std` set, *separate*
> from the `rustup` toolchains. Trying to cross‑compile (`--target ...`)
> through Homebrew's `rustc` fails with `can't find crate for 'core'` even
> when `rustup target add` reports success — the toolchains never see each
> other. See [Universal macOS](#universal-macos-arm64--x64) for the fix.

### macOS extras

Tauri 2 needs nothing beyond Xcode CLT for the local arch. Universal builds
add an extra rustup target (next section).

### Linux extras

```bash
sudo apt-get install -y \
  libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev \
  patchelf build-essential curl wget file libxdo-dev libssl-dev \
  rpm                  # only if you want the .rpm bundle target
```

### Windows extras

Nothing beyond Rust + the standard MSVC Build Tools. `cargo` picks up
`link.exe`, `cl.exe` automatically.

## Frontend assets (`pnpm install`)

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test --run
```

If `pnpm install` ever fails on a clean tree, delete `node_modules` +
`pnpm-lock.yaml` and try again — pnpm's content‑addressable store is
generally robust but a corrupted lockfile after a yank does happen.

## Icons (one‑time)

The app uses a 512×512 PNG seed at `src-tauri/icons/icon.png`. Generate the
per‑platform variants (`.icns`, `.ico`, sized PNGs, Android assets) with:

```bash
pnpm tauri icon src-tauri/icons/icon.png
```

This populates `src-tauri/icons/` with everything `tauri.conf.json` references.
The Android assets are unused for now but are harmless.

To replace the icon: drop a new 512×512 PNG over `icon.png` (transparency OK)
and re‑run the same command.

## Release profile

`[profile.release]` in [`src-tauri/Cargo.toml`](../src-tauri/Cargo.toml):

```toml
strip = true          # no debug symbols in the shipped binary
opt-level = "z"       # optimize for size
lto = true            # cross-crate inlining, dead code dropped
codegen-units = 1     # one unit, so LTO sees the whole crate
```

**`opt-level = "z"` is a size choice, and it is worth revisiting.** It keeps
the binary small — the point of a 3 MB DMG — but it is the least aggressive
setting for the parts of this app that are actually hot: the revwalk, lane
assignment and diff collection. `opt-level = 3` trades a larger binary for
speed there.

Measure before changing it, with the harness the repo already has:

```bash
GITGRAPH_E2E_REPO=/path/to/a/big/repo cargo test --release perf -- --nocapture
```

Run it once as configured, once with `opt-level = 3`, and compare the walk and
diff timings against the size of `src-tauri/target/release/gitgraph`.

## Bundle configuration

Bundling is driven by [`src-tauri/tauri.conf.json`](../src-tauri/tauri.conf.json).
Active settings (alpha):

```jsonc
{
  "bundle": {
    "active": true,
    "targets": ["app", "dmg", "msi", "nsis", "deb", "appimage", "rpm"],
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ],
    "macOS": { "frameworks": [], "minimumSystemVersion": "10.13" },
    "windows": { "wix": { "language": "en-US" },
                 "nsis": { "installMode": "perMachine" } },
    "linux": { "appimage": { "bundleMediaFramework": true } }
  }
}
```

`titleBarStyle: "Overlay"` + `hiddenTitle: true` on the macOS window: the
traffic lights float over the title bar, which reserves the leftmost **78 px**
for them. Dragging uses Tauri's `data-tauri-drag-region` rather than
`-webkit-app-region: drag`, which swallows the double-click-to-zoom gesture
before the webview sees it.

> The bundle identifier is `com.gitgraph.desktop` — *not* `com.gitgraph.app`.
> Tauri warns if the identifier ends in `.app` because it collides with the
> macOS bundle extension. Don't change it back.

## macOS — local arch only (the path that works today)

```bash
pnpm tauri build
```

Times: ~50 s release compile + ~5 s DMG bundling on an M‑series Mac.

Artifacts:

```
src-tauri/target/release/bundle/dmg/GitGraph_0.1.0_<arch>.dmg     # ~3 MB
src-tauri/target/release/bundle/macos/GitGraph.app                # bundle
src-tauri/target/release/gitgraph                                 # raw exe ~4.3 MB
```

> **First‑launch Gatekeeper.** Unsigned builds are blocked by macOS on first
> launch. Right‑click the `.app` → Open → Open again at the warning. If still
> blocked: System Settings → Privacy & Security → "Open Anyway".

## Universal macOS (arm64 + x64)

This is what *should* work but doesn't out of the box on a stock Apple
Silicon machine with Homebrew Rust:

```bash
pnpm tauri build --target universal-apple-darwin
# ❌ error[E0463]: can't find crate for `core`
#    note: the `x86_64-apple-darwin` target may not be installed
```

The real cause: Homebrew's `rustc` and rustup's toolchains live in different
prefixes and don't share `rust-std`. The fix is to use rustup's toolchain:

```bash
# 1. Make sure rustup's stable is active
rustup default stable

# 2. Add both targets (idempotent)
rustup target add aarch64-apple-darwin
rustup target add x86_64-apple-darwin

# 3. Confirm `rustc` resolves to ~/.cargo/bin/rustc (not /opt/homebrew/bin)
which -a rustc | head -1

# 4. Now build
pnpm tauri build --target universal-apple-darwin
```

Artifact location for universal:

```
src-tauri/target/universal-apple-darwin/release/bundle/dmg/GitGraph_0.1.0_universal.dmg
src-tauri/target/universal-apple-darwin/release/bundle/macos/GitGraph.app
```

The CI workflow takes the rustup path explicitly, so it produces a true
universal binary regardless of whatever toolchain you happen to have locally.

## Linux — from a container

`webkit2gtk` and a Linux sysroot are not realistic to cross-compile against
from macOS, but a container is a Linux host:

```bash
git archive HEAD | tar -x -C /tmp/gg-linux
cp docker/linux-build.Dockerfile /tmp/gg-linux/Dockerfile
cd /tmp/gg-linux

docker build -t gitgraph-linux .                      # native arch
docker build --platform linux/amd64 -t gitgraph-linux-amd64 .

cid=$(docker create gitgraph-linux)
docker cp "$cid:/src/src-tauri/target/release/bundle/deb/." ./out
docker rm -v "$cid"
```

The source is **copied in, never mounted**: `pnpm install` inside the
container would otherwise replace the host's macOS `node_modules` with Linux
binaries and break local development.

On Apple Silicon the native build is arm64. `--platform linux/amd64` gives the
x86_64 packages most desktops need; it runs under emulation, so expect it to
take a few times longer.

## Windows — only from CI

An `.msi` is produced by the WiX toolset, which Tauri runs only on Windows;
cross-compiling from macOS also needs the MSVC linker and the Windows SDK.
Use the release workflow.

## CI/CD release workflow

[`.github/workflows/release.yml`](../.github/workflows/release.yml) builds
all three OSes in parallel. Trigger it one of two ways:

```bash
# Manual
gh workflow run "Release builds"

# Tag-based
git tag v0.1.0 && git push --tags
```

The matrix:

| Runner | Target | Artifact bundle | Files inside |
|---|---|---|---|
| `macos-latest` | `universal-apple-darwin` | `gitgraph-macos-universal` | `*.dmg`, `*.app` |
| `windows-latest` | native | `gitgraph-windows-x64` | `*.msi`, `*.exe` (NSIS) |
| `ubuntu-latest` | native | `gitgraph-linux-x64` | `*.deb`, `*.AppImage`, `*.rpm` |

Run‑time per OS:

- macOS universal: ~8–10 min (two arch compiles + DMG)
- Windows: ~6–8 min (release + MSI + NSIS)
- Linux: ~7–9 min (release + deb + AppImage + rpm; first run installs apt deps)

Artifacts are retained for the default GitHub period (~90 days) and
downloadable from the workflow run's **Artifacts** panel.

## CI sanity (`ci.yml`)

A separate workflow [`.github/workflows/ci.yml`](../.github/workflows/ci.yml)
runs on every push / PR:

- `pnpm typecheck`
- `pnpm test --run`
- `cargo clippy --no-deps -- -D warnings` on macOS / Windows / Linux
- `cargo test --no-fail-fast` on all three
- `pnpm tauri build --debug` smoke build on all three (artifact discarded)

Gating PRs on this catches Linux‑only / Windows‑only regressions before you
push a tag.

## Build flow internals

For curiosity, this is what `pnpm tauri build` actually does:

1. Runs `pnpm run build` (Vite production build, writes to `dist/`)
2. Runs `cargo build --release` on `src-tauri/` — the binary statically
   links libgit2 (via `git2 = { features = ["vendored-libgit2"] }`) so no
   system libgit2 is required at runtime.
3. Bundles per `targets`: for macOS it runs `src-tauri/target/release/bundle/dmg/bundle_dmg.sh`
   (a Tauri‑shipped script that drives `hdiutil` to produce the DMG with the
   icon and applications shortcut).

The Rust release profile is configured for size:

```toml
[profile.release]
strip = true
opt-level = "z"
lto = true
```

This trims the binary to **~4.3 MB** unpacked / **~3.0 MB** as a DMG.

## Debugging build failures

| Symptom | Likely cause | Fix |
|---|---|---|
| `can't find crate for 'core'` during `--target universal-apple-darwin` | Active `rustc` is Homebrew's | `rustup default stable` |
| `error: failed to run custom build command for libgit2-sys` | Missing build tools | Install Xcode CLT / MSVC Build Tools / `build-essential` |
| `bundle.identifier ends with .app` warning | Identifier was changed | It must stay `com.gitgraph.desktop`; Tauri rejects a `.app` suffix |
| Linux build fails on `webkit2gtk` | Missing apt deps | Run the `apt-get install` block from this doc |
| Windows MSI build hangs at "Building installer" | WiX trying to phone home | Tauri 2 ships WiX locally — make sure no AV is quarantining its toolchain |
| App launches but blank window on first run | `dist/` not built | Don't run `cargo run` directly — always go through `pnpm tauri build` / `pnpm dev` so Vite runs first |
