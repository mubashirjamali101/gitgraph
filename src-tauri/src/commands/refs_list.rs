//! Every branch and tag in the repository.
//!
//! The graph only shows a ref when its commit happens to be on screen, so
//! there was no way to reach a branch without scrolling for it. This backs the
//! ref picker.

use std::sync::Arc;

use serde::Serialize;

use crate::repo::Registry;

#[derive(Serialize)]
pub struct RefEntry {
    pub name: String,
    /// "local", "remote" or "tag".
    pub kind: String,
    pub sha: String,
    pub is_current: bool,
    /// Commit time of the target, for sorting by recency.
    pub timestamp: i64,
}

#[tauri::command]
pub async fn list_refs(
    repo_id: String,
    registry: tauri::State<'_, Arc<Registry>>,
) -> Result<Vec<RefEntry>, String> {
    let registry = registry.inner().clone();
    super::with_repo(&registry, &repo_id, |repo| {
        let head = repo
            .head()
            .ok()
            .filter(|_| !repo.head_detached().unwrap_or(false))
            .and_then(|h| h.shorthand().map(str::to_string));

        let mut entries = Vec::new();
        for reference in repo.references().map_err(|e| e.to_string())? {
            let Ok(reference) = reference else { continue };
            let Some(full_name) = reference.name() else { continue };

            let (kind, name) = if let Some(name) = full_name.strip_prefix("refs/heads/") {
                ("local", name)
            } else if let Some(name) = full_name.strip_prefix("refs/remotes/") {
                if name.ends_with("/HEAD") {
                    continue;
                }
                ("remote", name)
            } else if let Some(name) = full_name.strip_prefix("refs/tags/") {
                ("tag", name)
            } else {
                continue;
            };

            // Peel so an annotated tag reports the commit it points at.
            let Ok(commit) = reference.peel_to_commit() else { continue };

            entries.push(RefEntry {
                name: name.to_string(),
                kind: kind.to_string(),
                sha: commit.id().to_string(),
                is_current: kind == "local" && head.as_deref() == Some(name),
                timestamp: commit.time().seconds(),
            });
        }

        // Current branch first, then most recently touched.
        entries.sort_by(|a, b| {
            b.is_current.cmp(&a.is_current).then(b.timestamp.cmp(&a.timestamp))
        });
        Ok(entries)
    })
    .await
}
