//! Graph paging and per-commit detail.

use std::sync::Arc;

use crate::diff::{self, FileChanged, FileDiff};
use crate::graph::detail::{self, CommitDetail};
use crate::graph::snapshot::{GraphFilter, GraphPage, DEFAULT_PAGE_SIZE};
use crate::repo::Registry;
use crate::validate;

/// Upper bound on a branch filter. Selecting every branch of a large fork
/// network is a legitimate "show all", which is what an empty list means.
const MAX_FILTER_BRANCHES: usize = 500;

#[tauri::command]
pub async fn graph_page(
    repo_id: String,
    cursor: Option<String>,
    limit: Option<usize>,
    filter: Option<GraphFilter>,
    registry: tauri::State<'_, Arc<Registry>>,
) -> Result<GraphPage, String> {
    let handle = super::handle(registry.inner(), &repo_id)?;
    let limit = limit.unwrap_or(DEFAULT_PAGE_SIZE);

    let filter = filter.unwrap_or_default();
    if filter.branches.len() > MAX_FILTER_BRANCHES {
        return Err(format!("Too many branches selected (max {MAX_FILTER_BRANCHES})"));
    }
    // Branch names reach `find_reference` as `refs/heads/{name}`; a name
    // carrying `..` or a control character has no business getting there.
    for branch in &filter.branches {
        validate::ref_name(branch)?;
    }

    tokio::task::spawn_blocking(move || {
        // Requesting the first page means "load this repository now", so it
        // always re-walks. Later pages extend the walk only as far as they
        // need, rather than waiting for all of history up front.
        let snapshot = match cursor.as_deref() {
            None | Some("") => handle.snapshot(&filter, true)?,
            Some(value) => {
                let offset = value.parse::<usize>().unwrap_or(0);
                handle.extend_snapshot(&filter, offset + limit)?
            }
        };
        snapshot.page(cursor.as_deref(), limit)
    })
    .await
    .map_err(|e| format!("Task failed: {e}"))?
}

#[tauri::command]
pub async fn commit_files(
    repo_id: String,
    sha: String,
    registry: tauri::State<'_, Arc<Registry>>,
) -> Result<Vec<FileChanged>, String> {
    validate::sha(&sha)?;
    let registry = registry.inner().clone();
    super::with_repo(&registry, &repo_id, move |repo| diff::commit_files(repo, &sha)).await
}

/// One file's diff from a commit. Fetched when the file is opened, rather than
/// shipping every file's hunks with the commit.
#[tauri::command]
pub async fn commit_file_diff(
    repo_id: String,
    sha: String,
    path: String,
    registry: tauri::State<'_, Arc<Registry>>,
) -> Result<Option<FileDiff>, String> {
    validate::sha(&sha)?;
    validate::repo_path(&path)?;
    let registry = registry.inner().clone();
    super::with_repo(&registry, &repo_id, move |repo| diff::commit_file_diff(repo, &sha, &path)).await
}

/// Everything about a commit that the row does not already carry: the full
/// message body, and the committer when it differs from the author.
#[tauri::command]
pub async fn commit_detail(
    repo_id: String,
    sha: String,
    registry: tauri::State<'_, Arc<Registry>>,
) -> Result<CommitDetail, String> {
    validate::sha(&sha)?;
    let registry = registry.inner().clone();
    super::with_repo(&registry, &repo_id, move |repo| detail::load(repo, &sha)).await
}

#[cfg(test)]
mod tests {
    use crate::graph::snapshot::{GraphFilter, GraphSnapshot};
    use crate::testutil::TestRepo;

    /// Whole history, for tests that are not about incremental loading.
    fn snapshot(repo: &TestRepo) -> GraphSnapshot {
        let git = repo.open();
        GraphSnapshot::build(&git, GraphFilter::default())
            .unwrap()
            .extended(&git, usize::MAX)
            .unwrap()
    }

    #[test]
    fn an_empty_repository_produces_an_empty_snapshot() {
        let repo = TestRepo::new();
        let snap = snapshot(&repo);
        assert!(snap.rows.is_empty());
        let page = snap.page(None, 100).unwrap();
        assert_eq!(page.total, 0);
        assert_eq!(page.cursor, None);
        assert_eq!(page.lane_count, 1);
    }

    #[test]
    fn history_is_newest_first_and_carries_parents() {
        let repo = TestRepo::new();
        repo.write("a.txt", "1\n");
        repo.commit_all("first");
        repo.write("a.txt", "2\n");
        let second = repo.commit_all("second");

        let snap = snapshot(&repo);
        assert_eq!(snap.rows.len(), 2);
        assert_eq!(snap.rows[0].sha, second);
        assert_eq!(snap.rows[0].message, "second");
        assert_eq!(snap.rows[0].parent_shas, vec![snap.rows[1].sha.clone()]);
        assert!(snap.rows[1].parent_shas.is_empty());
        assert_eq!(snap.rows[0].short_sha.len(), 7);
    }

    #[test]
    fn unmerged_branches_are_included_and_get_their_own_lane() {
        let repo = TestRepo::new();
        repo.write("a.txt", "1\n");
        repo.commit_all("base");
        repo.branch("feature");
        repo.write("b.txt", "feature\n");
        repo.commit_all("feature work");
        repo.checkout("main");
        repo.write("c.txt", "main\n");
        repo.commit_all("main work");

        let snap = snapshot(&repo);
        let messages: Vec<&str> = snap.rows.iter().map(|r| r.message.as_str()).collect();
        assert!(messages.contains(&"feature work"), "unmerged branch tips must be walked");
        assert!(messages.contains(&"main work"));
        assert!(snap.rows.iter().any(|r| r.lane == 1), "the branch needs its own lane");
    }

    #[test]
    fn refs_land_on_their_commits() {
        let repo = TestRepo::new();
        repo.write("a.txt", "1\n");
        let sha = repo.commit_all("base");
        repo.git(&["tag", "-a", "v1.0", "-m", "release"]);

        let snap = snapshot(&repo);
        let row = snap.rows.iter().find(|r| r.sha == sha).unwrap();
        let kinds: Vec<String> = row
            .refs
            .iter()
            .map(|r| serde_json::to_value(r).unwrap()["kind"].as_str().unwrap().to_string())
            .collect();
        assert!(kinds.contains(&"LocalBranch".to_string()));
        assert!(kinds.contains(&"Tag".to_string()), "annotated tags must be peeled to the commit");
    }

    #[test]
    fn detached_head_is_labelled() {
        let repo = TestRepo::new();
        repo.write("a.txt", "1\n");
        let first = repo.commit_all("first");
        repo.write("a.txt", "2\n");
        repo.commit_all("second");
        repo.git(&["checkout", "-q", &first]);

        let snap = snapshot(&repo);
        let row = snap.rows.iter().find(|r| r.sha == first).unwrap();
        let has_head = row
            .refs
            .iter()
            .any(|r| serde_json::to_value(r).unwrap()["kind"] == "Head");
        assert!(has_head);
    }

    #[test]
    fn paging_walks_the_whole_history_without_gaps_or_repeats() {
        let repo = TestRepo::new();
        for i in 0..25 {
            repo.write("a.txt", &format!("{i}\n"));
            repo.commit_all(&format!("commit {i}"));
        }

        let snap = snapshot(&repo);
        let mut seen = Vec::new();
        let mut cursor = None;
        loop {
            let page = snap.page(cursor.as_deref(), 7).unwrap();
            assert!(page.rows.len() <= 7);
            seen.extend(page.rows.iter().map(|r| r.sha.clone()));
            match page.cursor {
                Some(next) => cursor = Some(next),
                None => break,
            }
        }
        assert_eq!(seen.len(), 25);
        let unique: std::collections::HashSet<_> = seen.iter().collect();
        assert_eq!(unique.len(), 25, "pages must not overlap");
        assert_eq!(seen, snap.rows.iter().map(|r| r.sha.clone()).collect::<Vec<_>>());
    }

    #[test]
    fn the_walk_is_incremental_and_joins_without_a_seam() {
        // The first chunk is served without walking everything; extending must
        // produce exactly the history a single walk would have.
        let repo = TestRepo::new();
        repo.write("a.txt", "base\n");
        repo.commit_all("base");
        repo.branch("feature");
        repo.write("b.txt", "f\n");
        repo.commit_all("feature work");
        repo.checkout("main");
        repo.git(&["merge", "--no-ff", "-q", "feature", "-m", "merge"]);
        for i in 0..20 {
            repo.write("a.txt", &format!("{i}\n"));
            repo.commit_all(&format!("commit {i}"));
        }

        let git = repo.open();
        let whole = GraphSnapshot::build(&git, GraphFilter::default()).unwrap().extended(&git, 1_000).unwrap();

        // Walk it four rows at a time instead.
        let mut piecemeal = GraphSnapshot::build_chunked(&git, GraphFilter::default(), 4).unwrap();
        for wanted in [4, 8, 12, 16, 20, 24, 1_000] {
            piecemeal = piecemeal.extended(&git, wanted).unwrap();
        }

        assert!(whole.is_complete() && piecemeal.is_complete());
        assert_eq!(piecemeal.rows.len(), whole.rows.len());
        for (a, b) in piecemeal.rows.iter().zip(&whole.rows) {
            assert_eq!(a.sha, b.sha);
            // Lanes must be continuous across the joins, not restarted.
            assert_eq!((a.lane, a.color), (b.lane, b.color), "lane differs at {}", a.short_sha);
            assert_eq!(a.segments, b.segments, "segments differ at {}", a.short_sha);
        }
    }

    #[test]
    fn a_page_reports_more_history_while_the_walk_is_unfinished() {
        let repo = TestRepo::new();
        for i in 0..12 {
            repo.write("a.txt", &format!("{i}\n"));
            repo.commit_all(&format!("commit {i}"));
        }
        let git = repo.open();
        let partial = GraphSnapshot::build_chunked(&git, GraphFilter::default(), 5).unwrap();

        let page = partial.page(None, 5).unwrap();
        assert_eq!(page.rows.len(), 5);
        assert!(!page.complete, "the walk has not finished");
        assert!(page.cursor.is_some(), "a cursor must be offered so the rest can load");
    }

    #[test]
    fn a_cursor_past_the_end_returns_nothing_rather_than_failing() {
        let repo = TestRepo::new();
        repo.write("a.txt", "1\n");
        repo.commit_all("base");

        let snap = snapshot(&repo);
        let page = snap.page(Some("9999"), 10).unwrap();
        assert!(page.rows.is_empty());
        assert_eq!(page.cursor, None);
    }

    #[test]
    fn a_malformed_cursor_is_rejected() {
        let repo = TestRepo::new();
        repo.write("a.txt", "1\n");
        repo.commit_all("base");
        assert!(snapshot(&repo).page(Some("not-a-number"), 10).is_err());
    }

    #[test]
    fn lane_count_describes_the_page_not_the_repository() {
        // A page from a quiet stretch of history must not be sized by a wide
        // stretch elsewhere — that is what used to squeeze ref badges out.
        let repo = TestRepo::new();
        repo.write("a.txt", "1\n");
        repo.commit_all("base");
        repo.branch("feature");
        repo.write("b.txt", "f\n");
        repo.commit_all("feature");
        repo.checkout("main");
        repo.git(&["merge", "--no-ff", "-q", "feature", "-m", "merge"]);
        for i in 0..10 {
            repo.write("a.txt", &format!("{i}\n"));
            repo.commit_all(&format!("linear {i}"));
        }

        let snap = snapshot(&repo);
        let head_page = snap.page(None, 5).unwrap();
        assert_eq!(head_page.lane_count, 1, "recent linear history is one lane wide");
        let whole = snap.page(None, 100).unwrap();
        assert!(whole.lane_count >= 2);
    }

    /// Two divergent branches, plus a remote-tracking ref on the feature tip.
    fn forked_repo() -> TestRepo {
        let repo = TestRepo::new();
        repo.write("a.txt", "1\n");
        repo.commit_all("base");
        repo.branch("feature");
        repo.write("b.txt", "feature\n");
        let tip = repo.commit_all("feature work");
        repo.checkout("main");
        repo.write("c.txt", "main\n");
        repo.commit_all("main work");
        repo.git(&["update-ref", "refs/remotes/origin/feature", &tip]);
        repo
    }

    fn walk(repo: &TestRepo, filter: GraphFilter) -> Vec<String> {
        let git = repo.open();
        GraphSnapshot::build(&git, filter)
            .unwrap()
            .extended(&git, usize::MAX)
            .unwrap()
            .rows
            .iter()
            .map(|row| row.message.clone())
            .collect()
    }

    #[test]
    fn a_branch_filter_walks_only_the_branches_it_names() {
        let repo = forked_repo();
        let filter = GraphFilter { branches: vec!["main".to_string()], include_remotes: true };

        let messages = walk(&repo, filter);
        assert!(messages.contains(&"main work".to_string()));
        assert!(messages.contains(&"base".to_string()), "shared ancestry is still walked");
        assert!(
            !messages.contains(&"feature work".to_string()),
            "a branch outside the filter must not be walked"
        );
    }

    #[test]
    fn a_filter_naming_a_remote_branch_walks_it() {
        let repo = forked_repo();
        let filter =
            GraphFilter { branches: vec!["origin/feature".to_string()], include_remotes: true };

        let messages = walk(&repo, filter);
        assert!(messages.contains(&"feature work".to_string()));
        assert!(!messages.contains(&"main work".to_string()));
    }

    #[test]
    fn hiding_remotes_drops_them_as_seeds_and_as_labels() {
        let repo = TestRepo::new();
        repo.write("a.txt", "1\n");
        repo.commit_all("base");
        // A commit reachable only from a remote-tracking ref: with remotes
        // hidden there is nothing left pointing at it.
        repo.branch("gone");
        repo.write("b.txt", "remote only\n");
        let tip = repo.commit_all("remote only");
        repo.checkout("main");
        repo.git(&["update-ref", "refs/remotes/origin/gone", &tip]);
        repo.git(&["branch", "-D", "-q", "gone"]);

        let hidden = GraphFilter { branches: Vec::new(), include_remotes: false };
        let messages = walk(&repo, hidden.clone());
        assert!(!messages.contains(&"remote only".to_string()));

        let git = repo.open();
        let snap = GraphSnapshot::build(&git, hidden).unwrap().extended(&git, usize::MAX).unwrap();
        let labelled = snap
            .rows
            .iter()
            .flat_map(|row| &row.refs)
            .any(|entry| serde_json::to_value(entry).unwrap()["kind"] == "RemoteBranch");
        assert!(!labelled, "no row may carry a remote badge while remotes are hidden");

        // The same repository with remotes shown has both.
        let shown = walk(&repo, GraphFilter::default());
        assert!(shown.contains(&"remote only".to_string()));
    }
}
