//! Commit snapshot and paging.
//!
//! The walk is incremental. Loading a repository walks a first chunk and
//! returns it; scrolling past the end walks further. A quarter-million-commit
//! repository would otherwise spend several seconds walking before anything at
//! all could be painted.
//!
//! Extending re-runs the revwalk and skips what has already been processed.
//! Walking object ids is cheap (~1µs each); the cost is reading commits and
//! building rows, and that is only done for the new range. Lane state is
//! carried forward, so lanes stay continuous across the join.

use git2::{Repository, Sort};
use serde::{Deserialize, Serialize};

use super::lanes::{self, LaneState, Segment};
use super::refs::{self, GitRef};

/// Upper bound on commits held in memory. Roughly 25× the previous 10,000-commit
/// cap: high enough that real repositories load in full, low enough to bound
/// memory on pathological histories.
pub const MAX_COMMITS: usize = 250_000;

/// Commits walked before the first page is served.
pub const FIRST_CHUNK: usize = 4_000;

/// Default page size handed to the frontend.
pub const DEFAULT_PAGE_SIZE: usize = 2_000;

#[derive(Debug, Clone, Serialize)]
pub struct GraphRow {
    pub sha: String,
    pub short_sha: String,
    pub message: String,
    pub author_name: String,
    pub author_email: String,
    pub author_timestamp: i64,
    pub refs: Vec<GitRef>,
    pub lane: usize,
    pub color: usize,
    pub segments: Vec<Segment>,
    pub parent_shas: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct GraphPage {
    pub rows: Vec<GraphRow>,
    /// Opaque resume token; `None` once history is exhausted.
    pub cursor: Option<String>,
    /// Widest lane index used by this page, 1-based — the frontend sizes the
    /// graph column from the window it is actually showing.
    pub lane_count: usize,
    /// Rows walked so far. Grows while history is still being read.
    pub total: usize,
    /// Set when the walk hit `MAX_COMMITS`.
    pub truncated: bool,
    /// False while more history remains to be walked.
    pub complete: bool,
}

/// Which refs the walk starts from.
///
/// A filter is part of the snapshot's identity, not a view applied afterwards:
/// lanes are assigned during the walk, so a graph of two branches has to be
/// *walked* as two branches. Filtering rows after the fact would leave lines
/// running to commits that are no longer there.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphFilter {
    /// Branches to seed the walk with; empty means every ref in the repository.
    #[serde(default)]
    pub branches: Vec<String>,
    /// Whether remote-tracking branches are walked and labelled at all.
    #[serde(default = "yes")]
    pub include_remotes: bool,
}

fn yes() -> bool {
    true
}

impl Default for GraphFilter {
    fn default() -> Self {
        Self { branches: Vec::new(), include_remotes: true }
    }
}

pub struct GraphSnapshot {
    pub rows: Vec<GraphRow>,
    pub truncated: bool,
    /// Lane assignment state at the end of `rows`, so the walk can continue.
    lanes: LaneState,
    /// True when the walk reached the end of history (or the cap).
    complete: bool,
    /// The filter these rows were walked under. A snapshot taken under one
    /// filter cannot answer for another, so the cache compares this.
    filter: GraphFilter,
}

struct Walked {
    sha: String,
    parents: Vec<String>,
}

impl lanes::CommitNode for Walked {
    fn id(&self) -> &str {
        &self.sha
    }
    fn parents(&self) -> &[String] {
        &self.parents
    }
}

fn revwalk<'r>(repo: &'r Repository, filter: &GraphFilter) -> Result<git2::Revwalk<'r>, String> {
    let mut revwalk = repo.revwalk().map_err(|e| e.to_string())?;
    // Topological order keeps ancestry readable; the time bias keeps recent
    // work at the top the way every other git UI presents it.
    revwalk.set_sorting(Sort::TOPOLOGICAL | Sort::TIME).map_err(|e| e.to_string())?;

    if filter.branches.is_empty() {
        // Seeding from every ref (not just HEAD) is what makes unmerged
        // branches visible. `push_glob` covers packed and loose refs alike.
        let _ = revwalk.push_head();
        let _ = revwalk.push_glob("refs/heads/*");
        if filter.include_remotes {
            let _ = revwalk.push_glob("refs/remotes/*");
        }
        let _ = revwalk.push_glob("refs/tags/*");
        return Ok(revwalk);
    }

    // A named branch may be local or remote-tracking, and the picker offers
    // both under their display names ("main", "origin/main"). Try each in
    // turn; a name that resolves to nothing is a branch that was deleted since
    // the filter was saved, and is simply not walked.
    for name in &filter.branches {
        let mut candidates = vec![format!("refs/heads/{name}")];
        if filter.include_remotes {
            candidates.push(format!("refs/remotes/{name}"));
        }
        for full_name in candidates {
            let Ok(reference) = repo.find_reference(&full_name) else { continue };
            if let Ok(commit) = reference.peel_to_commit() {
                let _ = revwalk.push(commit.id());
                break;
            }
        }
    }
    Ok(revwalk)
}

impl GraphSnapshot {
    /// Walk the first chunk of history.
    pub fn build(repo: &Repository, filter: GraphFilter) -> Result<Self, String> {
        Self::build_chunked(repo, filter, FIRST_CHUNK)
    }

    /// Walk `first` commits. Tests use a small chunk to exercise the partial
    /// state that a large repository reaches naturally.
    pub fn build_chunked(
        repo: &Repository,
        filter: GraphFilter,
        first: usize,
    ) -> Result<Self, String> {
        let empty = Self {
            rows: Vec::new(),
            truncated: false,
            lanes: LaneState::default(),
            complete: false,
            filter,
        };
        empty.extended(repo, first)
    }

    /// The filter these rows were walked under.
    pub fn filter(&self) -> &GraphFilter {
        &self.filter
    }

    /// A copy of this snapshot walked out to at least `wanted` rows.
    pub fn extended(&self, repo: &Repository, wanted: usize) -> Result<Self, String> {
        if self.complete {
            return Ok(self.clone_shallow());
        }

        let target = wanted.min(MAX_COMMITS);
        let already = self.rows.len();
        let refs_map = refs::build_map(repo).map_err(|e| e.to_string())?;

        let mut rows = self.rows.clone();
        let mut state = self.lanes.clone();
        let mut walked = 0usize;
        let mut complete = true;
        let mut truncated = self.truncated;

        for oid in revwalk(repo, &self.filter)? {
            // Skip what previous passes already turned into rows. Walking an
            // id without reading its commit is the cheap part.
            if walked < already {
                walked += 1;
                continue;
            }
            if rows.len() >= MAX_COMMITS {
                truncated = true;
                break;
            }
            if rows.len() >= target {
                complete = false;
                break;
            }

            let Ok(oid) = oid else { continue };
            let Ok(commit) = repo.find_commit(oid) else { continue };

            let parents: Vec<String> = commit.parent_ids().map(|id| id.to_string()).collect();
            let sha = oid.to_string();
            let layout = state.place(&Walked { sha: sha.clone(), parents: parents.clone() });
            let author = commit.author();

            // With remotes hidden, an `origin/main` badge would label a branch
            // the graph is not showing — the walk skipped it as a seed, so the
            // row must not claim it either.
            let mut row_refs = refs_map.get(&oid).cloned().unwrap_or_default();
            if !self.filter.include_remotes {
                row_refs.retain(|entry| !matches!(entry, GitRef::RemoteBranch { .. }));
            }

            rows.push(GraphRow {
                short_sha: sha[..7.min(sha.len())].to_string(),
                message: commit.summary().unwrap_or_default().to_string(),
                author_name: author.name().unwrap_or_default().to_string(),
                author_email: author.email().unwrap_or_default().to_string(),
                author_timestamp: author.when().seconds(),
                refs: row_refs,
                lane: layout.lane,
                color: layout.color,
                segments: layout.segments,
                parent_shas: parents,
                sha,
            });
            walked += 1;
        }

        Ok(Self { rows, truncated, lanes: state, complete, filter: self.filter.clone() })
    }

    fn clone_shallow(&self) -> Self {
        Self {
            rows: self.rows.clone(),
            truncated: self.truncated,
            lanes: self.lanes.clone(),
            complete: self.complete,
            filter: self.filter.clone(),
        }
    }

    pub fn is_complete(&self) -> bool {
        self.complete
    }

    /// Slice a page starting at `cursor` (an offset token; `None` starts over).
    pub fn page(&self, cursor: Option<&str>, limit: usize) -> Result<GraphPage, String> {
        let start = match cursor {
            None | Some("") => 0,
            Some(value) => value.parse::<usize>().map_err(|_| "Invalid cursor".to_string())?,
        };
        let start = start.min(self.rows.len());
        let limit = limit.clamp(1, DEFAULT_PAGE_SIZE * 5);
        let end = (start + limit).min(self.rows.len());
        let rows = self.rows[start..end].to_vec();

        let lane_count = rows
            .iter()
            .map(|row| {
                row.segments
                    .iter()
                    .fold(row.lane + 1, |max, s| max.max(s.from + 1).max(s.to + 1))
            })
            .max()
            .unwrap_or(1);

        // More history exists when this page ends short of what is walked, or
        // when the walk itself has not finished.
        let more = end < self.rows.len() || !self.complete;

        Ok(GraphPage {
            rows,
            cursor: more.then(|| end.to_string()),
            lane_count,
            total: self.rows.len(),
            truncated: self.truncated,
            complete: self.complete,
        })
    }
}
