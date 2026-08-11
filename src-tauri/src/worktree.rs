//! Working-tree state.
//!
//! Staged and unstaged changes are two different diffs — HEAD→index and
//! index→workdir — and are reported separately. Merging them (as a single
//! tree→workdir diff does) shows the user a patch that does not match what a
//! commit would actually contain.

use git2::{Diff, DiffOptions, Repository};
use serde::Serialize;

use crate::diff::{self, FileChanged, FileDiff};

/// The two file lists. Diffs are fetched per file: the panel shows one at a
/// time, and sending every file's hunks made a busy tree megabytes of JSON.
#[derive(Debug, Serialize)]
pub struct WorkingTree {
    pub staged: Vec<FileChanged>,
    pub unstaged: Vec<FileChanged>,
}

fn workdir_options() -> DiffOptions {
    let mut opts = diff::default_options();
    // Untracked files are unstaged changes as far as the user is concerned;
    // showing the directory instead of its files is never what you want.
    opts.include_untracked(true).recurse_untracked_dirs(true).show_untracked_content(true);
    opts
}

fn staged_diff<'r>(repo: &'r Repository) -> Result<Diff<'r>, String> {
    let head_tree = repo.head().ok().and_then(|h| h.peel_to_commit().ok()).and_then(|c| c.tree().ok());
    let mut opts = diff::default_options();
    let mut diff = repo
        .diff_tree_to_index(head_tree.as_ref(), None, Some(&mut opts))
        .map_err(|e| e.to_string())?;
    let _ = diff.find_similar(None);
    Ok(diff)
}

fn unstaged_diff<'r>(repo: &'r Repository) -> Result<Diff<'r>, String> {
    let mut opts = workdir_options();
    let mut diff = repo.diff_index_to_workdir(None, Some(&mut opts)).map_err(|e| e.to_string())?;
    let _ = diff.find_similar(None);
    Ok(diff)
}

pub fn load(repo: &Repository) -> Result<WorkingTree, String> {
    let mut staged = diff::summarize(&staged_diff(repo)?);
    for file in &mut staged {
        file.staged = true;
    }

    Ok(WorkingTree { staged, unstaged: diff::summarize(&unstaged_diff(repo)?) })
}

/// One working-tree file's diff, from the side of the index it lives on.
pub fn file_diff(repo: &Repository, path: &str, staged: bool) -> Result<Option<FileDiff>, String> {
    let head_tree = repo.head().ok().and_then(|h| h.peel_to_commit().ok()).and_then(|c| c.tree().ok());

    let mut opts = if staged { diff::default_options() } else { workdir_options() };
    opts.pathspec(path).disable_pathspec_match(true);

    let mut diff = if staged {
        repo.diff_tree_to_index(head_tree.as_ref(), None, Some(&mut opts))
    } else {
        repo.diff_index_to_workdir(None, Some(&mut opts))
    }
    .map_err(|e| e.to_string())?;
    let _ = diff.find_similar(None);

    Ok(diff::collect(&diff).into_iter().next())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::TestRepo;

    #[test]
    fn staged_and_unstaged_are_reported_separately() {
        let repo = TestRepo::new();
        repo.write("tracked.txt", "one\n");
        repo.commit_all("base");

        repo.write("tracked.txt", "one\ntwo\n");
        repo.git(&["add", "tracked.txt"]);
        // Same file changed again after staging: it is in both lists, with
        // different content on each side.
        repo.write("tracked.txt", "one\ntwo\nthree\n");
        repo.write("new.txt", "fresh\n");

        let tree = load(&repo.open()).unwrap();

        assert_eq!(tree.staged.len(), 1);
        assert_eq!(tree.staged[0].path, "tracked.txt");
        assert!(tree.staged[0].staged);
        assert_eq!(tree.staged[0].insertions, 1);

        // Each side's diff is fetched separately and shows that side's content.
        let staged_diff = file_diff(&repo.open(), "tracked.txt", true).unwrap().unwrap();
        let unstaged_diff = file_diff(&repo.open(), "tracked.txt", false).unwrap().unwrap();
        let added = |d: &FileDiff| {
            d.hunks
                .iter()
                .flat_map(|h| &h.lines)
                .filter(|l| matches!(l.line_type, crate::diff::DiffLineType::Added))
                .map(|l| l.content.clone())
                .collect::<Vec<_>>()
        };
        assert_eq!(added(&staged_diff), vec!["two"]);
        assert_eq!(added(&unstaged_diff), vec!["three"]);

        let unstaged: Vec<&str> = tree.unstaged.iter().map(|f| f.path.as_str()).collect();
        assert!(unstaged.contains(&"tracked.txt"));
        assert!(unstaged.contains(&"new.txt"), "untracked files count as unstaged");
        assert!(tree.unstaged.iter().all(|f| !f.staged));
    }

    #[test]
    fn a_clean_tree_reports_nothing() {
        let repo = TestRepo::new();
        repo.write("a.txt", "a\n");
        repo.commit_all("base");

        let tree = load(&repo.open()).unwrap();
        assert!(tree.staged.is_empty());
        assert!(tree.unstaged.is_empty());
    }

    #[test]
    fn untracked_directories_are_listed_as_files() {
        let repo = TestRepo::new();
        repo.write("a.txt", "a\n");
        repo.commit_all("base");
        repo.write("nested/deep/file.txt", "x\n");

        let tree = load(&repo.open()).unwrap();
        assert_eq!(tree.unstaged.len(), 1);
        assert_eq!(tree.unstaged[0].path, "nested/deep/file.txt");
    }

    #[test]
    fn staging_before_the_first_commit_works() {
        // No HEAD yet: the staged diff is against an empty tree.
        let repo = TestRepo::new();
        repo.write("first.txt", "hello\n");
        repo.git(&["add", "first.txt"]);

        let tree = load(&repo.open()).unwrap();
        assert_eq!(tree.staged.len(), 1);
        assert_eq!(tree.staged[0].path, "first.txt");
    }
}
