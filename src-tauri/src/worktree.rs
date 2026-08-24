//! Working-tree state.
//!
//! Staged and unstaged changes are two different diffs — HEAD→index and
//! index→workdir — and are reported separately. Merging them (as a single
//! tree→workdir diff does) shows the user a patch that does not match what a
//! commit would actually contain.

use std::path::{Path, PathBuf};

use git2::{Diff, DiffOptions, Repository};
use serde::Serialize;

use crate::diff::{self, FileChanged, FileDiff};
use crate::validate;

const MAX_TEXT: usize = 8 * 1024 * 1024;

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

/// Both sides of a working-tree file, as text, for the editor.
#[derive(Debug, Serialize)]
pub struct FileText {
    pub original: String,
    pub current: String,
    pub binary: bool,
}

fn decode(bytes: &[u8]) -> Result<(String, bool), String> {
    if bytes.len() > MAX_TEXT {
        return Err("File is too large to open".into());
    }
    if bytes.contains(&0) {
        return Ok((String::new(), true));
    }
    Ok((String::from_utf8_lossy(bytes).into_owned(), false))
}

fn blob_bytes(repo: &Repository, oid: git2::Oid) -> Result<Vec<u8>, String> {
    let blob = repo.find_blob(oid).map_err(|e| e.to_string())?;
    Ok(blob.content().to_vec())
}

fn head_bytes(repo: &Repository, path: &str) -> Result<Option<Vec<u8>>, String> {
    let Some(tree) = repo
        .head()
        .ok()
        .and_then(|head| head.peel_to_commit().ok())
        .and_then(|commit| commit.tree().ok())
    else {
        return Ok(None);
    };
    match tree.get_path(Path::new(path)) {
        Ok(entry) => {
            let object = entry.to_object(repo).map_err(|e| e.to_string())?;
            match object.as_blob() {
                Some(blob) => Ok(Some(blob.content().to_vec())),
                None => Ok(None),
            }
        }
        Err(_) => Ok(None),
    }
}

fn index_bytes(repo: &Repository, path: &str) -> Result<Option<Vec<u8>>, String> {
    let index = repo.index().map_err(|e| e.to_string())?;
    match index.get_path(Path::new(path), 0) {
        Some(entry) => blob_bytes(repo, entry.id).map(Some),
        None => Ok(None),
    }
}

fn worktree_bytes(repo: &Repository, path: &str) -> Result<Option<Vec<u8>>, String> {
    let dest = worktree_path(repo, path)?;
    if !dest.is_file() {
        return Ok(None);
    }
    let bytes = std::fs::read(&dest).map_err(|e| e.to_string())?;
    if bytes.len() > MAX_TEXT {
        return Err("File is too large to open".into());
    }
    Ok(Some(bytes))
}

fn worktree_path(repo: &Repository, rel: &str) -> Result<PathBuf, String> {
    validate::repo_path(rel)?;
    let root = repo.workdir().ok_or_else(|| "Bare repository".to_string())?;
    let dest = root.join(rel);
    let root_abs = root.canonicalize().map_err(|e| e.to_string())?;
    let parent = dest.parent().ok_or_else(|| "Invalid path".to_string())?;
    if !parent.exists() {
        return Err("Path is outside the repository".into());
    }
    let parent_abs = parent.canonicalize().map_err(|e| e.to_string())?;
    if !parent_abs.starts_with(&root_abs) {
        return Err("Path is outside the repository".into());
    }
    Ok(dest)
}

/// Left = original (HEAD for staged, index for unstaged). Right = current.
pub fn file_text(repo: &Repository, path: &str, staged: bool) -> Result<FileText, String> {
    let original_bytes = if staged {
        head_bytes(repo, path)?
    } else {
        match index_bytes(repo, path)? {
            Some(bytes) => Some(bytes),
            None => head_bytes(repo, path)?,
        }
    };
    let current_bytes = if staged {
        index_bytes(repo, path)?
    } else {
        worktree_bytes(repo, path)?
    };

    let (original, original_binary) = match original_bytes {
        Some(bytes) => decode(&bytes)?,
        None => (String::new(), false),
    };
    let (current, current_binary) = match current_bytes {
        Some(bytes) => decode(&bytes)?,
        None => (String::new(), false),
    };
    Ok(FileText {
        original,
        current,
        binary: original_binary || current_binary,
    })
}

pub fn write_worktree(repo: &Repository, path: &str, contents: &str) -> Result<(), String> {
    if contents.len() > MAX_TEXT {
        return Err("File is too large to save".into());
    }
    let dest = worktree_path(repo, path)?;
    if !dest.is_file() {
        return Err("File is not in the working tree".into());
    }
    std::fs::write(&dest, contents.as_bytes()).map_err(|e| e.to_string())
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

    #[test]
    fn unstaged_text_is_index_versus_workdir() {
        let repo = TestRepo::new();
        repo.write("tracked.txt", "one\n");
        repo.commit_all("base");
        repo.write("tracked.txt", "two\n");

        let sides = file_text(&repo.open(), "tracked.txt", false).unwrap();
        assert!(!sides.binary);
        assert_eq!(sides.original, "one\n");
        assert_eq!(sides.current, "two\n");

        write_worktree(&repo.open(), "tracked.txt", "three\n").unwrap();
        let after = file_text(&repo.open(), "tracked.txt", false).unwrap();
        assert_eq!(after.current, "three\n");
    }
}
