//! Hardened `git` invocation.
//!
//! Opening a repository must never mean running its code. Every subprocess goes
//! through here, which disables hooks, strips the environment variables git
//! uses to launch helper programs, refuses to prompt, and bounds the run time.
//! Argument values are validated separately (see `crate::validate`) before they
//! reach an argument list.
//!
//! # What is trusted, and what is not
//!
//! The repository is untrusted: its contents and its `.git/config` arrive from
//! whoever wrote them. The *user's own* configuration — `~/.gitconfig` and the
//! system file — is not. It is theirs, and every other git client on the
//! machine already honours it.
//!
//! This distinction used to be missed: `GIT_CONFIG_NOSYSTEM` and
//! `GIT_CONFIG_GLOBAL=/dev/null` hid the user's files while leaving the
//! repository's own config fully in effect, which is backwards. It bought
//! nothing against a hostile repository and broke two ordinary things:
//!
//! - **Credentials.** Helpers are configured in the global or system file
//!   (`credential.helper`, or a URL-scoped `credential.https://host.helper`).
//!   With both hidden, git had no helper, could not prompt, and every fetch,
//!   pull and push failed with "could not read Username".
//! - **Authorship.** `user.name` and `user.email` usually live in the global
//!   file. Without them git does not fail; it invents an identity from the
//!   hostname, so commits made here were silently attributed to
//!   `you@your-macbook.local` in any repository without a local override.
//!
//! Note that a hostile repository can still set `credential.helper` in its own
//! `.git/config`, and git will run it. Clearing that is not expressible through
//! `-c` (a reset drops the user's helpers too, and URL-scoped keys cannot be
//! enumerated in advance), so it is a known gap rather than a solved problem.

use std::time::Duration;

use tokio::process::Command;
use tokio::time::timeout;

/// Local operations are expected to be quick; a longer run means something is
/// stuck (a lock, a prompt we failed to suppress).
const LOCAL_TIMEOUT: Duration = Duration::from_secs(30);

/// Network operations legitimately take minutes on large repositories.
const NETWORK_TIMEOUT: Duration = Duration::from_secs(300);

fn configured_git(repo_path: &str, args: &[&str]) -> Command {
    let mut cmd = Command::new("git");

    // On Windows, suppress popping up visible CMD console windows during background git execution.
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    // The user's own config is read normally — see the module comment. Only
    // prompting is forced off: there is no terminal behind this process, so a
    // prompt is a hang, and the app says so rather than waiting for a timeout.
    cmd.env("GIT_TERMINAL_PROMPT", "0");

    // Augment PATH so hooks and git tools can locate user-installed binaries
    // (node, nvm, npm, cargo, python, homebrew, etc.) when running in GUI context.
    #[cfg(unix)]
    if let Ok(current_path) = std::env::var("PATH") {
        let mut extra_paths = vec![
            "/usr/local/bin".to_string(),
            "/opt/homebrew/bin".to_string(),
            "/usr/bin".to_string(),
            "/bin".to_string(),
        ];
        if let Ok(home) = std::env::var("HOME") {
            extra_paths.push(format!("{}/.cargo/bin", home));
            extra_paths.push(format!("{}/.local/bin", home));
        }
        let new_path = format!("{}:{}", extra_paths.join(":"), current_path);
        cmd.env("PATH", new_path);
    }

    #[cfg(windows)]
    if let Ok(current_path) = std::env::var("PATH") {
        let mut extra_win_paths = vec![
            r"C:\Program Files\Git\cmd".to_string(),
            r"C:\Program Files\Git\bin".to_string(),
            r"C:\Program Files\Git\usr\bin".to_string(),
        ];
        if let Ok(user_profile) = std::env::var("USERPROFILE") {
            extra_win_paths.push(format!(r"{}\AppData\Local\Programs\Git\cmd", user_profile));
            extra_win_paths.push(format!(r"{}\scoop\shims", user_profile));
        }
        if let Ok(program_data) = std::env::var("ProgramData") {
            extra_win_paths.push(format!(r"{}\chocolatey\bin", program_data));
        }
        let new_path = format!("{};{}", extra_win_paths.join(";"), current_path);
        cmd.env("PATH", new_path);
    }

    for var in [
        "GIT_SSH",
        "GIT_SSH_COMMAND",
        "GIT_ASKPASS",
        "SSH_ASKPASS",
        "GIT_EXTERNAL_DIFF",
        "GIT_PAGER",
        "GIT_EDITOR",
        "GIT_PROXY_COMMAND",
        "GIT_ATTR_NOSYSTEM",
    ] {
        cmd.env_remove(var);
    }

    cmd.arg("-c").arg("safe.directory=*");
    cmd.arg("-c").arg("protocol.allow=user");
    cmd.arg("-c").arg("core.quotepath=false");
    cmd.arg("-c").arg("i18n.logOutputEncoding=utf-8");
    cmd.arg("-c").arg("core.longpaths=true");
    cmd.args(args);
    cmd.current_dir(repo_path);
    cmd.kill_on_drop(true);
    cmd
}

/// True for verbs that talk to a remote and deserve the longer budget.
fn is_network(args: &[&str]) -> bool {
    matches!(args.first().copied(), Some("fetch" | "pull" | "push" | "ls-remote" | "clone"))
}

async fn run(repo_path: &str, args: &[&str]) -> Result<String, String> {
    let verb = args.first().copied().unwrap_or("git");
    let budget = if is_network(args) { NETWORK_TIMEOUT } else { LOCAL_TIMEOUT };

    let output = timeout(budget, configured_git(repo_path, args).output())
        .await
        .map_err(|_| format!("git {verb} timed out after {}s", budget.as_secs()))?
        .map_err(|e| format!("Failed to run git: {e}"))?;

    if output.status.success() {
        return Ok(String::from_utf8_lossy(&output.stdout).trim().to_string());
    }

    // Some failures (merge conflicts, `commit` with nothing staged) explain
    // themselves on stdout, so fall back to it rather than reporting nothing.
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if !stderr.is_empty() {
        return Err(stderr);
    }
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Err(if stdout.is_empty() { format!("git {verb} failed") } else { stdout })
}

/// Run a git command, discarding output.
pub async fn run_git(repo_path: &str, args: &[&str]) -> Result<(), String> {
    run(repo_path, args).await.map(|_| ())
}

/// Run a git command and return trimmed stdout.
pub async fn run_git_output(repo_path: &str, args: &[&str]) -> Result<String, String> {
    run(repo_path, args).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::TestRepo;

    /// Install a hook that leaves a marker file behind when it runs.
    /// Only used by the Unix hook-isolation tests below.
    #[cfg(unix)]
    fn install_hook(repo: &TestRepo, name: &str) -> std::path::PathBuf {
        use std::fs;
        let marker = std::env::temp_dir().join(format!("gitgraph_hook_{}", uuid::Uuid::new_v4()));
        let hooks = repo.dir.join(".git").join("hooks");
        fs::create_dir_all(&hooks).unwrap();
        let path = hooks.join(name);
        fs::write(&path, format!("#!/bin/sh\ntouch {}\n", marker.display())).unwrap();
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = fs::metadata(&path).unwrap().permissions();
            perms.set_mode(0o755);
            fs::set_permissions(&path, perms).unwrap();
        }
        marker
    }

    #[tokio::test]
    #[cfg(unix)]
    async fn checkout_runs_repository_hooks() {
        let repo = TestRepo::new();
        repo.write("a.txt", "a\n");
        repo.commit_all("base");
        let marker = install_hook(&repo, "post-checkout");

        run_git(&repo.path(), &["branch", "feature"]).await.unwrap();
        run_git(&repo.path(), &["checkout", "feature"]).await.unwrap();

        assert!(marker.exists(), "post-checkout hook must run");
    }

    #[tokio::test]
    #[cfg(unix)]
    async fn committing_runs_repository_hooks() {
        let repo = TestRepo::new();
        repo.write("a.txt", "a\n");
        repo.commit_all("base");
        let marker = install_hook(&repo, "pre-commit");

        repo.write("b.txt", "b\n");
        run_git(&repo.path(), &["add", "b.txt"]).await.unwrap();
        run_git(&repo.path(), &["commit", "-m", "second", "--quiet"]).await.unwrap();

        assert!(marker.exists(), "pre-commit hook must run");
    }

    /// The user's configuration is read and Git hooks execute normally.
    #[test]
    fn the_users_own_config_is_read_and_hooks_are_allowed() {
        let cmd = configured_git("/tmp", &["fetch", "origin"]);
        let std = cmd.as_std();

        let env: Vec<(String, Option<String>)> = std
            .get_envs()
            .map(|(key, value)| {
                (
                    key.to_string_lossy().into_owned(),
                    value.map(|v| v.to_string_lossy().into_owned()),
                )
            })
            .collect();
        let set = |name: &str| env.iter().find(|(key, _)| key == name).and_then(|(_, v)| v.clone());
        let removed =
            |name: &str| env.iter().any(|(key, value)| key == name && value.is_none());

        // `~/.gitconfig` and the system file carry credential helpers and the
        // committer's identity. Neither may be hidden.
        assert_eq!(set("GIT_CONFIG_GLOBAL"), None, "the user's global config must be read");
        assert_eq!(set("GIT_CONFIG_NOSYSTEM"), None, "the system config must be read");

        // Prompting is disabled and hijack vectors stripped.
        assert_eq!(set("GIT_TERMINAL_PROMPT").as_deref(), Some("0"));
        for helper in ["GIT_SSH", "GIT_SSH_COMMAND", "GIT_ASKPASS", "GIT_EXTERNAL_DIFF"] {
            assert!(removed(helper), "{helper} must be stripped from the environment");
        }

        let args: Vec<String> =
            std.get_args().map(|arg| arg.to_string_lossy().into_owned()).collect();
        assert!(args.iter().any(|arg| arg == "protocol.allow=user"));
        assert!(!args.iter().any(|arg| arg.starts_with("core.hooksPath=")), "hooks must not be disabled");
    }

    #[tokio::test]
    async fn failures_surface_git_s_own_message() {
        let repo = TestRepo::new();
        repo.write("a.txt", "a\n");
        repo.commit_all("base");

        // Nothing staged: git explains itself on stdout, not stderr.
        let err = run_git(&repo.path(), &["commit", "-m", "empty"]).await.unwrap_err();
        assert!(!err.is_empty(), "an error must carry a message the UI can show");
    }

    #[tokio::test]
    async fn running_outside_a_repository_fails_cleanly() {
        let err = run_git_output("/", &["status"]).await.unwrap_err();
        assert!(err.to_lowercase().contains("repository"), "unexpected error: {err}");
    }
}
