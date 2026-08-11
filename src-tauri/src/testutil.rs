//! Throwaway git repositories for tests.
//!
//! Tests drive real git rather than mocks: the behaviour under test *is* the
//! interaction with git, so a fake would only assert our own assumptions.

#![cfg(test)]

use std::fs;
use std::path::PathBuf;
use std::process::Command;

pub struct TestRepo {
    pub dir: PathBuf,
}

impl TestRepo {
    pub fn new() -> Self {
        let dir = std::env::temp_dir().join(format!("gitgraph_test_{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).expect("create temp repo");
        let repo = Self { dir };
        repo.git(&["init", "--quiet", "--initial-branch=main"]);
        repo.git(&["config", "user.email", "test@example.com"]);
        repo.git(&["config", "user.name", "Test User"]);
        repo.git(&["config", "commit.gpgsign", "false"]);
        repo
    }

    pub fn git(&self, args: &[&str]) -> String {
        let output = Command::new("git")
            .args(args)
            .current_dir(&self.dir)
            .output()
            .unwrap_or_else(|e| panic!("git {args:?} failed to start: {e}"));
        assert!(
            output.status.success(),
            "git {args:?} failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8_lossy(&output.stdout).trim().to_string()
    }

    pub fn path(&self) -> String {
        self.dir.to_string_lossy().to_string()
    }

    pub fn open(&self) -> git2::Repository {
        git2::Repository::open(&self.dir).expect("open repo")
    }

    pub fn write(&self, name: &str, contents: &str) {
        self.write_bytes(name, contents.as_bytes());
    }

    pub fn write_bytes(&self, name: &str, contents: &[u8]) {
        let path = self.dir.join(name);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("create parent dir");
        }
        fs::write(path, contents).expect("write file");
    }

    pub fn remove(&self, name: &str) {
        fs::remove_file(self.dir.join(name)).expect("remove file");
    }

    pub fn rename(&self, from: &str, to: &str) {
        fs::rename(self.dir.join(from), self.dir.join(to)).expect("rename file");
    }


    /// Stage everything and commit; returns the new commit's sha.
    pub fn commit_all(&self, message: &str) -> String {
        self.git(&["add", "-A"]);
        self.git(&["commit", "-m", message, "--quiet"]);
        self.head_sha()
    }

    pub fn head_sha(&self) -> String {
        self.git(&["rev-parse", "HEAD"])
    }

    pub fn branch(&self, name: &str) {
        self.git(&["checkout", "-q", "-b", name]);
    }

    pub fn checkout(&self, name: &str) {
        self.git(&["checkout", "-q", name]);
    }
}

impl Drop for TestRepo {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.dir);
    }
}
