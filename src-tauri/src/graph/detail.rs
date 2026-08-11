//! Per-commit detail.
//!
//! The graph row carries only the summary line — one string per commit, for a
//! list that can hold a quarter of a million of them. The full message and the
//! rest of the metadata are fetched when a commit is actually opened.

use git2::{Oid, Repository};
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct CommitDetail {
    pub sha: String,
    /// Summary line, repeated here so the panel does not depend on the row.
    pub summary: String,
    /// Everything after the summary, blank when the message is one line.
    pub body: String,
    pub author_name: String,
    pub author_email: String,
    pub author_timestamp: i64,
    pub committer_name: String,
    pub committer_email: String,
    pub committer_timestamp: i64,
    /// True when the commit was authored by one person and committed by
    /// another — a rebase, a patch applied on someone's behalf.
    pub committed_by_other: bool,
    pub parent_shas: Vec<String>,
}

pub fn load(repo: &Repository, sha: &str) -> Result<CommitDetail, String> {
    let oid = Oid::from_str(sha).map_err(|e| e.to_string())?;
    let commit = repo.find_commit(oid).map_err(|e| e.to_string())?;

    let author = commit.author();
    let committer = commit.committer();
    let author_name = author.name().unwrap_or_default().to_string();
    let author_email = author.email().unwrap_or_default().to_string();
    let committer_name = committer.name().unwrap_or_default().to_string();
    let committer_email = committer.email().unwrap_or_default().to_string();

    Ok(CommitDetail {
        sha: commit.id().to_string(),
        summary: commit.summary().unwrap_or_default().to_string(),
        body: commit.body().unwrap_or_default().trim_end().to_string(),
        committed_by_other: committer_email != author_email,
        author_name,
        author_email,
        author_timestamp: author.when().seconds(),
        committer_name,
        committer_email,
        committer_timestamp: committer.when().seconds(),
        parent_shas: commit.parent_ids().map(|id| id.to_string()).collect(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::TestRepo;

    #[test]
    fn carries_the_message_body_the_row_does_not() {
        let repo = TestRepo::new();
        repo.write("a.txt", "a\n");
        repo.git(&["add", "-A"]);
        repo.git(&[
            "commit",
            "-m",
            "Summary line",
            "-m",
            "Why this change was made.\n\nRefs: #42",
            "--quiet",
        ]);

        let detail = load(&repo.open(), &repo.head_sha()).unwrap();
        assert_eq!(detail.summary, "Summary line");
        assert!(detail.body.contains("Why this change was made."));
        assert!(detail.body.contains("Refs: #42"));
        assert!(!detail.committed_by_other);
    }

    #[test]
    fn a_one_line_message_has_no_body() {
        let repo = TestRepo::new();
        repo.write("a.txt", "a\n");
        let sha = repo.commit_all("Just the summary");

        let detail = load(&repo.open(), &sha).unwrap();
        assert_eq!(detail.summary, "Just the summary");
        assert_eq!(detail.body, "");
    }

    #[test]
    fn notices_when_the_committer_is_not_the_author() {
        let repo = TestRepo::new();
        repo.write("a.txt", "a\n");
        repo.git(&["add", "-A"]);
        repo.git(&[
            "-c",
            "user.name=Committer",
            "-c",
            "user.email=committer@example.com",
            "commit",
            "-m",
            "Applied on behalf of someone else",
            "--author=Ada <ada@example.com>",
            "--quiet",
        ]);

        let detail = load(&repo.open(), &repo.head_sha()).unwrap();
        assert_eq!(detail.author_email, "ada@example.com");
        assert_eq!(detail.committer_email, "committer@example.com");
        assert!(detail.committed_by_other);
    }
}
