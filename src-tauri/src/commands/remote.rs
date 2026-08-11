//! Remote operations.
//!
//! Anything that can rewrite published history is gated: `push_impact` tells the
//! UI whether a push would overwrite commits on the remote so it can ask before
//! doing it, and the force path always uses `--force-with-lease`.

use std::sync::Arc;

use serde::Serialize;

use crate::repo::Registry;
use crate::safe_cmd::{run_git, run_git_output};
use crate::validate;

#[derive(Serialize)]
pub struct PushImpact {
    pub ahead: i32,
    pub behind: i32,
    /// The remote holds commits we do not: pushing would discard them.
    pub rewrites: bool,
}

fn repo_path(registry: &Arc<Registry>, repo_id: &str) -> Result<String, String> {
    Ok(super::handle(registry, repo_id)?.path_str())
}

#[tauri::command]
pub async fn fetch_all(
    repo_id: String,
    registry: tauri::State<'_, Arc<Registry>>,
) -> Result<(), String> {
    let repo = repo_path(registry.inner(), &repo_id)?;
    run_git(&repo, &["fetch", "--all", "--prune"]).await
}

#[tauri::command]
pub async fn fetch_branch(
    repo_id: String,
    branch_name: String,
    registry: tauri::State<'_, Arc<Registry>>,
) -> Result<(), String> {
    validate::ref_name(&branch_name)?;
    let repo = repo_path(registry.inner(), &repo_id)?;
    run_git(&repo, &["fetch", "origin", &branch_name]).await
}

#[tauri::command]
pub async fn pull(
    repo_id: String,
    registry: tauri::State<'_, Arc<Registry>>,
) -> Result<(), String> {
    let repo = repo_path(registry.inner(), &repo_id)?;
    run_git(&repo, &["pull", "--ff-only"]).await
}

#[tauri::command]
pub async fn push(
    repo_id: String,
    branch_name: String,
    registry: tauri::State<'_, Arc<Registry>>,
) -> Result<(), String> {
    validate::ref_name(&branch_name)?;
    let repo = repo_path(registry.inner(), &repo_id)?;
    run_git(&repo, &["push", "--set-upstream", "origin", &branch_name]).await
}

#[tauri::command]
pub async fn force_push(
    repo_id: String,
    branch_name: String,
    registry: tauri::State<'_, Arc<Registry>>,
) -> Result<(), String> {
    validate::ref_name(&branch_name)?;
    let repo = repo_path(registry.inner(), &repo_id)?;
    // `--force-with-lease` refuses if the remote moved since our last fetch.
    run_git(&repo, &["push", "--force-with-lease", "--set-upstream", "origin", &branch_name]).await
}

#[tauri::command]
pub async fn push_impact(
    repo_id: String,
    branch_name: String,
    registry: tauri::State<'_, Arc<Registry>>,
) -> Result<PushImpact, String> {
    validate::ref_name(&branch_name)?;
    let repo = repo_path(registry.inner(), &repo_id)?;
    let range = format!("origin/{branch_name}...{branch_name}");

    // No upstream yet is not a failure: the first push is an ordinary push.
    let Ok(output) = run_git_output(&repo, &["rev-list", "--left-right", "--count", &range]).await
    else {
        return Ok(PushImpact { ahead: 0, behind: 0, rewrites: false });
    };

    let mut counts = output.split_whitespace().map(|n| n.parse::<i32>().unwrap_or(0));
    let behind = counts.next().unwrap_or(0);
    let ahead = counts.next().unwrap_or(0);
    Ok(PushImpact { ahead, behind, rewrites: behind > 0 })
}

#[tauri::command]
pub async fn remote_branch_exists(
    repo_id: String,
    branch_name: String,
    registry: tauri::State<'_, Arc<Registry>>,
) -> Result<bool, String> {
    validate::ref_name(&branch_name)?;
    let repo = repo_path(registry.inner(), &repo_id)?;
    match run_git_output(&repo, &["ls-remote", "--heads", "origin", &branch_name]).await {
        Ok(output) => Ok(!output.trim().is_empty()),
        Err(_) => Ok(false),
    }
}

#[tauri::command]
pub async fn delete_remote_branch(
    repo_id: String,
    branch_name: String,
    registry: tauri::State<'_, Arc<Registry>>,
) -> Result<(), String> {
    validate::ref_name(&branch_name)?;
    let repo = repo_path(registry.inner(), &repo_id)?;
    run_git(&repo, &["push", "origin", "--delete", &branch_name]).await
}
