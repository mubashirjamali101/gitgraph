use serde::Serialize;
use std::path::Path;

#[derive(Debug, Clone, Serialize)]
pub struct DiscoveredRepo {
    pub path: String,
    pub name: String,
}

pub fn scan_for_repos(root_path: &str) -> Result<Vec<DiscoveredRepo>, String> {
    let root = Path::new(root_path);
    if !root.exists() {
        return Err("Path does not exist".to_string());
    }

    let mut repos = Vec::new();

    // Check if root itself is a git repo
    if is_git_repo(root) {
        if let Some(name) = root.file_name() {
            repos.push(DiscoveredRepo {
                path: root_path.to_string(),
                name: name.to_string_lossy().to_string(),
            });
        }
        return Ok(repos);
    }

    // Scan immediate children (one level nested)
    if let Ok(entries) = std::fs::read_dir(root) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() && is_git_repo(&path) {
                if let Some(name) = path.file_name() {
                    repos.push(DiscoveredRepo {
                        path: path.to_string_lossy().to_string(),
                        name: name.to_string_lossy().to_string(),
                    });
                }
            }
        }
    }

    repos.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(repos)
}

fn is_git_repo(path: &Path) -> bool {
    let git_dir = path.join(".git");
    git_dir.exists() && (git_dir.is_dir() || git_dir.is_file())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    fn create_test_repo_structure() -> PathBuf {
        let temp_dir = std::env::temp_dir().join(format!("gitgraph_test_{}", uuid::Uuid::new_v4()));
        let _ = fs::remove_dir_all(&temp_dir);
        fs::create_dir_all(&temp_dir).unwrap();

        // Create repos at one level nested
        fs::create_dir(temp_dir.join("repo1")).unwrap();
        fs::create_dir(temp_dir.join("repo1/.git")).unwrap();

        fs::create_dir(temp_dir.join("repo2")).unwrap();
        fs::create_dir(temp_dir.join("repo2/.git")).unwrap();

        // Create non-repo directory
        fs::create_dir(temp_dir.join("not_a_repo")).unwrap();

        temp_dir
    }

    fn cleanup_test_repo(path: &PathBuf) {
        let _ = fs::remove_dir_all(path);
    }

    #[test]
    fn test_scan_finds_direct_repos() {
        let temp_dir = create_test_repo_structure();
        let result = scan_for_repos(temp_dir.to_str().unwrap()).unwrap();

        cleanup_test_repo(&temp_dir);

        assert_eq!(result.len(), 2);
        assert!(result.iter().any(|r| r.name == "repo1"));
        assert!(result.iter().any(|r| r.name == "repo2"));
    }

    #[test]
    fn test_scan_finds_one_level_nested_repos() {
        let temp_dir = std::env::temp_dir().join(format!("gitgraph_nested_{}", uuid::Uuid::new_v4()));
        let _ = fs::remove_dir_all(&temp_dir);
        fs::create_dir_all(&temp_dir).unwrap();

        // Create repos at one level nested
        fs::create_dir(temp_dir.join("project1")).unwrap();
        fs::create_dir(temp_dir.join("project1/.git")).unwrap();

        fs::create_dir(temp_dir.join("project2")).unwrap();
        fs::create_dir(temp_dir.join("project2/.git")).unwrap();

        let result = scan_for_repos(temp_dir.to_str().unwrap()).unwrap();

        cleanup_test_repo(&temp_dir);

        assert_eq!(result.len(), 2);
        assert!(result.iter().any(|r| r.name == "project1"));
        assert!(result.iter().any(|r| r.name == "project2"));
    }

    #[test]
    fn test_scan_excludes_non_repos() {
        let temp_dir = create_test_repo_structure();
        let result = scan_for_repos(temp_dir.to_str().unwrap()).unwrap();

        cleanup_test_repo(&temp_dir);

        assert!(!result.iter().any(|r| r.name == "not_a_repo"));
    }

    #[test]
    fn test_scan_returns_sorted_repos() {
        let temp_dir = create_test_repo_structure();
        let result = scan_for_repos(temp_dir.to_str().unwrap()).unwrap();

        cleanup_test_repo(&temp_dir);

        // Check that results are sorted by name
        for i in 0..result.len() - 1 {
            assert!(result[i].name <= result[i + 1].name);
        }
    }

    #[test]
    fn test_scan_invalid_path() {
        let result = scan_for_repos("/nonexistent/path/to/repos");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("does not exist"));
    }

    #[test]
    fn test_scan_detects_single_repo_at_root() {
        let temp_dir = std::env::temp_dir().join(format!("gitgraph_single_{}", uuid::Uuid::new_v4()));
        let _ = fs::remove_dir_all(&temp_dir);
        fs::create_dir_all(&temp_dir).unwrap();
        fs::create_dir(temp_dir.join(".git")).unwrap();

        let result = scan_for_repos(temp_dir.to_str().unwrap()).unwrap();

        fs::remove_dir_all(&temp_dir).unwrap();

        assert_eq!(result.len(), 1);
        assert!(result[0].path.ends_with(temp_dir.file_name().unwrap().to_str().unwrap()));
    }

    #[test]
    fn test_is_git_repo_with_directory() {
        let temp_dir = std::env::temp_dir().join(format!("gitgraph_isrepo_{}", uuid::Uuid::new_v4()));
        let _ = fs::remove_dir_all(&temp_dir);
        fs::create_dir_all(&temp_dir).unwrap();
        fs::create_dir(temp_dir.join(".git")).unwrap();

        assert!(is_git_repo(&temp_dir));

        fs::remove_dir_all(&temp_dir).unwrap();
    }

    #[test]
    fn test_is_git_repo_with_file() {
        let temp_dir = std::env::temp_dir().join(format!("gitgraph_isrepofile_{}", uuid::Uuid::new_v4()));
        let _ = fs::remove_dir_all(&temp_dir);
        fs::create_dir(&temp_dir).unwrap();
        fs::File::create(temp_dir.join(".git")).unwrap();

        assert!(is_git_repo(&temp_dir));

        fs::remove_dir_all(&temp_dir).unwrap();
    }

    #[test]
    fn test_is_git_repo_not_found() {
        let temp_dir = std::env::temp_dir().join(format!("gitgraph_notrepo_{}", uuid::Uuid::new_v4()));
        let _ = fs::remove_dir_all(&temp_dir);
        fs::create_dir(&temp_dir).unwrap();

        assert!(!is_git_repo(&temp_dir));

        fs::remove_dir_all(&temp_dir).unwrap();
    }

    #[test]
    fn test_pick_and_scan_flow() {
        // Integration test: user picks dir → we scan it
        let temp_dir = std::env::temp_dir().join(format!("gitgraph_flow_{}", uuid::Uuid::new_v4()));
        let _ = fs::remove_dir_all(&temp_dir);
        fs::create_dir_all(&temp_dir).unwrap();

        // Create test repos (simulating what user would have)
        fs::create_dir(temp_dir.join("my_project")).unwrap();
        fs::create_dir(temp_dir.join("my_project/.git")).unwrap();

        fs::create_dir(temp_dir.join("another_project")).unwrap();
        fs::create_dir(temp_dir.join("another_project/.git")).unwrap();

        // Simulate the full flow: pick returns path, scan processes it
        let path_str = temp_dir.to_str().unwrap();
        let result = scan_for_repos(path_str);

        fs::remove_dir_all(&temp_dir).unwrap();

        assert!(result.is_ok());
        let repos = result.unwrap();
        assert_eq!(repos.len(), 2);
        assert!(repos.iter().any(|r| r.name == "my_project"));
        assert!(repos.iter().any(|r| r.name == "another_project"));
    }

    #[test]
    fn test_pick_empty_directory() {
        // Test scanning empty directory (no repos)
        let temp_dir = std::env::temp_dir().join(format!("gitgraph_empty_{}", uuid::Uuid::new_v4()));
        let _ = fs::remove_dir_all(&temp_dir);
        fs::create_dir_all(&temp_dir).unwrap();

        let result = scan_for_repos(temp_dir.to_str().unwrap());

        fs::remove_dir_all(&temp_dir).unwrap();

        assert!(result.is_ok());
        let repos = result.unwrap();
        assert_eq!(repos.len(), 0);
    }

    #[test]
    fn test_pick_nonexistent_directory() {
        // Test error handling for nonexistent directory
        let result = scan_for_repos("/this/path/definitely/does/not/exist/anywhere");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("does not exist"));
    }
}
