//! Stash listing and manipulation.

use std::sync::Arc;

use serde::Serialize;

use crate::repo::Registry;
use crate::safe_cmd::run_git;

const MAX_STASH_MESSAGE: usize = 1024;
/// Guards against a nonsensical index reaching `stash@{n}`.
const MAX_STASH_INDEX: usize = 1000;

#[derive(Serialize)]
pub struct StashEntry {
    pub index: usize,
    pub message: String,
    pub branch: String,
}

fn repo_path(registry: &Arc<Registry>, repo_id: &str) -> Result<String, String> {
    Ok(super::handle(registry, repo_id)?.path_str())
}

fn check_index(index: usize) -> Result<(), String> {
    if index > MAX_STASH_INDEX {
        return Err("Invalid stash index".to_string());
    }
    Ok(())
}

/// Split `"WIP on main: 1a2b3c message"` into its branch and message parts.
fn parse_subject(subject: &str) -> (String, String) {
    let body = subject
        .strip_prefix("WIP on ")
        .or_else(|| subject.strip_prefix("On "))
        .unwrap_or(subject);
    match body.split_once(':') {
        Some((branch, message)) => (branch.trim().to_string(), message.trim().to_string()),
        None => (String::new(), body.trim().to_string()),
    }
}

/// Reading the stash goes through libgit2: a reload used to spawn a `git`
/// process for this, another for the conflict state, and more for the rest.
#[tauri::command]
pub async fn stash_list(
    repo_id: String,
    registry: tauri::State<'_, Arc<Registry>>,
) -> Result<Vec<StashEntry>, String> {
    let handle = super::handle(registry.inner(), &repo_id)?;
    tokio::task::spawn_blocking(move || {
        handle.with_repo_mut(|repo| {
            let mut entries = Vec::new();
            // `stash_foreach` needs a mutable repository handle.
            repo.stash_foreach(|index, subject, _oid| {
                let (branch, message) = parse_subject(subject);
                entries.push(StashEntry { index, message, branch });
                true
            })
            .map_err(|e| e.to_string())?;
            Ok(entries)
        })
    })
    .await
    .map_err(|e| format!("Task failed: {e}"))?
}

#[tauri::command]
pub async fn stash_push(
    repo_id: String,
    message: Option<String>,
    include_untracked: bool,
    registry: tauri::State<'_, Arc<Registry>>,
) -> Result<(), String> {
    let repo = repo_path(registry.inner(), &repo_id)?;
    let mut args = vec!["stash", "push"];
    if include_untracked {
        args.push("--include-untracked");
    }
    if let Some(message) = message.as_deref() {
        if message.len() > MAX_STASH_MESSAGE {
            return Err("Stash message too long".to_string());
        }
        args.push("-m");
        args.push(message);
    }
    run_git(&repo, &args).await
}

async fn stash_op(
    registry: &Arc<Registry>,
    repo_id: &str,
    verb: &str,
    index: usize,
) -> Result<(), String> {
    check_index(index)?;
    let repo = repo_path(registry, repo_id)?;
    run_git(&repo, &["stash", verb, &format!("stash@{{{index}}}")]).await
}

#[tauri::command]
pub async fn stash_pop(
    repo_id: String,
    index: usize,
    registry: tauri::State<'_, Arc<Registry>>,
) -> Result<(), String> {
    stash_op(registry.inner(), &repo_id, "pop", index).await
}

#[tauri::command]
pub async fn stash_apply(
    repo_id: String,
    index: usize,
    registry: tauri::State<'_, Arc<Registry>>,
) -> Result<(), String> {
    stash_op(registry.inner(), &repo_id, "apply", index).await
}

#[tauri::command]
pub async fn stash_drop(
    repo_id: String,
    index: usize,
    registry: tauri::State<'_, Arc<Registry>>,
) -> Result<(), String> {
    stash_op(registry.inner(), &repo_id, "drop", index).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn subjects_split_into_branch_and_message() {
        assert_eq!(
            parse_subject("WIP on main: 1a2b3c earlier work"),
            ("main".to_string(), "1a2b3c earlier work".to_string())
        );
        assert_eq!(
            parse_subject("On feature/login: custom message"),
            ("feature/login".to_string(), "custom message".to_string())
        );
        // A message with no recognizable prefix still shows something useful.
        assert_eq!(parse_subject("plain text"), (String::new(), "plain text".to_string()));
    }

    #[test]
    fn absurd_indices_are_refused() {
        assert!(check_index(0).is_ok());
        assert!(check_index(MAX_STASH_INDEX + 1).is_err());
    }
}
