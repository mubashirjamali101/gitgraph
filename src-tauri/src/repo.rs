//! Open-repository registry.
//!
//! A repository is opened once and kept alive for as long as its tab is open,
//! instead of being re-opened per command. Every handle also caches the graph
//! snapshot that paging reads from, and owns the filesystem watcher.
//!
//! libgit2 objects are not thread-safe, so a handle keeps a small pool of
//! `Repository` values rather than one behind a mutex: a 200ms diff would
//! otherwise hold the lock and stall that repository's graph reload behind it.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Condvar, Mutex};

use git2::Repository;

use crate::graph::snapshot::{GraphFilter, GraphSnapshot};
use crate::watch::RepoWatcher;

/// Concurrent libgit2 handles per repository. Enough for a diff, a walk and a
/// status to overlap; beyond that the disk is the limit anyway.
const MAX_HANDLES: usize = 4;

pub struct RepoHandle {
    pub id: String,
    pub path: PathBuf,
    /// Free list of open repositories, plus how many exist in total.
    idle: Mutex<Vec<Repository>>,
    available: Condvar,
    live: Mutex<usize>,
    snapshot: Mutex<Option<Arc<GraphSnapshot>>>,
    watcher: Mutex<Option<RepoWatcher>>,
}

impl RepoHandle {
    /// Take a repository from the pool, opening one if the pool is under its
    /// cap, and return it when the closure finishes.
    fn checkout_repo(&self) -> Result<Repository, String> {
        loop {
            if let Some(repo) = self.idle.lock().map_err(|_| "Pool poisoned")?.pop() {
                return Ok(repo);
            }
            {
                let mut live = self.live.lock().map_err(|_| "Pool poisoned")?;
                if *live < MAX_HANDLES {
                    *live += 1;
                    drop(live);
                    return Repository::open(&self.path).map_err(|e| e.to_string());
                }
            }
            // At the cap: wait for one to come back.
            let idle = self.idle.lock().map_err(|_| "Pool poisoned")?;
            let _unused = self
                .available
                .wait(idle)
                .map_err(|_| "Pool poisoned".to_string())?;
        }
    }

    fn return_repo(&self, repo: Repository) {
        if let Ok(mut idle) = self.idle.lock() {
            idle.push(repo);
        }
        self.available.notify_one();
    }

    /// Run a closure with a repository from the pool. Callers are expected to
    /// be on a blocking thread already.
    pub fn with_repo<T>(&self, f: impl FnOnce(&Repository) -> Result<T, String>) -> Result<T, String> {
        if !self.path.exists() {
            return Err(format!("Repository is no longer accessible: {}", self.path.display()));
        }
        let repo = self.checkout_repo()?;
        let result = f(&repo);
        self.return_repo(repo);
        result
    }

    /// Same, for the few libgit2 calls that need `&mut Repository`.
    pub fn with_repo_mut<T>(
        &self,
        f: impl FnOnce(&mut Repository) -> Result<T, String>,
    ) -> Result<T, String> {
        if !self.path.exists() {
            return Err(format!("Repository is no longer accessible: {}", self.path.display()));
        }
        let mut repo = self.checkout_repo()?;
        let result = f(&mut repo);
        self.return_repo(repo);
        result
    }

    pub fn path_str(&self) -> String {
        self.path.to_string_lossy().to_string()
    }

    /// Cached commit snapshot for `filter`.
    ///
    /// `refresh` re-walks the repository; loading the first page always
    /// refreshes, so a reload after an external change cannot serve stale
    /// history, while scrolling through later pages stays free. A snapshot
    /// walked under a different filter is not an answer to this question, so
    /// changing the branch filter re-walks whether or not a refresh was asked
    /// for.
    pub fn snapshot(
        &self,
        filter: &GraphFilter,
        refresh: bool,
    ) -> Result<Arc<GraphSnapshot>, String> {
        if !refresh {
            let cached = self.snapshot.lock().map_err(|_| "Snapshot lock poisoned")?.clone();
            if let Some(existing) = cached.filter(|entry| entry.filter() == filter) {
                return Ok(existing);
            }
        }
        let built = Arc::new(self.with_repo(|repo| GraphSnapshot::build(repo, filter.clone()))?);
        *self.snapshot.lock().map_err(|_| "Snapshot lock poisoned")? = Some(built.clone());
        Ok(built)
    }

    /// Grow the cached snapshot until it holds at least `wanted` rows.
    pub fn extend_snapshot(
        &self,
        filter: &GraphFilter,
        wanted: usize,
    ) -> Result<Arc<GraphSnapshot>, String> {
        let current = self.snapshot(filter, false)?;
        if current.is_complete() || current.rows.len() >= wanted {
            return Ok(current);
        }
        let grown = Arc::new(self.with_repo(|repo| current.extended(repo, wanted))?);
        *self.snapshot.lock().map_err(|_| "Snapshot lock poisoned")? = Some(grown.clone());
        Ok(grown)
    }

    pub fn set_watcher(&self, watcher: Option<RepoWatcher>) {
        if let Ok(mut slot) = self.watcher.lock() {
            *slot = watcher;
        }
    }

    pub fn is_watched(&self) -> bool {
        self.watcher.lock().map(|w| w.is_some()).unwrap_or(false)
    }
}

#[derive(Default)]
pub struct Registry {
    repos: Mutex<HashMap<String, Arc<RepoHandle>>>,
}

fn normalize_path(path: PathBuf) -> PathBuf {
    #[cfg(windows)]
    {
        let s = path.to_string_lossy();
        if s.starts_with(r"\\?\") {
            return PathBuf::from(&s[4..]);
        }
    }
    path
}

impl Registry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Open `path`, reusing the existing handle when the same repository is
    /// already open, so a repo opened twice does not get two caches.
    pub fn open(&self, path: &str) -> Result<Arc<RepoHandle>, String> {
        let canonical = normalize_path(
            std::fs::canonicalize(path).map_err(|e| format!("Cannot access path '{path}': {e}"))?,
        );

        // `discover` walks up to the enclosing repository, so picking a
        // subdirectory in the folder dialog opens the repo it belongs to
        // instead of reporting "not a repository".
        let repo = Repository::discover(&canonical).map_err(|e| e.to_string())?;
        // Use the workdir when git resolved a subdirectory or a linked worktree.
        let root = normalize_path(
            repo.workdir()
                .map(Path::to_path_buf)
                .unwrap_or_else(|| canonical.clone()),
        );

        let mut repos = self.repos.lock().map_err(|_| "Registry lock poisoned")?;
        if let Some(existing) = repos.values().find(|h| h.path == root) {
            return Ok(existing.clone());
        }

        let handle = Arc::new(RepoHandle {
            id: uuid::Uuid::new_v4().to_string(),
            path: root,
            idle: Mutex::new(vec![repo]),
            available: Condvar::new(),
            live: Mutex::new(1),
            snapshot: Mutex::new(None),
            watcher: Mutex::new(None),
        });
        repos.insert(handle.id.clone(), handle.clone());
        Ok(handle)
    }

    pub fn get(&self, repo_id: &str) -> Result<Arc<RepoHandle>, String> {
        self.repos
            .lock()
            .map_err(|_| "Registry lock poisoned".to_string())?
            .get(repo_id)
            .cloned()
            .ok_or_else(|| "Repository is not open".to_string())
    }

    pub fn close(&self, repo_id: &str) {
        if let Ok(mut repos) = self.repos.lock() {
            repos.remove(repo_id);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::TestRepo;

    #[test]
    fn several_operations_can_run_at_once() {
        // One slow read must not hold the repository against the others.
        let repo = TestRepo::new();
        repo.write("a.txt", "a\n");
        repo.commit_all("base");

        let registry = Registry::new();
        let handle = registry.open(&repo.path()).unwrap();

        std::thread::scope(|scope| {
            let handles: Vec<_> = (0..MAX_HANDLES * 2)
                .map(|_| {
                    let handle = handle.clone();
                    scope.spawn(move || {
                        handle
                            .with_repo(|repo| {
                                std::thread::sleep(std::time::Duration::from_millis(20));
                                repo.head().map(|h| h.target().is_some()).map_err(|e| e.to_string())
                            })
                            .unwrap()
                    })
                })
                .collect();
            for worker in handles {
                assert!(worker.join().unwrap());
            }
        });
    }

    #[test]
    fn the_pool_never_exceeds_its_cap() {
        let repo = TestRepo::new();
        repo.write("a.txt", "a\n");
        repo.commit_all("base");

        let registry = Registry::new();
        let handle = registry.open(&repo.path()).unwrap();
        for _ in 0..20 {
            handle.with_repo(|repo| repo.head().map(|_| ()).map_err(|e| e.to_string())).unwrap();
        }
        assert!(*handle.live.lock().unwrap() <= MAX_HANDLES);
    }

    #[test]
    fn normalize_path_strips_windows_unc_prefix() {
        let path = PathBuf::from(r"\\?\C:\Users\test\repo");
        let normalized = normalize_path(path);
        if cfg!(windows) {
            assert_eq!(normalized.to_string_lossy(), r"C:\Users\test\repo");
        }
    }
}
