//! Input validation for anything that reaches a `git` argument list.
//!
//! Everything crossing the IPC boundary is untrusted: a repository on disk can
//! carry attacker-chosen ref and path names. These validators run before any
//! value is handed to git, rejecting argument injection (`-…`), git's own
//! special-ref syntax (`@{`, `^`, `..`), and control characters.

/// Validate a git ref name (branch, tag, remote-tracking name).
pub fn ref_name(name: &str) -> Result<(), String> {
    if name.is_empty() {
        return Err("Ref name cannot be empty".to_string());
    }
    if name.len() > 255 {
        return Err("Ref name too long (max 255 chars)".to_string());
    }
    if name.starts_with('-') || name.starts_with('.') || name.starts_with('/') {
        return Err(format!("Invalid ref name: '{name}'"));
    }
    if name.ends_with(".lock") || name.ends_with('.') || name.ends_with('/') {
        return Err(format!("Invalid ref name: '{name}'"));
    }
    for bad in ["..", "@{", "//", "\\"] {
        if name.contains(bad) {
            return Err(format!("Invalid ref name contains '{bad}': '{name}'"));
        }
    }
    for &c in b"~^:?*[\x7f" {
        if name.bytes().any(|b| b == c) {
            return Err(format!("Invalid ref name: contains '{}'", c as char));
        }
    }
    if name.bytes().any(|b| b < 0x20) {
        return Err("Ref name contains control characters".to_string());
    }
    Ok(())
}

/// Validate a repo-relative path used as a git pathspec.
pub fn repo_path(path: &str) -> Result<(), String> {
    if path.is_empty() {
        return Err("Path cannot be empty".to_string());
    }
    if path.len() > 4096 {
        return Err("Path too long".to_string());
    }
    if path.starts_with('-') {
        return Err(format!("Path cannot start with '-': '{path}'"));
    }
    if path.starts_with('/') || (path.len() >= 2 && path.as_bytes()[1] == b':') {
        return Err(format!("Absolute path not allowed: '{path}'"));
    }
    if path.split('/').any(|seg| seg == "..") {
        return Err(format!("Path traversal not allowed: '{path}'"));
    }
    if path.bytes().any(|b| b == 0 || b == b'\n' || b == b'\r') {
        return Err("Path contains invalid characters".to_string());
    }
    Ok(())
}

/// Validate an object id: hex, 4–64 characters.
pub fn sha(value: &str) -> Result<(), String> {
    if value.len() < 4 || value.len() > 64 {
        return Err(format!("Invalid SHA length: {}", value.len()));
    }
    if !value.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("SHA must contain only hexadecimal characters".to_string());
    }
    Ok(())
}

/// Validate a free-text message (commit, tag, stash) against a byte budget.
pub fn message(value: &str, max_len: usize, label: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        return Err(format!("{label} cannot be empty"));
    }
    if value.len() > max_len {
        return Err(format!("{label} too long (max {max_len} bytes)"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ref_names_reject_injection_and_git_syntax() {
        for bad in [
            "", "-rf", ".hidden", "/abs", "foo.lock", "foo.", "bar/", "a..b", "foo@{1}", "a//b",
            "back\\slash", "foo~1", "HEAD^", "foo:bar", "foo?", "foo*", "foo[1]", "ctrl\u{1}",
        ] {
            assert!(ref_name(bad).is_err(), "expected rejection: {bad:?}");
        }
        assert!(ref_name(&"x".repeat(256)).is_err());
    }

    #[test]
    fn ref_names_accept_ordinary_branches() {
        for good in ["main", "feature/login", "release-1.2.3", "user/fix.bug", "origin/main"] {
            assert!(ref_name(good).is_ok(), "expected acceptance: {good}");
        }
    }

    #[test]
    fn paths_reject_escape_and_flags() {
        for bad in ["", "-force", "/etc/passwd", "C:/win", "../etc/passwd", "src/../../x", "a\nb", "a\0b"] {
            assert!(repo_path(bad).is_err(), "expected rejection: {bad:?}");
        }
    }

    #[test]
    fn paths_accept_nested_names() {
        for good in ["src/main.rs", "docs/a b c.txt", "a..b/file.txt"] {
            assert!(repo_path(good).is_ok(), "expected acceptance: {good}");
        }
    }

    #[test]
    fn shas_must_be_hex() {
        assert!(sha("abc").is_err());
        assert!(sha("zzzz").is_err());
        assert!(sha(&"a".repeat(65)).is_err());
        assert!(sha("deadbeef").is_ok());
    }

    #[test]
    fn messages_respect_budget() {
        assert!(message("  ", 10, "Commit message").is_err());
        assert!(message("hello world", 5, "Commit message").is_err());
        assert!(message("ok", 10, "Commit message").is_ok());
    }
}
