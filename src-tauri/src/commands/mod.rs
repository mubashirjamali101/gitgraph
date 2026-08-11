//! Tauri command surface.
//!
//! Commands stay thin: validate input, hand off to a module that knows the git
//! work, return a serializable result. libgit2 calls are CPU-bound and not
//! async, so they run on the blocking pool rather than stalling the async
//! runtime that also serves the UI.

pub mod graph;
pub mod ops;
pub mod refs;
pub mod refs_list;
pub mod remote;
pub mod repo;
pub mod stash;
pub mod worktree;

use std::sync::Arc;

use git2::Repository;

use crate::repo::{RepoHandle, Registry};

/// Run a libgit2 operation for `repo_id` on the blocking pool.
pub async fn with_repo<T, F>(
    registry: &Arc<Registry>,
    repo_id: &str,
    work: F,
) -> Result<T, String>
where
    F: FnOnce(&Repository) -> Result<T, String> + Send + 'static,
    T: Send + 'static,
{
    let handle = registry.get(repo_id)?;
    tokio::task::spawn_blocking(move || handle.with_repo(work))
        .await
        .map_err(|e| format!("Task failed: {e}"))?
}

/// Resolve a repo handle, or fail with a message the UI can show.
pub fn handle(registry: &Arc<Registry>, repo_id: &str) -> Result<Arc<RepoHandle>, String> {
    registry.get(repo_id)
}
