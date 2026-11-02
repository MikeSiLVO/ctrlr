//! Torrent commands: listing, adding, per-torrent actions, files, peers and trackers.

use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::State;

use ctrlr_core::{ServerCapabilities, Torrent, TorrentDetails, TorrentMeta, TorrentProperties};
use ctrlr_core::db::history::NewTorrentHistory;

use crate::history::{archive_blob, record_history, sync_history};
use crate::{AppState, unix_now};

/// List every torrent in the main view, syncing History; a fetching magnet takes its History name.
#[tauri::command]
pub async fn list_torrents(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<Vec<Torrent>, String> {
    let client = get_client!(state);
    let caps = state.capabilities.lock().await.clone();
    let mut torrents = client.list_torrents(caps.as_ref()).await.map_err(|e| e.to_string())?;
    sync_history(&app, &state, &client, &torrents).await;
    for t in torrents.iter_mut().filter(|t| t.fetching_metadata) {
        if let Ok(Some(name)) = state.db.live_entry_name(&t.hash) {
            t.name = name;
        }
    }
    Ok(torrents)
}

/// Add by magnet or http url, which rTorrent fetches, in the given directory or its default.
#[tauri::command]
pub async fn add_torrent(state: State<'_, AppState>, source: String, directory: Option<String>) -> Result<(), String> {
    let client = get_client!(state);
    client.add_torrent_with_options(&source, directory.as_deref(), None, None).await.map_err(|e| e.to_string())?;

    // magnet has no blob yet, the pending-blob loop fetches it later
    if source.starts_with("magnet:")
        && let Some(hash) = ctrlr_core::meta::parse_magnet_hash(&source) {
            let name = ctrlr_core::meta::parse_magnet_dn(&source).unwrap_or_default();
            record_history(&state.db, &state.activity_log, &NewTorrentHistory {
                info_hash: &hash, name: &name, source: "magnet", added_at: unix_now(), ..Default::default()
            });
        }

    state.activity_log.info("torrent", "Torrent added");
    Ok(())
}

/// Add raw .torrent bytes, sent as a data: uri.
#[tauri::command]
pub async fn add_torrent_file(state: State<'_, AppState>, data: Vec<u8>) -> Result<(), String> {
    let client = get_client!(state);
    client.add_torrent_file_with_options(&data, None, None, None).await.map_err(|e| e.to_string())?;

    if let Ok(meta) = ctrlr_core::meta::parse(&data) {
        record_history(&state.db, &state.activity_log, &NewTorrentHistory {
            info_hash: &meta.info_hash, name: &meta.name, total_size: meta.total_size,
            source: "file", added_at: unix_now(), torrent_blob: Some(&data), ..Default::default()
        });
    }

    state.activity_log.info("torrent", "Torrent added");
    Ok(())
}

/// Parse .torrent file metadata (file list, info hash) without adding to rTorrent.
#[tauri::command]
pub fn parse_torrent_meta(data: Vec<u8>) -> Result<TorrentMeta, String> {
    ctrlr_core::meta::parse(&data)
}

/// Parse a magnet uri's btih info hash into uppercase hex, or null when it has none.
#[tauri::command]
pub fn parse_magnet_hash(uri: String) -> Option<String> {
    ctrlr_core::meta::parse_magnet_hash(&uri)
}

/// Add a .torrent with file priorities and directory, appending default trackers unless private.
#[tauri::command]
pub async fn add_torrent_configured(
    state: State<'_, AppState>,
    data: Vec<u8>,
    info_hash: String,
    directory: Option<String>,
    file_priorities: Vec<(usize, i64)>,
    extra_trackers: Vec<String>,
) -> Result<(), String> {
    let client = get_client!(state);
    client
        .add_torrent_configured(
            &data,
            &info_hash,
            directory.as_deref(),
            &file_priorities,
        )
        .await
        .map_err(|e| e.to_string())?;

    if !extra_trackers.is_empty() {
        let caps = state.capabilities.lock().await.clone();
        if caps.as_ref().is_some_and(|c| c.has_tracker_insert) {
            let hash = info_hash.to_uppercase();
            // unreadable flag counts as private; public trackers there risk a tracker ban
            let is_private = client
                .call("d.is_private", vec![json!(hash)])
                .await
                .ok()
                .and_then(|v| v.as_i64())
                .unwrap_or(1) != 0;
            if !is_private {
                let calls: Vec<(String, Vec<serde_json::Value>)> = extra_trackers
                    .iter()
                    .filter(|url| !url.trim().is_empty())
                    .map(|url| (
                        "d.tracker.insert".into(),
                        vec![json!(hash), json!(0), json!(url.trim())],
                    ))
                    .collect();
                if !calls.is_empty()
                    && let Err(e) = client.call_batch(calls).await {
                        state.activity_log.warn("torrent", format!("Could not add default trackers: {e}"));
                    }
            }
        }
    }

    if let Ok(meta) = ctrlr_core::meta::parse(&data) {
        let dir = directory.as_deref().unwrap_or("");
        record_history(&state.db, &state.activity_log, &NewTorrentHistory {
            info_hash: &meta.info_hash, name: &meta.name, total_size: meta.total_size,
            directory: dir, source: "file", added_at: unix_now(), torrent_blob: Some(&data),
            ..Default::default()
        });
    }

    state.activity_log.info("torrent", "Torrent added");
    Ok(())
}

/// Files, peers, trackers and scalar fields in one batch.
#[tauri::command]
pub async fn get_torrent_details(
    state: State<'_, AppState>,
    hash: String,
) -> Result<TorrentDetails, String> {
    let client = get_client!(state);
    let caps = state.capabilities.lock().await.clone()
        .unwrap_or_else(|| ServerCapabilities::from_methods(&[]));
    client
        .get_torrent_details(&hash, &caps)
        .await
        .map_err(|e| e.to_string())
}

/// The original .torrent bytes, read back from rTorrent's session directory.
#[tauri::command]
pub async fn get_torrent_file(state: State<'_, AppState>, hash: String) -> Result<Vec<u8>, String> {
    let client = get_client!(state);
    client.get_torrent_file(&hash).await.map_err(|e| e.to_string())
}

/// Per-torrent tunables shown in the properties dialog.
#[tauri::command]
pub async fn get_torrent_properties(state: State<'_, AppState>, hash: String) -> Result<TorrentProperties, String> {
    let client = get_client!(state);
    let caps = state.capabilities.lock().await.clone().unwrap_or_default();
    client.get_torrent_properties(&hash, &caps).await.map_err(|e| e.to_string())
}

/// Set the per-torrent tunables from the properties dialog.
#[tauri::command]
pub async fn set_torrent_properties(state: State<'_, AppState>, hash: String, props: TorrentProperties) -> Result<(), String> {
    let client = get_client!(state);
    let caps = state.capabilities.lock().await.clone().unwrap_or_default();
    client.set_torrent_properties(&hash, &props, &caps).await.map_err(|e| e.to_string())
}

/// Set a torrent's labels, replacing the old ones, stored url-encoded in d.custom1.
#[tauri::command]
pub async fn set_tags(
    state: State<'_, AppState>,
    hash: String,
    tags: Vec<String>,
) -> Result<(), String> {
    let client = get_client!(state);
    client
        .set_tags(&hash, &tags)
        .await
        .map_err(|e| e.to_string())
}

/// Set the recorded add time, which lives in d.custom=addtime.
#[tauri::command]
pub async fn set_date_added(
    state: State<'_, AppState>,
    hash: String,
    epoch: i64,
) -> Result<(), String> {
    let client = get_client!(state);
    client
        .set_date_added(&hash, epoch)
        .await
        .map_err(|e| e.to_string())
}

/// Torrent count for a log line, "1 torrent" or "3 torrents".
fn torrent_count(n: usize) -> String {
    if n == 1 { "1 torrent".into() } else { format!("{n} torrents") }
}

/// Pause each torrent by stopping and closing it.
#[tauri::command]
pub async fn pause_torrents(state: State<'_, AppState>, hashes: Vec<String>) -> Result<(), String> {
    let client = get_client!(state);
    client.pause_torrents(&hashes).await.map_err(|e| e.to_string())?;
    state.activity_log.info("action", format!("Paused {}", torrent_count(hashes.len())));
    Ok(())
}

/// Resume each torrent by opening and starting it.
#[tauri::command]
pub async fn resume_torrents(state: State<'_, AppState>, hashes: Vec<String>) -> Result<(), String> {
    let client = get_client!(state);
    client.resume_torrents(&hashes).await.map_err(|e| e.to_string())?;
    state.activity_log.info("action", format!("Resumed {}", torrent_count(hashes.len())));
    Ok(())
}

/// Remove each torrent and optionally its data, failing with the cause, and the count if some went.
#[tauri::command]
pub async fn remove_torrents(
    state: State<'_, AppState>,
    hashes: Vec<String>,
    delete_data: bool,
) -> Result<(), String> {
    let count = hashes.len();
    let client = get_client!(state);

    // last chance to archive the .torrent before it leaves the session dir
    for hash in &hashes {
        if state.db.live_entry_lacks_blob(hash).unwrap_or(false) {
            archive_blob(&state.db, &state.activity_log, &client, hash).await;
        }
    }

    let (removed, failure) = client.remove_torrents(&hashes, delete_data).await;

    // mark only what went; pending_blobs retries any hash not marked removed
    let now = unix_now();
    for hash in &removed {
        if let Err(e) = state.db.mark_torrent_removed(hash, now) {
            state.activity_log.error("database", format!("Failed to mark torrent removed: {e}"));
        }
    }

    if !removed.is_empty() {
        let suffix = if delete_data { " (with data)" } else { "" };
        state.activity_log.info("torrent", format!("Removed {}{suffix}", torrent_count(removed.len())));
    }
    match failure {
        Some(e) if removed.is_empty() => Err(e.to_string()),
        Some(e) => Err(format!("removed {} of {count} torrents: {e}", removed.len())),
        None => Ok(()),
    }
}

/// Recheck each torrent with a full hash check.
#[tauri::command]
pub async fn recheck_torrents(state: State<'_, AppState>, hashes: Vec<String>) -> Result<(), String> {
    let client = get_client!(state);
    client.recheck_torrents(&hashes).await.map_err(|e| e.to_string())?;
    state.activity_log.info("action", format!("Rechecked {}", torrent_count(hashes.len())));
    Ok(())
}

/// Reannounce each torrent to its trackers, without forcing it.
#[tauri::command]
pub async fn reannounce_torrents(state: State<'_, AppState>, hashes: Vec<String>) -> Result<(), String> {
    let client = get_client!(state);
    client.reannounce_torrents(&hashes).await.map_err(|e| e.to_string())
}

/// Set download priority 0 to 3 on each torrent.
#[tauri::command]
pub async fn set_torrents_priority(
    state: State<'_, AppState>,
    hashes: Vec<String>,
    priority: i64,
) -> Result<(), String> {
    let client = get_client!(state);
    client.set_torrents_priority(&hashes, priority).await.map_err(|e| e.to_string())
}

/// Set each torrent's throttle group by name, or clear it with an empty name.
#[tauri::command]
pub async fn set_torrents_throttle(
    state: State<'_, AppState>,
    hashes: Vec<String>,
    throttle_name: String,
) -> Result<(), String> {
    let client = get_client!(state);
    client.set_torrents_throttle(&hashes, &throttle_name).await.map_err(|e| e.to_string())
}

/// Move each torrent's data on the remote host, restoring its stopped, paused or active state.
#[tauri::command]
pub async fn move_torrents(
    state: State<'_, AppState>,
    hashes: Vec<String>,
    directory: String,
) -> Result<(), String> {
    let client = get_client!(state);
    client.move_torrents(&hashes, &directory).await.map_err(|e| e.to_string())
}

/// Set one file's priority: 0 off, 1 normal, 2 high.
#[tauri::command]
pub async fn set_file_priority(
    state: State<'_, AppState>,
    hash: String,
    file_index: usize,
    priority: i64,
) -> Result<(), String> {
    let client = get_client!(state);
    client
        .set_file_priority(&hash, file_index, priority)
        .await
        .map_err(|e| e.to_string())
}

/// A torrent and the ratio group it is currently in, -1 for none.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RatioGroupAssignment {
    hash: String,
    old_group: i64,
}

/// Set each torrent's ratio group through view membership, -1 to clear it.
#[tauri::command]
pub async fn set_torrents_ratio_group(
    state: State<'_, AppState>,
    torrents: Vec<RatioGroupAssignment>,
    group: i64,
) -> Result<(), String> {
    let client = get_client!(state);
    let hashes_with_old: Vec<(String, i64)> = torrents
        .into_iter()
        .map(|t| (t.hash, t.old_group))
        .collect();
    client.set_torrents_ratio_group(&hashes_with_old, group).await.map_err(|e| e.to_string())
}

/// Toggle one tracker on or off by index.
#[tauri::command]
pub async fn toggle_tracker(state: State<'_, AppState>, hash: String, index: usize, enabled: bool) -> Result<(), String> {
    let client = get_client!(state);
    client.toggle_tracker(&hash, index, enabled).await.map_err(|e| e.to_string())
}

/// Add a tracker url to a tracker group.
#[tauri::command]
pub async fn add_tracker(state: State<'_, AppState>, hash: String, group: i64, url: String) -> Result<(), String> {
    let client = get_client!(state);
    client.add_tracker(&hash, group, &url).await.map_err(|e| e.to_string())
}

/// Force an announce to the torrent's trackers now.
#[tauri::command]
pub async fn force_announce(state: State<'_, AppState>, hash: String) -> Result<(), String> {
    let client = get_client!(state);
    client.force_announce(&hash).await.map_err(|e| e.to_string())
}

/// Ban a peer so rTorrent will not reconnect to it.
#[tauri::command]
pub async fn ban_peer(state: State<'_, AppState>, hash: String, peer_id: String) -> Result<(), String> {
    let client = get_client!(state);
    client.ban_peer(&hash, &peer_id).await.map_err(|e| e.to_string())
}

/// Disconnect a peer, leaving it free to return.
#[tauri::command]
pub async fn disconnect_peer(state: State<'_, AppState>, hash: String, peer_id: String) -> Result<(), String> {
    let client = get_client!(state);
    client.disconnect_peer(&hash, &peer_id).await.map_err(|e| e.to_string())
}

/// Disconnect every seeder connected to the torrent.
#[tauri::command]
pub async fn disconnect_seeders(state: State<'_, AppState>, hash: String) -> Result<(), String> {
    let client = get_client!(state);
    client.disconnect_seeders(&hash).await.map_err(|e| e.to_string())
}

/// Prioritize a file's first piece on or off, for previewing it while it downloads.
#[tauri::command]
pub async fn prioritize_first_piece(state: State<'_, AppState>, hash: String, index: usize, enable: bool) -> Result<(), String> {
    let client = get_client!(state);
    client.prioritize_first_piece(&hash, index, enable).await.map_err(|e| e.to_string())
}

/// Prioritize a file's last piece on or off, which some players need before playback.
#[tauri::command]
pub async fn prioritize_last_piece(state: State<'_, AppState>, hash: String, index: usize, enable: bool) -> Result<(), String> {
    let client = get_client!(state);
    client.prioritize_last_piece(&hash, index, enable).await.map_err(|e| e.to_string())
}
