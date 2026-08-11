//! Diff loading.
//!
//! Everything is derived from a single `git2::Diff` walked once: deltas, hunks
//! and lines all arrive through libgit2's own callbacks, and hunks are keyed by
//! their reported header rather than reconstructed from line text. That matters
//! for correctness as much as speed — a source line that happens to start with
//! `@@` is just a line here, not a hunk boundary.

use std::cell::RefCell;

use git2::{Delta, Diff, DiffOptions, Oid, Repository, Tree};
use serde::Serialize;

/// Accumulator shared by the diff callbacks.
#[derive(Default)]
struct Collector {
    files: Vec<FileDiff>,
    /// Lines kept for the file currently being walked, for the per-file cap.
    lines_in_file: usize,
}

/// Per-file line budget. Beyond this a file is reported as truncated rather
/// than streaming megabytes of generated code into the UI.
pub const MAX_LINES_PER_FILE: usize = 20_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum ChangeType {
    Added,
    Modified,
    Deleted,
    Renamed,
    Copied,
    Typechange,
}

impl From<Delta> for ChangeType {
    fn from(delta: Delta) -> Self {
        match delta {
            Delta::Added | Delta::Untracked => ChangeType::Added,
            Delta::Deleted => ChangeType::Deleted,
            Delta::Renamed => ChangeType::Renamed,
            Delta::Copied => ChangeType::Copied,
            Delta::Typechange => ChangeType::Typechange,
            _ => ChangeType::Modified,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum DiffLineType {
    Context,
    Added,
    Removed,
}

#[derive(Debug, Clone, Serialize)]
pub struct DiffLine {
    pub content: String,
    pub line_type: DiffLineType,
    pub old_lineno: Option<u32>,
    pub new_lineno: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DiffHunk {
    pub header: String,
    pub old_start: u32,
    pub new_start: u32,
    pub lines: Vec<DiffLine>,
}

#[derive(Debug, Clone, Serialize)]
pub struct FileDiff {
    pub old_path: String,
    pub new_path: String,
    pub change_type: ChangeType,
    pub binary: bool,
    pub truncated: bool,
    pub hunks: Vec<DiffHunk>,
}

#[derive(Debug, Clone, Serialize)]
pub struct FileChanged {
    pub path: String,
    pub change_type: ChangeType,
    pub staged: bool,
    pub insertions: u32,
    pub deletions: u32,
    pub binary: bool,
}

pub fn default_options() -> DiffOptions {
    let mut opts = DiffOptions::new();
    opts.include_typechange(true).ignore_submodules(true).context_lines(3);
    opts
}

fn path_of(file: &git2::DiffFile) -> String {
    file.path().map(|p| p.to_string_lossy().to_string()).unwrap_or_default()
}

/// Collect a whole diff in one pass.
///
/// `Diff::foreach` reports deltas, hunks and lines in order, with each line
/// tagged by the hunk it belongs to, so no reparsing is needed.
pub fn collect(diff: &Diff) -> Vec<FileDiff> {
    // `Diff::foreach` wants four independent `&mut` closures, so the shared
    // accumulator goes behind a RefCell rather than being captured directly.
    // Callbacks are invoked one at a time, so the borrows never overlap.
    let state = RefCell::new(Collector::default());

    let _ = diff.foreach(
        &mut |delta, _| {
            let mut state = state.borrow_mut();
            state.lines_in_file = 0;
            state.files.push(FileDiff {
                old_path: path_of(&delta.old_file()),
                new_path: path_of(&delta.new_file()),
                change_type: ChangeType::from(delta.status()),
                binary: false,
                truncated: false,
                hunks: Vec::new(),
            });
            true
        },
        Some(&mut |_delta, _binary| {
            if let Some(file) = state.borrow_mut().files.last_mut() {
                file.binary = true;
            }
            true
        }),
        Some(&mut |_delta, hunk| {
            if let Some(file) = state.borrow_mut().files.last_mut() {
                file.hunks.push(DiffHunk {
                    header: String::from_utf8_lossy(hunk.header()).trim_end().to_string(),
                    old_start: hunk.old_start(),
                    new_start: hunk.new_start(),
                    lines: Vec::new(),
                });
            }
            true
        }),
        Some(&mut |_delta, _hunk, line| {
            let line_type = match line.origin() {
                '+' => DiffLineType::Added,
                '-' => DiffLineType::Removed,
                ' ' => DiffLineType::Context,
                // File headers, "\ No newline at end of file", binary markers.
                _ => return true,
            };

            let mut state = state.borrow_mut();
            let over_budget = state.lines_in_file >= MAX_LINES_PER_FILE;
            let Some(file) = state.files.last_mut() else { return true };
            if over_budget {
                file.truncated = true;
                return true;
            }
            let Some(hunk) = file.hunks.last_mut() else { return true };

            // Strip the line terminator only; other whitespace is content.
            let content = String::from_utf8_lossy(line.content());
            let content = content.strip_suffix('\n').unwrap_or(&content);
            let content = content.strip_suffix('\r').unwrap_or(content);

            hunk.lines.push(DiffLine {
                content: content.to_string(),
                line_type,
                old_lineno: line.old_lineno(),
                new_lineno: line.new_lineno(),
            });
            state.lines_in_file += 1;
            true
        }),
    );

    state.into_inner().files
}

/// Above this many files, per-file line counts are skipped.
///
/// Counting means asking libgit2 to generate every file's patch — 180ms for a
/// 956-file commit, which is a real wait before the file tree appears. Below
/// the threshold it is imperceptible, and above it the tree still shows what
/// changed, just not by how much.
pub const MAX_FILES_FOR_COUNTS: usize = 250;

/// File list with per-file line counts.
///
/// Nothing is materialized: counting used to build every line of every file as
/// a `String` purely to add it up.
pub fn summarize(diff: &Diff) -> Vec<FileChanged> {
    let with_counts = diff.deltas().len() <= MAX_FILES_FOR_COUNTS;
    summarize_with(diff, with_counts)
}

fn summarize_with(diff: &Diff, with_counts: bool) -> Vec<FileChanged> {
    let files: RefCell<Vec<FileChanged>> = RefCell::new(Vec::new());

    let _ = diff.foreach(
        &mut |delta, _| {
            let new_path = path_of(&delta.new_file());
            let old_path = path_of(&delta.old_file());
            files.borrow_mut().push(FileChanged {
                path: if new_path.is_empty() { old_path } else { new_path },
                change_type: ChangeType::from(delta.status()),
                staged: false,
                insertions: 0,
                deletions: 0,
                binary: false,
            });
            true
        },
        Some(&mut |_delta, _binary| {
            if let Some(file) = files.borrow_mut().last_mut() {
                file.binary = true;
            }
            true
        }),
        None,
        // Passing no line callback means libgit2 never generates the patches.
        with_counts.then_some(&mut |_delta: git2::DiffDelta, _hunk: Option<git2::DiffHunk>, line: git2::DiffLine| {
            if let Some(file) = files.borrow_mut().last_mut() {
                match line.origin() {
                    '+' => file.insertions += 1,
                    '-' => file.deletions += 1,
                    _ => {}
                }
            }
            true
        }),
    );

    files.into_inner()
}

fn commit_trees<'r>(repo: &'r Repository, sha: &str) -> Result<(Option<Tree<'r>>, Tree<'r>), String> {
    let oid = Oid::from_str(sha).map_err(|e| e.to_string())?;
    let commit = repo.find_commit(oid).map_err(|e| e.to_string())?;
    let tree = commit.tree().map_err(|e| e.to_string())?;
    // Diffing against the first parent is what "what did this commit change"
    // means for a merge, and matches `git show`.
    let parent = match commit.parent(0) {
        Ok(parent) => Some(parent.tree().map_err(|e| e.to_string())?),
        Err(_) => None,
    };
    Ok((parent, tree))
}

fn commit_diff_raw<'r>(repo: &'r Repository, sha: &str) -> Result<Diff<'r>, String> {
    let (parent, tree) = commit_trees(repo, sha)?;
    let mut opts = default_options();
    let mut diff = repo
        .diff_tree_to_tree(parent.as_ref(), Some(&tree), Some(&mut opts))
        .map_err(|e| e.to_string())?;
    detect_renames(&mut diff);
    Ok(diff)
}

/// Rename detection turns delete+add pairs into a single renamed entry, by
/// comparing the content of every added file against every deleted one. That is
/// quadratic, and on a commit that touches a thousand files it is most of the
/// time spent listing them, so it is skipped when a commit is that large.
fn detect_renames(diff: &mut Diff) {
    if diff.deltas().len() <= MAX_FILES_FOR_COUNTS {
        let _ = diff.find_similar(None);
    }
}

/// Every file's diff for a commit.
///
/// Nothing in the UI asks for this — the panel fetches one file at a time —
/// but it is what the tests and the perf harness measure against.
#[cfg(test)]
pub fn commit_diff(repo: &Repository, sha: &str) -> Result<Vec<FileDiff>, String> {
    Ok(collect(&commit_diff_raw(repo, sha)?))
}

/// One file's diff.
///
/// The pathspec restricts the diff itself, so the cost is the one file rather
/// than the whole commit — the panel only ever shows one file at a time, and a
/// large commit is 10 MB of JSON if all of them are sent.
///
/// `disable_pathspec_match` makes the path an exact literal: a file named
/// `a[0].txt` is a path, not a glob.
pub fn commit_file_diff(repo: &Repository, sha: &str, path: &str) -> Result<Option<FileDiff>, String> {
    let (parent, tree) = commit_trees(repo, sha)?;
    let mut opts = default_options();
    opts.pathspec(path).disable_pathspec_match(true);
    let mut diff = repo
        .diff_tree_to_tree(parent.as_ref(), Some(&tree), Some(&mut opts))
        .map_err(|e| e.to_string())?;
    // One file's diff is small enough that rename detection always pays.
    let _ = diff.find_similar(None);

    // A rename is only visible with the whole diff in view, so fall back to
    // scanning it when the pathspec finds nothing.
    let found = collect(&diff).into_iter().next();
    if found.is_some() {
        return Ok(found);
    }
    Ok(collect(&commit_diff_raw(repo, sha)?)
        .into_iter()
        .find(|file| file.new_path == path || file.old_path == path))
}

pub fn commit_files(repo: &Repository, sha: &str) -> Result<Vec<FileChanged>, String> {
    Ok(summarize(&commit_diff_raw(repo, sha)?))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::TestRepo;

    #[test]
    fn hunks_come_from_libgit2_not_from_line_text() {
        // A context line starting with "@@" used to split the hunk and steal its
        // header. It is content, and must stay inside the hunk it belongs to.
        let repo = TestRepo::new();
        repo.write("doc.md", "intro\n@@ this is prose, not a hunk header\ntail\n");
        repo.commit_all("base");
        repo.write("doc.md", "intro\n@@ this is prose, not a hunk header\nchanged tail\n");
        let sha = repo.commit_all("edit");

        let diffs = commit_diff(&repo.open(), &sha).unwrap();
        assert_eq!(diffs.len(), 1);
        assert_eq!(diffs[0].hunks.len(), 1, "prose starting with @@ must not split the hunk");

        let hunk = &diffs[0].hunks[0];
        assert!(hunk.header.starts_with("@@"));
        assert!(hunk
            .lines
            .iter()
            .any(|l| l.content == "@@ this is prose, not a hunk header"
                && l.line_type == DiffLineType::Context));
    }

    #[test]
    fn line_numbers_are_reported_per_side() {
        let repo = TestRepo::new();
        repo.write("a.txt", "one\ntwo\nthree\n");
        repo.commit_all("base");
        repo.write("a.txt", "one\nTWO\nthree\n");
        let sha = repo.commit_all("modify");

        let diffs = commit_diff(&repo.open(), &sha).unwrap();
        let lines = &diffs[0].hunks[0].lines;
        let removed = lines.iter().find(|l| l.line_type == DiffLineType::Removed).unwrap();
        let added = lines.iter().find(|l| l.line_type == DiffLineType::Added).unwrap();
        assert_eq!(removed.content, "two");
        assert_eq!(removed.old_lineno, Some(2));
        assert_eq!(removed.new_lineno, None);
        assert_eq!(added.content, "TWO");
        assert_eq!(added.new_lineno, Some(2));
        assert_eq!(added.old_lineno, None);
    }

    #[test]
    fn deleted_files_report_only_their_own_content() {
        // The old implementation passed an empty pathspec for deletions, which
        // matches every path — a deletion pulled in the whole tree.
        let repo = TestRepo::new();
        repo.write("keep.txt", "keep\n");
        repo.write("gone.txt", "gone\n");
        repo.commit_all("base");
        repo.remove("gone.txt");
        let sha = repo.commit_all("delete one file");

        let diffs = commit_diff(&repo.open(), &sha).unwrap();
        assert_eq!(diffs.len(), 1);
        assert_eq!(diffs[0].old_path, "gone.txt");
        assert_eq!(diffs[0].change_type, ChangeType::Deleted);
    }

    #[test]
    fn renames_are_detected() {
        let repo = TestRepo::new();
        repo.write("old.txt", "line one\nline two\nline three\nline four\n");
        repo.commit_all("base");
        repo.rename("old.txt", "new.txt");
        let sha = repo.commit_all("rename");

        let diffs = commit_diff(&repo.open(), &sha).unwrap();
        assert_eq!(diffs.len(), 1);
        assert_eq!(diffs[0].change_type, ChangeType::Renamed);
        assert_eq!(diffs[0].old_path, "old.txt");
        assert_eq!(diffs[0].new_path, "new.txt");
    }

    #[test]
    fn binary_files_are_flagged_and_carry_no_lines() {
        let repo = TestRepo::new();
        repo.write_bytes("blob.bin", &[0u8, 1, 2, 0, 255, 3]);
        let sha = repo.commit_all("add binary");

        let diffs = commit_diff(&repo.open(), &sha).unwrap();
        assert_eq!(diffs.len(), 1);
        assert!(diffs[0].binary);
        assert!(diffs[0].hunks.iter().all(|h| h.lines.is_empty()));
    }

    #[test]
    fn root_commits_diff_against_the_empty_tree() {
        let repo = TestRepo::new();
        repo.write("first.txt", "hello\n");
        let sha = repo.commit_all("root");

        let files = commit_files(&repo.open(), &sha).unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "first.txt");
        assert_eq!(files[0].change_type, ChangeType::Added);
        assert_eq!(files[0].insertions, 1);
    }

    #[test]
    fn oversized_files_are_truncated_not_streamed() {
        let repo = TestRepo::new();
        repo.write("big.txt", "");
        repo.commit_all("base");
        let body: String = (0..MAX_LINES_PER_FILE + 500).map(|i| format!("line {i}\n")).collect();
        repo.write("big.txt", &body);
        let sha = repo.commit_all("huge");

        let diffs = commit_diff(&repo.open(), &sha).unwrap();
        assert!(diffs[0].truncated);
        let lines: usize = diffs[0].hunks.iter().map(|h| h.lines.len()).sum();
        assert!(lines <= MAX_LINES_PER_FILE, "collected {lines} lines");
    }

    #[test]
    fn a_single_file_can_be_fetched_without_the_rest_of_the_commit() {
        let repo = TestRepo::new();
        repo.write("one.txt", "a\n");
        repo.write("two.txt", "b\n");
        repo.commit_all("base");
        repo.write("one.txt", "a\nchanged\n");
        repo.write("two.txt", "b\nalso changed\n");
        let sha = repo.commit_all("touch both");

        let git = repo.open();
        let one = commit_file_diff(&git, &sha, "one.txt").unwrap().unwrap();
        assert_eq!(one.new_path, "one.txt");
        let added: Vec<&str> = one
            .hunks
            .iter()
            .flat_map(|h| &h.lines)
            .filter(|l| l.line_type == DiffLineType::Added)
            .map(|l| l.content.as_str())
            .collect();
        assert_eq!(added, vec!["changed"], "only this file's changes");

        assert!(commit_file_diff(&git, &sha, "nothing.txt").unwrap().is_none());
    }

    #[test]
    fn a_path_containing_glob_characters_is_matched_literally() {
        // Pathspecs are globs by default: `a[0].txt` would match nothing, or
        // worse, something else.
        let repo = TestRepo::new();
        repo.write("a[0].txt", "one\n");
        repo.write("a0.txt", "decoy\n");
        repo.commit_all("base");
        repo.write("a[0].txt", "one\ntwo\n");
        let sha = repo.commit_all("edit the bracketed one");

        let found = commit_file_diff(&repo.open(), &sha, "a[0].txt").unwrap();
        assert!(found.is_some(), "the literal path should have been found");
        assert_eq!(found.unwrap().new_path, "a[0].txt");
    }

    #[test]
    fn counting_lines_does_not_depend_on_collecting_them() {
        let repo = TestRepo::new();
        repo.write("a.txt", "one\ntwo\nthree\n");
        repo.commit_all("base");
        repo.write("a.txt", "one\nTWO\nthree\nfour\n");
        let sha = repo.commit_all("edit");

        let git = repo.open();
        let counted = commit_files(&git, &sha).unwrap();
        let collected = commit_diff(&git, &sha).unwrap();

        let (added, removed) = collected[0].hunks.iter().flat_map(|h| &h.lines).fold(
            (0, 0),
            |(a, r), line| match line.line_type {
                DiffLineType::Added => (a + 1, r),
                DiffLineType::Removed => (a, r + 1),
                DiffLineType::Context => (a, r),
            },
        );
        assert_eq!((counted[0].insertions, counted[0].deletions), (added, removed));
    }

    #[test]
    fn change_counts_are_reported_per_file() {
        let repo = TestRepo::new();
        repo.write("a.txt", "one\ntwo\n");
        repo.commit_all("base");
        repo.write("a.txt", "one\ntwo\nthree\nfour\n");
        let sha = repo.commit_all("append");

        let files = commit_files(&repo.open(), &sha).unwrap();
        assert_eq!(files[0].insertions, 2);
        assert_eq!(files[0].deletions, 0);
    }
}
