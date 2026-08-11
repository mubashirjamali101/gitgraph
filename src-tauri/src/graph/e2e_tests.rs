//! Invariant checks against a real repository.
//!
//! Fixture repositories are small and tidy; real history is neither. Point
//! `GITGRAPH_E2E_REPO` at a checkout to run the whole pipeline over it:
//!
//!   GITGRAPH_E2E_REPO=/path/to/repo cargo test -- --nocapture e2e
//!
//! Skipped when the variable is unset, so the normal suite stays hermetic.

#![cfg(test)]

use crate::graph::snapshot::{GraphFilter, GraphSnapshot};
use crate::repo::Registry;

fn target() -> Option<String> {
    std::env::var("GITGRAPH_E2E_REPO").ok().filter(|path| !path.is_empty())
}

/// Every line a row draws must be fed from above and continued below.
///
/// This is the property the windowed renderer depends on, and it has to hold
/// for a *filtered* walk too: lanes are assigned during the walk, so each
/// filter produces its own geometry rather than a subset of the unfiltered one.
fn assert_segments_join_up(rows: &[crate::graph::snapshot::GraphRow], label: &str) {
    for (index, row) in rows.iter().enumerate() {
        assert_eq!(row.sha.len(), 40, "{label}: row {index} has a malformed sha");
        assert!(row.color < crate::graph::lanes::PALETTE_SIZE);

        if index > 0 {
            let previous = &rows[index - 1];
            for segment in &row.segments {
                let fed = segment.from == row.lane
                    || previous.segments.iter().any(|above| above.to == segment.from);
                assert!(
                    fed,
                    "{label}: row {index} ({}) draws from lane {}, which nothing above continues into",
                    row.short_sha, segment.from
                );
            }
        }

        if let Some(next) = rows.get(index + 1) {
            for segment in &row.segments {
                let continued =
                    next.lane == segment.to || next.segments.iter().any(|s| s.from == segment.to);
                assert!(
                    continued,
                    "{label}: row {index} ({}) draws into lane {} but the next row does not continue it",
                    row.short_sha, segment.to
                );
            }
        }
    }
}

/// The branch filter over real history.
///
/// A fixture repository has three branches that agree with each other; a real
/// one has long-abandoned remotes, tags on unmerged tips and branches that
/// forked hundreds of commits back. Those are the cases where "filter the walk"
/// and "filter the rows" diverge.
#[test]
fn e2e_a_filtered_walk_is_a_smaller_but_whole_graph() {
    let Some(path) = target() else {
        eprintln!("GITGRAPH_E2E_REPO not set — skipping");
        return;
    };

    let registry = Registry::new();
    let handle = registry.open(&path).expect("open repository");

    let everything = handle
        .with_repo(|repo| GraphSnapshot::build(repo, GraphFilter::default()))
        .expect("unfiltered snapshot");
    assert_segments_join_up(&everything.rows, "unfiltered");

    let all_shas: std::collections::HashSet<&str> =
        everything.rows.iter().map(|row| row.sha.as_str()).collect();

    // Filter to the branch HEAD is on — the one selection every repository has.
    let current = handle
        .with_repo(|repo| {
            Ok(repo
                .head()
                .ok()
                .filter(|_| !repo.head_detached().unwrap_or(false))
                .and_then(|head| head.shorthand().map(str::to_string)))
        })
        .expect("read head");
    let Some(branch) = current else {
        eprintln!("{path}: detached HEAD — skipping the filtered half");
        return;
    };

    let filtered = handle
        .with_repo(|repo| {
            GraphSnapshot::build(
                repo,
                GraphFilter { branches: vec![branch.clone()], include_remotes: true },
            )
        })
        .expect("filtered snapshot");

    assert!(!filtered.rows.is_empty(), "{path}: filtering to {branch} walked nothing");
    assert!(filtered.rows.len() <= everything.rows.len());
    assert_segments_join_up(&filtered.rows, &format!("filtered to {branch}"));
    for row in &filtered.rows {
        assert!(
            all_shas.contains(row.sha.as_str()),
            "{path}: {} appears only under a filter",
            row.short_sha
        );
    }

    // Hiding remotes must take their commits with them, not just their labels.
    let local_only = handle
        .with_repo(|repo| {
            GraphSnapshot::build(repo, GraphFilter { branches: Vec::new(), include_remotes: false })
        })
        .expect("local-only snapshot");
    assert_segments_join_up(&local_only.rows, "remotes hidden");
    let labelled = local_only
        .rows
        .iter()
        .flat_map(|row| &row.refs)
        .any(|entry| matches!(entry, crate::graph::refs::GitRef::RemoteBranch { .. }));
    assert!(!labelled, "{path}: a remote badge survived with remotes hidden");

    eprintln!(
        "{path}: {} commits unfiltered, {} on {branch}, {} without remotes",
        everything.rows.len(),
        filtered.rows.len(),
        local_only.rows.len(),
    );
}

#[test]
fn e2e_real_repository_holds_the_graph_invariants() {
    let Some(path) = target() else {
        eprintln!("GITGRAPH_E2E_REPO not set — skipping");
        return;
    };

    let registry = Registry::new();
    let handle = registry.open(&path).expect("open repository");
    let snapshot = handle.with_repo(|repo| GraphSnapshot::build(repo, GraphFilter::default())).expect("build snapshot");

    assert!(!snapshot.rows.is_empty(), "expected commits in {path}");

    let mut widest = 1usize;
    let mut merges = 0usize;

    for (index, row) in snapshot.rows.iter().enumerate() {
        assert_eq!(row.sha.len(), 40, "row {index} has a malformed sha");
        assert_eq!(row.short_sha.len(), 7);
        assert!(row.color < crate::graph::lanes::PALETTE_SIZE);
        if row.parent_shas.len() > 1 {
            merges += 1;
        }

        let used = row
            .segments
            .iter()
            .fold(row.lane + 1, |max, s| max.max(s.from + 1).max(s.to + 1));
        widest = widest.max(used);

        // Nothing may start in mid-air: a segment either leaves this row's own
        // lane, or continues a lane the row above drew into.
        if index > 0 {
            let previous = &snapshot.rows[index - 1];
            for segment in &row.segments {
                let fed = segment.from == row.lane
                    || previous.segments.iter().any(|above| above.to == segment.from);
                assert!(
                    fed,
                    "row {index} ({}) draws from lane {}, which nothing above continues into",
                    row.short_sha, segment.from
                );
            }
        }

        // The renderer draws a window of rows in isolation: every line leaving a
        // row must be continued by the next one, or it ends in mid-air.
        if let Some(next) = snapshot.rows.get(index + 1) {
            for segment in &row.segments {
                let continued =
                    next.lane == segment.to || next.segments.iter().any(|s| s.from == segment.to);
                assert!(
                    continued,
                    "row {index} ({}) draws into lane {} but the next row does not continue it",
                    row.short_sha, segment.to
                );
            }
        }
    }

    // Paging must reproduce the snapshot exactly, with no gaps or repeats.
    let mut paged = Vec::new();
    let mut cursor = None;
    loop {
        let page = snapshot.page(cursor.as_deref(), 500).expect("page");
        paged.extend(page.rows.iter().map(|row| row.sha.clone()));
        match page.cursor {
            Some(next) => cursor = Some(next),
            None => break,
        }
    }
    let expected: Vec<String> = snapshot.rows.iter().map(|row| row.sha.clone()).collect();
    assert_eq!(paged, expected, "paging did not reproduce the walk");

    let mut per_row: Vec<usize> = snapshot
        .rows
        .iter()
        .map(|row| {
            row.segments
                .iter()
                .fold(row.lane + 1, |max, s| max.max(s.from + 1).max(s.to + 1))
        })
        .collect();
    per_row.sort_unstable();
    let p50 = per_row[per_row.len() / 2];
    let p90 = per_row[per_row.len() * 9 / 10];

    eprintln!(
        "{path}: {} commits, {merges} merges, lanes p50 {p50} / p90 {p90} / max {widest}",
        snapshot.rows.len()
    );
}
