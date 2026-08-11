//! In-progress operations (merge, rebase, cherry-pick, revert) and logging.

use std::sync::Arc;

use serde::Serialize;
use tauri::Manager;

use crate::repo::Registry;
use crate::safe_cmd::run_git;

#[derive(Serialize, Default)]
pub struct ConflictState {
    pub in_merge: bool,
    pub in_rebase: bool,
    pub in_cherry_pick: bool,
    pub in_revert: bool,
    pub conflicted_paths: Vec<String>,
}

impl ConflictState {
    fn active(&self) -> bool {
        self.in_merge || self.in_rebase || self.in_cherry_pick || self.in_revert
    }
}

/// Read from libgit2 and the git directory directly. This runs on every reload,
/// and it used to spawn two `git` processes to answer it.
async fn state_of(registry: &Arc<Registry>, repo_id: &str) -> Result<ConflictState, String> {
    let handle = super::handle(registry, repo_id)?;
    tokio::task::spawn_blocking(move || {
        handle.with_repo(|repo| {
            // `repo.path()` is the real git directory, which for a linked
            // worktree or a submodule is not `<repo>/.git`.
            let git_dir = repo.path().to_path_buf();

            let conflicted = repo
                .index()
                .ok()
                .and_then(|index| {
                    index.conflicts().ok().map(|conflicts| {
                        conflicts
                            .filter_map(Result::ok)
                            .filter_map(|conflict| {
                                conflict
                                    .our
                                    .or(conflict.their)
                                    .or(conflict.ancestor)
                                    .map(|entry| String::from_utf8_lossy(&entry.path).to_string())
                            })
                            .collect::<Vec<_>>()
                    })
                })
                .unwrap_or_default();

            Ok(ConflictState {
                in_merge: git_dir.join("MERGE_HEAD").exists(),
                in_rebase: git_dir.join("rebase-merge").exists()
                    || git_dir.join("rebase-apply").exists(),
                in_cherry_pick: git_dir.join("CHERRY_PICK_HEAD").exists(),
                in_revert: git_dir.join("REVERT_HEAD").exists(),
                conflicted_paths: conflicted,
            })
        })
    })
    .await
    .map_err(|e| format!("Task failed: {e}"))?
}

#[tauri::command]
pub async fn conflict_state(
    repo_id: String,
    registry: tauri::State<'_, Arc<Registry>>,
) -> Result<ConflictState, String> {
    state_of(registry.inner(), &repo_id).await
}

#[tauri::command]
pub async fn abort_in_progress(
    repo_id: String,
    registry: tauri::State<'_, Arc<Registry>>,
) -> Result<(), String> {
    let state = state_of(registry.inner(), &repo_id).await?;
    if !state.active() {
        return Err("Nothing in progress to abort".to_string());
    }
    let repo = super::handle(registry.inner(), &repo_id)?.path_str();
    // Rebase is checked first: a conflicted rebase also leaves MERGE_HEAD-like
    // state behind, and `merge --abort` would be the wrong recovery.
    if state.in_rebase {
        run_git(&repo, &["rebase", "--abort"]).await
    } else if state.in_cherry_pick {
        run_git(&repo, &["cherry-pick", "--abort"]).await
    } else if state.in_revert {
        run_git(&repo, &["revert", "--abort"]).await
    } else {
        run_git(&repo, &["merge", "--abort"]).await
    }
}

#[tauri::command]
pub async fn continue_in_progress(
    repo_id: String,
    registry: tauri::State<'_, Arc<Registry>>,
) -> Result<(), String> {
    let state = state_of(registry.inner(), &repo_id).await?;
    if !state.active() {
        return Err("Nothing in progress to continue".to_string());
    }
    if !state.conflicted_paths.is_empty() {
        return Err(format!(
            "Resolve {} conflicted file(s) first",
            state.conflicted_paths.len()
        ));
    }
    let repo = super::handle(registry.inner(), &repo_id)?.path_str();
    if state.in_rebase {
        run_git(&repo, &["rebase", "--continue"]).await
    } else if state.in_cherry_pick {
        run_git(&repo, &["cherry-pick", "--continue", "--no-edit"]).await
    } else if state.in_revert {
        run_git(&repo, &["revert", "--continue", "--no-edit"]).await
    } else {
        run_git(&repo, &["commit", "--no-edit"]).await
    }
}

/// Append a line to the app log. The frontend tees console errors here so a
/// crash report can include what led up to it.
#[tauri::command]
pub fn log_line(level: String, message: String, app: tauri::AppHandle) -> Result<(), String> {
    use std::io::Write;

    let dir = app.path().app_log_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let level = match level.as_str() {
        "error" | "warn" | "info" | "debug" => level,
        _ => "info".to_string(),
    };
    // Cap the entry so a runaway stack trace cannot fill the disk.
    let message: String = message.chars().take(4096).collect();
    let seconds = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join("gitgraph.log"))
        .map_err(|e| e.to_string())?;
    writeln!(file, "{seconds} {level} {}", message.replace('\n', "\\n")).map_err(|e| e.to_string())
}
