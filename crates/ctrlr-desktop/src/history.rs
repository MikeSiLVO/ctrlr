//! Torrent History: recording adds, syncing to the loaded list, and the History dialog's commands.

use tauri::{Emitter, State};

use ctrlr_core::RtorrentClient;
use ctrlr_core::Torrent;
use ctrlr_core::db::Database;
use ctrlr_core::db::history::NewTorrentHistory;

use crate::log::ActivityLog;
use crate::{AppState, unix_now};

/// Connected server and the list History last synced to, reset with the connection.
#[derive(Default)]
pub(crate) struct HistorySync {
    /// Identity of the connected rTorrent, fetched with the first list.
    server: Option<String>,
    /// Sorted hashes of the last list synced; an unchanged list writes nothing.
    synced: Option<Vec<String>>,
}

/// Record an added torrent, logging rather than failing the add if it cannot.
pub(crate) fn record_history(db: &Database, log: &ActivityLog, entry: &NewTorrentHistory<'_>) {
    if let Err(e) = db.add_torrent_history(entry) {
        log.warn("torrent", format!("Could not record torrent history: {e}"));
    }
}

/// Archive a torrent's .torrent into its live History entries lacking one, filling an empty name.
pub(crate) async fn archive_blob(db: &Database, log: &ActivityLog, client: &RtorrentClient, hash: &str) {
    // a magnet still fetching its metadata has only rTorrent's placeholder
    if let Ok(blob) = client.get_torrent_file(hash).await
        && let Ok(meta) = ctrlr_core::meta::parse(&blob)
        && let Err(e) = db.set_blob_by_hash(hash, &blob, &meta.name, meta.total_size)
    {
        log.error("database", format!("Failed to save torrent blob: {e}"));
    }
}

/// Sync History's live entries to the loaded list once per change, emitting `history-synced`.
pub(crate) async fn sync_history(app: &tauri::AppHandle, state: &AppState, client: &RtorrentClient, torrents: &[Torrent]) {
    let mut hashes: Vec<String> = torrents.iter().map(|t| t.hash.to_uppercase()).collect();
    hashes.sort_unstable();
    let mut sync = state.history_sync.lock().await;
    if sync.synced.as_ref() == Some(&hashes) {
        return;
    }
    if sync.server.is_none() {
        sync.server = client.server_id().await.ok();
    }
    let Some(server) = sync.server.clone() else { return };
    if let Err(e) = state.db.sync_loaded(&server, &hashes, unix_now()) {
        state.activity_log.warn("database", format!("Could not sync torrent history: {e}"));
    }
    sync.synced = Some(hashes);
    app.emit("history-synced", ()).ok();
}

use ctrlr_core::db::history::{HistoryQuery, TorrentHistoryPage};

/// One page of torrent history, with a total for paging.
#[tauri::command]
pub async fn history_list(state: State<'_, AppState>, query: HistoryQuery) -> Result<TorrentHistoryPage, String> {
    let loaded = state.history_sync.lock().await.synced.clone();
    state.db.get_torrent_history(&query, loaded.as_deref())
}

/// Archived .torrent bytes for a history entry, or null if none was kept.
#[tauri::command]
pub async fn history_get_blob(
    state: State<'_, AppState>,
    id: i64,
) -> Result<Option<Vec<u8>>, String> {
    state.db.get_torrent_blob(id)
}

/// Write .torrent bytes to a path the user picked in a save dialog.
#[tauri::command]
pub async fn save_torrent_file(path: String, data: Vec<u8>) -> Result<(), String> {
    tokio::fs::write(&path, &data)
        .await
        .map_err(|e| format!("failed to write {path}: {e}"))
}

/// Delete one torrent history entry.
#[tauri::command]
pub async fn history_delete(
    state: State<'_, AppState>,
    id: i64,
) -> Result<(), String> {
    state.db.delete_history_entry(id)
}
