//! Working-tree inspection and the staging / commit flow.

use std::sync::Arc;

use crate::safe_cmd::{run_git, run_git_output};
use crate::repo::Registry;
use crate::validate;
use crate::diff::FileDiff;
use crate::worktree::{self, WorkingTree};

const MAX_COMMIT_MESSAGE: usize = 8192;

#[tauri::command]
pub async fn working_tree(
    repo_id: String,
    registry: tauri::State<'_, Arc<Registry>>,
) -> Result<WorkingTree, String> {
    let registry = registry.inner().clone();
    super::with_repo(&registry, &repo_id, worktree::load).await
}

/// One working-tree file's diff, from the staged or unstaged side.
#[tauri::command]
pub async fn worktree_file_diff(
    repo_id: String,
    path: String,
    staged: bool,
    registry: tauri::State<'_, Arc<Registry>>,
) -> Result<Option<FileDiff>, String> {
    validate::repo_path(&path)?;
    let registry = registry.inner().clone();
    super::with_repo(&registry, &repo_id, move |repo| worktree::file_diff(repo, &path, staged)).await
}

#[tauri::command]
pub async fn stage_file(
    repo_id: String,
    path: String,
    registry: tauri::State<'_, Arc<Registry>>,
) -> Result<(), String> {
    validate::repo_path(&path)?;
    let repo = super::handle(registry.inner(), &repo_id)?.path_str();
    run_git(&repo, &["add", "--", &path]).await
}

#[tauri::command]
pub async fn unstage_file(
    repo_id: String,
    path: String,
    registry: tauri::State<'_, Arc<Registry>>,
) -> Result<(), String> {
    validate::repo_path(&path)?;
    let repo = super::handle(registry.inner(), &repo_id)?.path_str();
    // `restore --staged` needs git 2.23+; fall back for older installations.
    match run_git(&repo, &["restore", "--staged", "--", &path]).await {
        Ok(()) => Ok(()),
        Err(_) => run_git(&repo, &["reset", "-q", "HEAD", "--", &path]).await,
    }
}

#[tauri::command]
pub async fn stage_all(
    repo_id: String,
    registry: tauri::State<'_, Arc<Registry>>,
) -> Result<(), String> {
    let repo = super::handle(registry.inner(), &repo_id)?.path_str();
    run_git(&repo, &["add", "-A"]).await
}

#[tauri::command]
pub async fn unstage_all(
    repo_id: String,
    registry: tauri::State<'_, Arc<Registry>>,
) -> Result<(), String> {
    let repo = super::handle(registry.inner(), &repo_id)?.path_str();
    match run_git(&repo, &["restore", "--staged", "."]).await {
        Ok(()) => Ok(()),
        Err(_) => run_git(&repo, &["reset", "-q", "HEAD"]).await,
    }
}

/// Throw away a file's unstaged changes. Destructive, so the UI confirms first.
#[tauri::command]
pub async fn discard_file(
    repo_id: String,
    path: String,
    registry: tauri::State<'_, Arc<Registry>>,
) -> Result<(), String> {
    validate::repo_path(&path)?;
    let repo = super::handle(registry.inner(), &repo_id)?.path_str();
    match run_git(&repo, &["restore", "--worktree", "--", &path]).await {
        Ok(()) => Ok(()),
        // An untracked file has nothing to restore to; removing it is the
        // equivalent operation.
        Err(_) => run_git(&repo, &["clean", "-qf", "--", &path]).await,
    }
}

#[tauri::command]
pub async fn commit_staged(
    repo_id: String,
    message: String,
    registry: tauri::State<'_, Arc<Registry>>,
) -> Result<(), String> {
    validate::message(&message, MAX_COMMIT_MESSAGE, "Commit message")?;
    let repo = super::handle(registry.inner(), &repo_id)?.path_str();
    run_git(&repo, &["commit", "-m", &message]).await
}

#[tauri::command]
pub async fn amend_commit(
    repo_id: String,
    message: Option<String>,
    registry: tauri::State<'_, Arc<Registry>>,
) -> Result<(), String> {
    let repo = super::handle(registry.inner(), &repo_id)?.path_str();
    match message {
        Some(message) => {
            validate::message(&message, MAX_COMMIT_MESSAGE, "Commit message")?;
            run_git(&repo, &["commit", "--amend", "-m", &message]).await
        }
        None => run_git(&repo, &["commit", "--amend", "--no-edit"]).await,
    }
}

#[tauri::command]
pub async fn user_email(
    repo_id: String,
    registry: tauri::State<'_, Arc<Registry>>,
) -> Result<String, String> {
    let repo = super::handle(registry.inner(), &repo_id)?.path_str();
    // An unset identity is normal; report it rather than failing the panel.
    Ok(run_git_output(&repo, &["config", "user.email"])
        .await
        .unwrap_or_else(|_| String::new()))
}
