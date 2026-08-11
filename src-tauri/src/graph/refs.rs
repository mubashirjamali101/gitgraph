//! Ref resolution: which branches, remotes and tags point at which commit.

use std::collections::HashMap;

use git2::{Oid, Repository};
use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "kind")]
pub enum GitRef {
    LocalBranch { name: String, is_current: bool },
    RemoteBranch { name: String },
    Tag { name: String },
    Head { detached: bool },
}

impl GitRef {
    /// Sort key: current branch, other locals, remotes, tags, HEAD.
    fn rank(&self) -> u8 {
        match self {
            GitRef::LocalBranch { is_current: true, .. } => 0,
            GitRef::LocalBranch { .. } => 1,
            GitRef::RemoteBranch { .. } => 2,
            GitRef::Tag { .. } => 3,
            GitRef::Head { .. } => 4,
        }
    }

    fn name(&self) -> &str {
        match self {
            GitRef::LocalBranch { name, .. }
            | GitRef::RemoteBranch { name }
            | GitRef::Tag { name } => name,
            GitRef::Head { .. } => "HEAD",
        }
    }
}

/// Map every commit that carries a ref to its refs, sorted for display.
///
/// Annotated tags are peeled, so a tag object pointing at a commit lands on the
/// commit rather than being dropped.
pub fn build_map(repo: &Repository) -> Result<HashMap<Oid, Vec<GitRef>>, git2::Error> {
    let head = repo.head().ok();
    let head_detached = repo.head_detached().unwrap_or(false);
    let current_branch = head
        .as_ref()
        .filter(|_| !head_detached)
        .and_then(|h| h.shorthand().map(str::to_string));

    let mut map: HashMap<Oid, Vec<GitRef>> = HashMap::new();

    for reference in repo.references()? {
        let Ok(reference) = reference else { continue };
        let Some(name) = reference.name().map(str::to_string) else { continue };

        // Peel so annotated tags resolve to the commit they point at.
        let Some(target) = reference
            .peel_to_commit()
            .map(|commit| commit.id())
            .ok()
            .or_else(|| reference.target())
        else {
            continue;
        };

        if let Some(branch) = name.strip_prefix("refs/heads/") {
            let is_current = current_branch.as_deref() == Some(branch);
            map.entry(target).or_default().push(GitRef::LocalBranch {
                name: branch.to_string(),
                is_current,
            });
        } else if let Some(remote) = name.strip_prefix("refs/remotes/") {
            // `origin/HEAD` is a pointer to the remote's default branch, not a
            // branch of its own: showing it duplicates whatever it points at.
            if remote.ends_with("/HEAD") {
                continue;
            }
            map.entry(target)
                .or_default()
                .push(GitRef::RemoteBranch { name: remote.to_string() });
        } else if let Some(tag) = name.strip_prefix("refs/tags/") {
            map.entry(target).or_default().push(GitRef::Tag { name: tag.to_string() });
        }
    }

    // A detached HEAD is not covered by any branch ref, so label it explicitly.
    if head_detached {
        if let Some(target) = head.as_ref().and_then(|h| h.target()) {
            map.entry(target).or_default().push(GitRef::Head { detached: true });
        }
    }

    for refs in map.values_mut() {
        refs.sort_by(|a, b| a.rank().cmp(&b.rank()).then_with(|| a.name().cmp(b.name())));
    }

    Ok(map)
}
