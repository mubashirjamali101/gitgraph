//! Opening, scanning and describing repositories.

use std::sync::Arc;

use serde::Serialize;
use tauri::AppHandle;

use crate::repo::Registry;
use crate::scan::{self, DiscoveredRepo};
use crate::watch::RepoWatcher;

#[derive(Serialize)]
pub struct OpenedRepo {
    pub repo_id: String,
    pub path: String,
    pub name: String,
}

#[derive(Serialize)]
pub struct BranchTracking {
    pub ahead: i32,
    pub behind: i32,
}

#[derive(Serialize)]
pub struct RepoStatus {
    pub branch: String,
    pub detached: bool,
    pub tracking: Option<BranchTracking>,
}

#[tauri::command]
pub fn pick_directory() -> Result<Option<String>, String> {
    // A cancelled dialog is a normal outcome, not an error the UI must handle.
    Ok(rfd::FileDialog::new()
        .set_title("Open a git repository")
        .pick_folder()
        .map(|path| path.to_string_lossy().to_string()))
}

#[tauri::command]
pub async fn scan_repos(path: String) -> Result<Vec<DiscoveredRepo>, String> {
    tokio::task::spawn_blocking(move || scan::scan_for_repos(&path))
        .await
        .map_err(|e| format!("Task failed: {e}"))?
}

#[tauri::command]
pub async fn open_repo(
    app: AppHandle,
    path: String,
    registry: tauri::State<'_, Arc<Registry>>,
) -> Result<OpenedRepo, String> {
    let registry = registry.inner().clone();
    let handle = tokio::task::spawn_blocking(move || registry.open(&path))
        .await
        .map_err(|e| format!("Task failed: {e}"))??;

    // Watch on first open only; re-opening the same repo reuses the handle.
    if !handle.is_watched() {
        handle.set_watcher(RepoWatcher::start(app, handle.id.clone(), &handle.path));
    }

    Ok(OpenedRepo {
        repo_id: handle.id.clone(),
        path: handle.path_str(),
        name: handle
            .path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| handle.path_str()),
    })
}

#[tauri::command]
pub fn close_repo(repo_id: String, registry: tauri::State<'_, Arc<Registry>>) {
    registry.close(&repo_id);
}

#[tauri::command]
pub async fn repo_status(
    repo_id: String,
    registry: tauri::State<'_, Arc<Registry>>,
) -> Result<RepoStatus, String> {
    let registry = registry.inner().clone();
    super::with_repo(&registry, &repo_id, |repo| {
        let detached = repo.head_detached().unwrap_or(false);
        let head = repo.head().ok();
        let branch = match (&head, detached) {
            (Some(head), false) => head.shorthand().unwrap_or("HEAD").to_string(),
            (Some(head), true) => head
                .target()
                .map(|oid| oid.to_string()[..7].to_string())
                .unwrap_or_else(|| "HEAD".to_string()),
            // A repository with no commits yet still has a branch name.
            (None, _) => "main".to_string(),
        };

        let tracking = (!detached)
            .then(|| {
                let local = repo.find_branch(&branch, git2::BranchType::Local).ok()?;
                let upstream = local.upstream().ok()?;
                let local_oid = local.get().target()?;
                let upstream_oid = upstream.get().target()?;
                let (ahead, behind) = repo.graph_ahead_behind(local_oid, upstream_oid).ok()?;
                Some(BranchTracking { ahead: ahead as i32, behind: behind as i32 })
            })
            .flatten();

        Ok(RepoStatus { branch, detached, tracking })
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::TestRepo;

    #[test]
    fn opening_the_same_repo_twice_reuses_one_handle() {
        let repo = TestRepo::new();
        repo.write("a.txt", "a\n");
        repo.commit_all("base");

        let registry = Registry::new();
        let first = registry.open(&repo.path()).unwrap();
        let second = registry.open(&repo.path()).unwrap();
        assert_eq!(first.id, second.id, "a second open must not create a second cache");
    }

    #[test]
    fn opening_a_subdirectory_resolves_to_the_worktree_root() {
        let repo = TestRepo::new();
        repo.write("nested/file.txt", "x\n");
        repo.commit_all("base");

        let registry = Registry::new();
        let handle = registry.open(&format!("{}/nested", repo.path())).unwrap();
        assert!(handle.path.ends_with(repo.dir.file_name().unwrap()));
    }

    #[test]
    fn a_non_repository_is_rejected() {
        let dir = std::env::temp_dir().join(format!("gitgraph_plain_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let registry = Registry::new();
        assert!(registry.open(dir.to_str().unwrap()).is_err());
        let _ = std::fs::remove_dir_all(dir);
    }
}
