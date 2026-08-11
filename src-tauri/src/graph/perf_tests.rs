//! Timings over a real repository.
//!
//!   GITGRAPH_E2E_REPO=/path/to/repo cargo test --release perf -- --nocapture
//!
//! Release mode matters: a debug build measures LLVM's inlining decisions, not
//! this code. Skipped when the variable is unset.

#![cfg(test)]

use std::time::Instant;

use crate::diff;
use crate::graph::snapshot::{GraphFilter, GraphSnapshot};
use crate::repo::Registry;
use crate::worktree;

fn target() -> Option<String> {
    std::env::var("GITGRAPH_E2E_REPO").ok().filter(|path| !path.is_empty())
}

#[test]
fn perf_report() {
    let Some(path) = target() else {
        eprintln!("GITGRAPH_E2E_REPO not set — skipping");
        return;
    };

    let registry = Registry::new();
    let handle = registry.open(&path).expect("open repository");

    let start = Instant::now();
    let snapshot = handle.with_repo(|repo| GraphSnapshot::build(repo, GraphFilter::default())).expect("snapshot");
    let build = start.elapsed();

    let start = Instant::now();
    let first = snapshot.page(None, 2_000).expect("page");
    let page = start.elapsed();

    let start = Instant::now();
    let json = serde_json::to_string(&first).expect("serialize");
    let serialize = start.elapsed();

    // The largest commit in the first 500 — the interesting case, not the tip.
    let sha = snapshot
        .rows
        .iter()
        .take(500)
        .max_by_key(|row| row.parent_shas.len())
        .map(|row| row.sha.clone())
        .unwrap_or_default();
    let big = snapshot
        .rows
        .iter()
        .take(500)
        .map(|row| row.sha.clone())
        .max_by_key(|sha| {
            handle.with_repo(|repo| diff::commit_files(repo, sha)).map(|f| f.len()).unwrap_or(0)
        })
        .unwrap_or_else(|| sha.clone());

    // Warm the object database so the first call does not absorb its cost.
    let _ = handle.with_repo(|repo| diff::commit_files(repo, &big));

    let start = Instant::now();
    let files = handle.with_repo(|repo| diff::commit_files(repo, &big)).expect("files");
    let files_time = start.elapsed();

    let start = Instant::now();
    let diffs = handle.with_repo(|repo| diff::commit_diff(repo, &big)).expect("diff");
    let diff_time = start.elapsed();

    // What the panel actually asks for: one file.
    let one = files.iter().max_by_key(|f| f.insertions + f.deletions).map(|f| f.path.clone());
    let start = Instant::now();
    let single = one
        .as_ref()
        .map(|path| handle.with_repo(|repo| diff::commit_file_diff(repo, &big, path)))
        .transpose()
        .expect("file diff")
        .flatten();
    let single_time = start.elapsed();
    let single_json = serde_json::to_string(&single).expect("serialize").len();

    let start = Instant::now();
    let tree = handle.with_repo(worktree::load).expect("worktree");
    let worktree_time = start.elapsed();

    // Rough memory estimate for the retained snapshot.
    let bytes: usize = snapshot
        .rows
        .iter()
        .map(|row| {
            std::mem::size_of_val(row)
                + row.sha.len()
                + row.short_sha.len()
                + row.message.len()
                + row.author_name.len()
                + row.author_email.len()
                + row.segments.len() * std::mem::size_of::<crate::graph::lanes::Segment>()
                + row.parent_shas.iter().map(String::len).sum::<usize>()
                + row.refs.len() * 64
        })
        .sum();

    eprintln!("\n── {path}");
    eprintln!("   commits             {}", snapshot.rows.len());
    eprintln!("   snapshot build      {build:?}");
    eprintln!("   page slice (2000)   {page:?}");
    eprintln!("   page serialize      {serialize:?}  ({} KB)", json.len() / 1024);
    let lines: usize = diffs.iter().flat_map(|f| &f.hunks).map(|h| h.lines.len()).sum();
    let diff_json = serde_json::to_string(&diffs).expect("serialize diff").len();
    eprintln!("   commit_files        {files_time:?}  ({} files)", files.len());
    eprintln!(
        "   commit_diff         {diff_time:?}  ({} files, {lines} lines, {} KB over IPC)",
        diffs.len(),
        diff_json / 1024
    );
    eprintln!(
        "   one file's diff     {single_time:?}  ({} KB over IPC)",
        single_json / 1024
    );
    eprintln!(
        "   working tree        {worktree_time:?}  ({} staged / {} unstaged)",
        tree.staged.len(),
        tree.unstaged.len()
    );
    eprintln!("   snapshot memory     ~{} MB\n", bytes / 1_048_576);
}
