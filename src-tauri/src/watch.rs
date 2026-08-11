//! Repository change watching.
//!
//! Git operations run outside the app (a terminal commit, a checkout, a rebase)
//! should show up without the user pressing refresh. Watching `.git` catches
//! all of them: refs, HEAD and the index all live there.
//!
//! Events are debounced because a single git command touches many files —
//! forwarding each one would mean a graph reload per file.

use std::path::Path;
use std::sync::mpsc;
use std::time::{Duration, Instant};

use notify::{EventKind, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

/// Quiet period after the last filesystem event before reporting a change.
const DEBOUNCE: Duration = Duration::from_millis(250);

pub const REPO_CHANGED_EVENT: &str = "repo-changed";

#[derive(Clone, Serialize)]
pub struct RepoChanged {
    pub repo_id: String,
}

/// Watch `<repo>/.git` until the returned handle is dropped.
pub struct RepoWatcher {
    stop: mpsc::Sender<()>,
}

impl RepoWatcher {
    pub fn start(app: AppHandle, repo_id: String, repo_path: &Path) -> Option<Self> {
        let git_dir = resolve_git_dir(repo_path)?;
        let (stop_tx, stop_rx) = mpsc::channel::<()>();
        let (event_tx, event_rx) = mpsc::channel::<()>();

        let mut watcher = notify::recommended_watcher(move |result: notify::Result<notify::Event>| {
            let Ok(event) = result else { return };
            if matches!(event.kind, EventKind::Access(_)) {
                return;
            }
            // Ignore paths that churn without meaning a change we should react
            // to. `index` matters most: git rewrites it whenever a command
            // refreshes cached stat information, including the read-only ones
            // this app runs on every reload — watching it makes the app reload
            // because it just finished reloading. External staging is picked up
            // when the window regains focus instead.
            if event.paths.iter().any(|path| {
                let name = path.file_name().unwrap_or_default().to_string_lossy();
                name == "index"
                    || name.starts_with("index.")
                    || path.extension().is_some_and(|ext| ext == "lock")
                    || path.components().any(|c| c.as_os_str() == "objects")
            }) {
                return;
            }
            let _ = event_tx.send(());
        })
        .ok()?;

        watcher.watch(&git_dir, RecursiveMode::Recursive).ok()?;

        std::thread::spawn(move || {
            // Keep the watcher alive for the lifetime of this thread.
            let _watcher = watcher;
            let mut pending: Option<Instant> = None;
            loop {
                if stop_rx.try_recv().is_ok() {
                    return;
                }
                match event_rx.recv_timeout(DEBOUNCE) {
                    Ok(()) => pending = Some(Instant::now()),
                    Err(mpsc::RecvTimeoutError::Timeout) => {
                        if pending.take().is_some() {
                            let _ = app.emit(
                                REPO_CHANGED_EVENT,
                                RepoChanged { repo_id: repo_id.clone() },
                            );
                        }
                    }
                    Err(mpsc::RecvTimeoutError::Disconnected) => return,
                }
            }
        });

        Some(Self { stop: stop_tx })
    }
}

impl Drop for RepoWatcher {
    fn drop(&mut self) {
        let _ = self.stop.send(());
    }
}

/// Resolve the real git directory, following the `gitdir:` pointer that linked
/// worktrees and submodules use instead of a `.git` directory.
fn resolve_git_dir(repo_path: &Path) -> Option<std::path::PathBuf> {
    let candidate = repo_path.join(".git");
    if candidate.is_dir() {
        return Some(candidate);
    }
    if candidate.is_file() {
        let contents = std::fs::read_to_string(&candidate).ok()?;
        let target = contents.strip_prefix("gitdir:")?.trim();
        let path = Path::new(target);
        return Some(if path.is_absolute() { path.to_path_buf() } else { repo_path.join(path) });
    }
    // A bare repository is its own git dir.
    repo_path.is_dir().then(|| repo_path.to_path_buf())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::TestRepo;

    #[test]
    fn resolves_a_normal_git_directory() {
        let repo = TestRepo::new();
        let resolved = resolve_git_dir(&repo.dir).expect("git dir");
        assert!(resolved.ends_with(".git"));
        assert!(resolved.is_dir());
    }

    #[test]
    fn follows_the_gitdir_pointer_of_a_linked_worktree() {
        let repo = TestRepo::new();
        repo.write("a.txt", "a\n");
        repo.commit_all("base");
        let linked = repo.dir.join("linked");
        repo.git(&["worktree", "add", "-q", linked.to_str().unwrap(), "-b", "wt"]);

        let resolved = resolve_git_dir(&linked).expect("worktree git dir");
        assert!(resolved.is_dir(), "expected a real directory, got {resolved:?}");
    }
}
