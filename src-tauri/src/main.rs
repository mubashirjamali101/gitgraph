// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod diff;
mod graph;
mod repo;
mod safe_cmd;
mod scan;
mod testutil;
mod validate;
mod watch;
mod worktree;

use std::sync::Arc;

use repo::Registry;

fn main() {
    tauri::Builder::default()
        .manage(Arc::new(Registry::new()))
        .invoke_handler(tauri::generate_handler![
            // repositories
            commands::repo::pick_directory,
            commands::repo::scan_repos,
            commands::repo::open_repo,
            commands::repo::close_repo,
            commands::repo::repo_status,
            // graph & commits
            commands::graph::graph_page,
            commands::graph::commit_files,
            commands::graph::commit_file_diff,
            commands::graph::commit_detail,
            commands::refs_list::list_refs,
            // working tree
            commands::worktree::working_tree,
            commands::worktree::worktree_file_diff,
            commands::worktree::stage_file,
            commands::worktree::unstage_file,
            commands::worktree::stage_all,
            commands::worktree::unstage_all,
            commands::worktree::discard_file,
            commands::worktree::commit_staged,
            commands::worktree::amend_commit,
            commands::worktree::user_email,
            // branches, tags, history editing
            commands::refs::checkout,
            commands::refs::create_branch,
            commands::refs::rename_branch,
            commands::refs::delete_branch,
            commands::refs::create_tag,
            commands::refs::delete_tag,
            commands::refs::merge,
            commands::refs::rebase,
            commands::refs::cherry_pick,
            commands::refs::reset,
            commands::refs::revert,
            // remotes
            commands::remote::fetch_all,
            commands::remote::fetch_branch,
            commands::remote::pull,
            commands::remote::push,
            commands::remote::force_push,
            commands::remote::push_impact,
            commands::remote::remote_branch_exists,
            commands::remote::delete_remote_branch,
            // stash
            commands::stash::stash_list,
            commands::stash::stash_push,
            commands::stash::stash_pop,
            commands::stash::stash_apply,
            commands::stash::stash_drop,
            // in-progress operations & diagnostics
            commands::ops::conflict_state,
            commands::ops::abort_in_progress,
            commands::ops::continue_in_progress,
            commands::ops::log_line,
        ])
        .run(tauri::generate_context!())
        .expect("error while running GitGraph");
}
