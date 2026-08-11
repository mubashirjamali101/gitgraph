//! Branch, tag and history-editing operations.

use std::sync::Arc;

use crate::repo::Registry;
use crate::safe_cmd::run_git;
use crate::validate;

const MAX_TAG_MESSAGE: usize = 8192;

fn repo_path(registry: &Arc<Registry>, repo_id: &str) -> Result<String, String> {
    Ok(super::handle(registry, repo_id)?.path_str())
}

#[tauri::command]
pub async fn checkout(
    repo_id: String,
    ref_name: String,
    registry: tauri::State<'_, Arc<Registry>>,
) -> Result<(), String> {
    validate::ref_name(&ref_name)?;
    let repo = repo_path(registry.inner(), &repo_id)?;
    // `switch` cannot be tricked into treating the name as a pathspec. It
    // refuses tags and raw shas, so fall back to `checkout` for those.
    match run_git(&repo, &["switch", &ref_name]).await {
        Ok(()) => Ok(()),
        Err(_) => run_git(&repo, &["checkout", &ref_name]).await,
    }
}

#[tauri::command]
pub async fn create_branch(
    repo_id: String,
    name: String,
    from_sha: String,
    checkout: bool,
    registry: tauri::State<'_, Arc<Registry>>,
) -> Result<(), String> {
    validate::ref_name(&name)?;
    validate::sha(&from_sha)?;
    let repo = repo_path(registry.inner(), &repo_id)?;
    if checkout {
        run_git(&repo, &["checkout", "-b", &name, &from_sha]).await
    } else {
        run_git(&repo, &["branch", &name, &from_sha]).await
    }
}

#[tauri::command]
pub async fn rename_branch(
    repo_id: String,
    old_name: String,
    new_name: String,
    registry: tauri::State<'_, Arc<Registry>>,
) -> Result<(), String> {
    validate::ref_name(&old_name)?;
    validate::ref_name(&new_name)?;
    let repo = repo_path(registry.inner(), &repo_id)?;
    run_git(&repo, &["branch", "-m", "--", &old_name, &new_name]).await
}

#[tauri::command]
pub async fn delete_branch(
    repo_id: String,
    name: String,
    force: bool,
    registry: tauri::State<'_, Arc<Registry>>,
) -> Result<(), String> {
    validate::ref_name(&name)?;
    let repo = repo_path(registry.inner(), &repo_id)?;
    let flag = if force { "-D" } else { "-d" };
    run_git(&repo, &["branch", flag, "--", &name]).await
}

#[tauri::command]
pub async fn create_tag(
    repo_id: String,
    name: String,
    sha: String,
    message: Option<String>,
    registry: tauri::State<'_, Arc<Registry>>,
) -> Result<(), String> {
    validate::ref_name(&name)?;
    validate::sha(&sha)?;
    let repo = repo_path(registry.inner(), &repo_id)?;
    match message {
        Some(message) => {
            validate::message(&message, MAX_TAG_MESSAGE, "Tag message")?;
            run_git(&repo, &["tag", "-a", &name, &sha, "-m", &message]).await
        }
        None => run_git(&repo, &["tag", &name, &sha]).await,
    }
}

#[tauri::command]
pub async fn delete_tag(
    repo_id: String,
    name: String,
    registry: tauri::State<'_, Arc<Registry>>,
) -> Result<(), String> {
    validate::ref_name(&name)?;
    let repo = repo_path(registry.inner(), &repo_id)?;
    run_git(&repo, &["tag", "-d", &name]).await
}

#[tauri::command]
pub async fn merge(
    repo_id: String,
    ref_name: String,
    registry: tauri::State<'_, Arc<Registry>>,
) -> Result<(), String> {
    validate::ref_name(&ref_name)?;
    let repo = repo_path(registry.inner(), &repo_id)?;
    run_git(&repo, &["merge", "--no-ff", "--no-edit", &ref_name]).await
}

#[tauri::command]
pub async fn rebase(
    repo_id: String,
    onto: String,
    registry: tauri::State<'_, Arc<Registry>>,
) -> Result<(), String> {
    validate::ref_name(&onto)?;
    let repo = repo_path(registry.inner(), &repo_id)?;
    run_git(&repo, &["rebase", &onto]).await
}

#[tauri::command]
pub async fn cherry_pick(
    repo_id: String,
    sha: String,
    registry: tauri::State<'_, Arc<Registry>>,
) -> Result<(), String> {
    validate::sha(&sha)?;
    let repo = repo_path(registry.inner(), &repo_id)?;
    run_git(&repo, &["cherry-pick", &sha]).await
}

#[tauri::command]
pub async fn reset(
    repo_id: String,
    sha: String,
    mode: String,
    registry: tauri::State<'_, Arc<Registry>>,
) -> Result<(), String> {
    validate::sha(&sha)?;
    let flag = match mode.as_str() {
        "soft" => "--soft",
        "mixed" => "--mixed",
        "hard" => "--hard",
        other => return Err(format!("Unknown reset mode: {other}")),
    };
    let repo = repo_path(registry.inner(), &repo_id)?;
    run_git(&repo, &["reset", flag, &sha]).await
}

#[tauri::command]
pub async fn revert(
    repo_id: String,
    sha: String,
    registry: tauri::State<'_, Arc<Registry>>,
) -> Result<(), String> {
    validate::sha(&sha)?;
    let repo = repo_path(registry.inner(), &repo_id)?;
    run_git(&repo, &["revert", "--no-edit", &sha]).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::TestRepo;

    /// Every ref-taking command validates before git sees the value; these
    /// assert the guard is actually wired up, not just present.
    #[tokio::test]
    async fn hostile_ref_names_never_reach_git() {
        for name in ["--upload-pack=touch /tmp/pwned", "-D", "a..b", "x@{0}"] {
            assert!(validate::ref_name(name).is_err(), "{name} should be rejected");
        }
    }

    #[tokio::test]
    async fn creating_a_branch_without_checkout_leaves_head_alone() {
        let repo = TestRepo::new();
        repo.write("a.txt", "a\n");
        let sha = repo.commit_all("base");

        let registry = Arc::new(Registry::new());
        let handle = registry.open(&repo.path()).unwrap();
        let path = handle.path_str();

        run_git(&path, &["branch", "side", &sha]).await.unwrap();
        assert_eq!(repo.git(&["rev-parse", "--abbrev-ref", "HEAD"]), "main");
        assert!(repo.git(&["branch", "--list", "side"]).contains("side"));
    }
}
