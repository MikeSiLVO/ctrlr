//! Server-wide commands: speed limits, disk space, rTorrent settings and ratio groups.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::State;

use ctrlr_core::config::{load_toml, save_toml};
use ctrlr_core::{RtorrentClient, SystemInfo, TransferStats};

use crate::AppState;

/// Global up and down rates and totals.
#[tauri::command]
pub async fn get_transfer_stats(state: State<'_, AppState>) -> Result<TransferStats, String> {
    let client = get_client!(state);
    client.get_transfer_stats().await.map_err(|e| e.to_string())
}

/// Global limits as [up, down] in bytes per second.
#[tauri::command]
pub async fn get_speed_limits(state: State<'_, AppState>) -> Result<(i64, i64), String> {
    let client = get_client!(state);
    client.get_speed_limits().await.map_err(|e| e.to_string())
}

/// Set the global upload cap in KB per second, 0 for unlimited.
#[tauri::command]
pub async fn set_upload_limit(state: State<'_, AppState>, kb: i64) -> Result<(), String> {
    let client = get_client!(state);
    client
        .set_upload_limit(kb)
        .await
        .map_err(|e| e.to_string())
}

/// Set the global download cap in KB per second, 0 for unlimited.
#[tauri::command]
pub async fn set_download_limit(state: State<'_, AppState>, kb: i64) -> Result<(), String> {
    let client = get_client!(state);
    client
        .set_download_limit(kb)
        .await
        .map_err(|e| e.to_string())
}

/// rTorrent version, library version and hostname.
#[tauri::command]
pub async fn get_system_info(state: State<'_, AppState>) -> Result<SystemInfo, String> {
    let client = get_client!(state);
    client.get_system_info().await.map_err(|e| e.to_string())
}

/// rTorrent's configured download directory.
#[tauri::command]
pub async fn get_default_directory(state: State<'_, AppState>) -> Result<String, String> {
    let client = get_client!(state);
    client.get_default_directory().await.map_err(|e| e.to_string())
}

/// Free bytes on the download partition, via df on the remote host.
#[tauri::command]
pub async fn get_free_diskspace(state: State<'_, AppState>) -> Result<i64, String> {
    let client = get_client!(state);
    client.get_free_diskspace().await.map_err(|e| e.to_string())
}

/// Used bytes from the seedbox quota tool, for hosts that report usage, not free space.
#[tauri::command]
pub async fn get_disk_used(state: State<'_, AppState>) -> Result<i64, String> {
    let client = get_client!(state);
    client.get_disk_used().await.map_err(|e| e.to_string())
}

/// Subdirectory names under a remote path, for the directory browser.
#[tauri::command]
pub async fn list_remote_directory(state: State<'_, AppState>, path: String) -> Result<Vec<String>, String> {
    let client = get_client!(state);
    client.list_directory(&path).await.map_err(|e| e.to_string())
}

/// Remote rTorrent settings, optional fields None when the server lacks them.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteSettings {
    default_directory: String,
    max_uploads: i64,
    max_downloads: i64,
    min_peers_normal: i64,
    max_peers_normal: i64,
    min_peers_seed: i64,
    max_peers_seed: i64,
    port_range: String,
    pex: bool,
    /// None when the server lacks `dht` or dht.statistics fails.
    dht: Option<String>,
    /// Always None on read; rTorrent's `encryption` is a redirect to the setter.
    encryption: Option<String>,
    hash_on_completion: bool,
    scheduler_max_active: Option<i64>,
    send_buffer_size: Option<i64>,
    receive_buffer_size: Option<i64>,
    dht_override_port: Option<i64>,
    tracker_numwant: Option<i64>,
}

/// rTorrent's own settings, batched and gated on server support.
#[tauri::command]
pub async fn get_remote_settings(state: State<'_, AppState>) -> Result<RemoteSettings, String> {
    let client = get_client!(state);
    let caps = state.capabilities.lock().await.clone();

    let mut calls: Vec<(String, Vec<serde_json::Value>)> = vec![
        ("directory.default".into(), vec![]),
        ("throttle.max_uploads".into(), vec![]),
        ("throttle.max_downloads.global".into(), vec![]),
        ("throttle.min_peers.normal".into(), vec![]),
        ("throttle.max_peers.normal".into(), vec![]),
        ("throttle.min_peers.seed".into(), vec![]),
        ("throttle.max_peers.seed".into(), vec![]),
        ("network.port_range".into(), vec![]),
        ("protocol.pex".into(), vec![]),
        ("pieces.hash.on_completion".into(), vec![]),
    ];

    let sched_idx = if caps.as_ref().is_some_and(|c| c.has_scheduler_max_active) {
        let idx = calls.len();
        calls.push(("scheduler.max_active".into(), vec![]));
        Some(idx)
    } else { None };

    let send_buf_idx = if caps.as_ref().is_some_and(|c| c.has_send_buffer_size) {
        let idx = calls.len();
        calls.push(("network.send_buffer.size".into(), vec![]));
        Some(idx)
    } else { None };

    let recv_buf_idx = if caps.as_ref().is_some_and(|c| c.has_receive_buffer_size) {
        let idx = calls.len();
        calls.push(("network.receive_buffer.size".into(), vec![]));
        Some(idx)
    } else { None };

    let dht_port_idx = if caps.as_ref().is_some_and(|c| c.has_dht_override_port) {
        let idx = calls.len();
        calls.push(("dht.override_port".into(), vec![]));
        Some(idx)
    } else { None };

    let numwant_idx = if caps.as_ref().is_some_and(|c| c.has_tracker_numwant) {
        let idx = calls.len();
        calls.push(("trackers.numwant".into(), vec![]));
        Some(idx)
    } else { None };

    let vals = client.call_batch(calls).await.map_err(|e| e.to_string())?;

    let dht = if caps.as_ref().is_some_and(|c| c.has_dht_mode) {
        client.get_dht().await.ok()
    } else { None };

    let encryption: Option<String> = None;

    Ok(RemoteSettings {
        default_directory: vals[0].as_str().unwrap_or("").to_string(),
        max_uploads: vals[1].as_i64().unwrap_or(0),
        max_downloads: vals[2].as_i64().unwrap_or(0),
        min_peers_normal: vals[3].as_i64().unwrap_or(0),
        max_peers_normal: vals[4].as_i64().unwrap_or(0),
        min_peers_seed: vals[5].as_i64().unwrap_or(0),
        max_peers_seed: vals[6].as_i64().unwrap_or(0),
        port_range: vals[7].as_str().unwrap_or("").to_string(),
        pex: vals[8].as_i64().unwrap_or(0) != 0,
        hash_on_completion: vals[9].as_i64().unwrap_or(0) != 0,
        dht,
        encryption,
        scheduler_max_active: sched_idx.map(|i| vals[i].as_i64().unwrap_or(0)),
        send_buffer_size: send_buf_idx.map(|i| vals[i].as_i64().unwrap_or(0)),
        receive_buffer_size: recv_buf_idx.map(|i| vals[i].as_i64().unwrap_or(0)),
        dht_override_port: dht_port_idx.map(|i| vals[i].as_i64().unwrap_or(0)),
        tracker_numwant: numwant_idx.map(|i| vals[i].as_i64().unwrap_or(0)),
    })
}

/// Save rTorrent's settings, leaving out optional fields sent as None.
#[tauri::command]
pub async fn save_remote_settings(state: State<'_, AppState>, settings: RemoteSettings) -> Result<(), String> {
    let client = get_client!(state);

    let mut calls: Vec<(String, Vec<serde_json::Value>)> = vec![
        ("directory.default.set".into(), vec![json!(""), json!(settings.default_directory)]),
        ("throttle.max_uploads.set".into(), vec![json!(""), json!(settings.max_uploads.to_string())]),
        ("throttle.max_downloads.global.set".into(), vec![json!(""), json!(settings.max_downloads.to_string())]),
        ("throttle.min_peers.normal.set".into(), vec![json!(""), json!(settings.min_peers_normal.to_string())]),
        ("throttle.max_peers.normal.set".into(), vec![json!(""), json!(settings.max_peers_normal.to_string())]),
        ("throttle.min_peers.seed.set".into(), vec![json!(""), json!(settings.min_peers_seed.to_string())]),
        ("throttle.max_peers.seed.set".into(), vec![json!(""), json!(settings.max_peers_seed.to_string())]),
        ("network.port_range.set".into(), vec![json!(""), json!(settings.port_range)]),
        ("protocol.pex.set".into(), vec![json!(""), json!(if settings.pex { 1 } else { 0 })]),
        ("pieces.hash.on_completion.set".into(), vec![json!(""), json!(if settings.hash_on_completion { 1 } else { 0 })]),
    ];

    if let Some(dht) = &settings.dht {
        calls.push(("dht.mode.set".into(), vec![json!(""), json!(dht)]));
    }
    if let Some(enc) = &settings.encryption {
        let mut params: Vec<serde_json::Value> = vec![json!("")];
        for opt in enc.split(',') {
            params.push(json!(opt));
        }
        calls.push(("protocol.encryption.set".into(), params));
    }
    if let Some(max_active) = settings.scheduler_max_active {
        calls.push(("scheduler.max_active.set".into(), vec![json!(""), json!(max_active.to_string())]));
    }
    if let Some(send_buf) = settings.send_buffer_size {
        calls.push(("network.send_buffer.size.set".into(), vec![json!(""), json!(send_buf.to_string())]));
    }
    if let Some(recv_buf) = settings.receive_buffer_size {
        calls.push(("network.receive_buffer.size.set".into(), vec![json!(""), json!(recv_buf.to_string())]));
    }
    if let Some(port) = settings.dht_override_port {
        calls.push(("dht.override_port.set".into(), vec![json!(""), json!(port.to_string())]));
    }
    if let Some(numwant) = settings.tracker_numwant {
        calls.push(("trackers.numwant.set".into(), vec![json!(""), json!(numwant.to_string())]));
    }

    client.call_batch(calls).await.map_err(|e| e.to_string())?;
    state.activity_log.info("settings", "Remote settings saved");
    Ok(())
}

/// One of rTorrent's ratio groups, ratios as floats and the upload floor in GiB.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RatioGroup {
    id: i64,
    enabled: bool,
    min: f64,
    max: f64,
    upload_gib: f64,
    action: String,
}

/// Map a ratio group command back to its action name, "stop" when unrecognized.
fn ratio_command_to_action(cmd: &str) -> String {
    let normalized: String = cmd.chars().filter(|c| !c.is_whitespace()).flat_map(|c| c.to_lowercase()).collect();
    if normalized.contains("d.erase") {
        "remove".into()
    } else if normalized.contains("d.close") || normalized.contains("d.try_close") {
        "close".into()
    } else {
        "stop".into()
    }
}

/// The eight ratio groups with their thresholds and actions.
#[tauri::command]
pub async fn get_ratio_groups(state: State<'_, AppState>) -> Result<Vec<RatioGroup>, String> {
    let client = get_client!(state);

    let mut calls: Vec<(String, Vec<serde_json::Value>)> = Vec::new();
    for i in 0..8 {
        calls.push((format!("group.rat_{i}.ratio.min"), vec![]));
        calls.push((format!("group.rat_{i}.ratio.max"), vec![]));
        calls.push((format!("group.rat_{i}.ratio.upload"), vec![]));
        calls.push(("method.get".into(), vec![json!(""), json!(format!("group.rat_{i}.ratio.command"))]));
    }

    let vals = client.call_batch(calls).await.map_err(|e| e.to_string())?;
    let (server, pid) = server_instance(&client).await?;
    let saved: SavedRatioGroups = load_toml(SAVED_RATIO_FILE).unwrap_or_default();
    let saved = saved.servers.get(&server);

    let mut groups = Vec::with_capacity(8);
    for i in 0..8usize {
        let base = i * 4;
        let min_raw = vals[base].as_i64().unwrap_or(0);
        let max_raw = vals[base + 1].as_i64().unwrap_or(0);
        let upload = vals[base + 2].as_i64().unwrap_or(0);
        let cmd_raw = vals[base + 3].as_str().unwrap_or("");

        // a restarted rTorrent has dropped every schedule; restore_ratio_groups brings them back
        let enabled = match saved {
            Some(s) => s.pid == pid && s.groups.iter().any(|g| g.id == i as i64 && g.enabled),
            None => (min_raw, max_raw, upload) != RTORRENT_GROUP_DEFAULTS,
        };

        groups.push(RatioGroup {
            id: i as i64,
            enabled,
            min: min_raw as f64 / 100.0,
            max: max_raw as f64 / 100.0,
            upload_gib: upload as f64 / (1024.0 * 1024.0 * 1024.0),
            action: ratio_command_to_action(cmd_raw),
        });
    }

    Ok(groups)
}

/// Save the ratio group thresholds and actions, disabling groups switched off, and record them.
#[tauri::command]
pub async fn save_ratio_groups(state: State<'_, AppState>, groups: Vec<RatioGroup>) -> Result<(), String> {
    let client = get_client!(state);
    apply_ratio_groups(&client, &groups).await?;
    let (server, pid) = server_instance(&client).await?;
    let mut saved: SavedRatioGroups = load_toml(SAVED_RATIO_FILE).unwrap_or_default();
    saved.servers.insert(server, SavedGroups { pid, groups });
    save_toml(SAVED_RATIO_FILE, &saved)
        .map_err(|e| format!("Ratio groups applied, but could not be recorded: {e}"))?;
    state.activity_log.info("settings", "Ratio groups saved");
    Ok(())
}

/// Re-apply this server's saved ratio groups after an rTorrent restart, returning the enabled ids.
#[tauri::command]
pub async fn restore_ratio_groups(state: State<'_, AppState>) -> Result<Vec<i64>, String> {
    let client = get_client!(state);
    let (server, pid) = server_instance(&client).await?;
    let mut saved: SavedRatioGroups = load_toml(SAVED_RATIO_FILE)?;
    let Some(entry) = saved.servers.get_mut(&server) else {
        return Ok(Vec::new());
    };
    if entry.pid == pid {
        return Ok(Vec::new());
    }
    apply_ratio_groups(&client, &entry.groups).await?;
    entry.pid = pid;
    let enabled: Vec<i64> = entry.groups.iter().filter(|g| g.enabled).map(|g| g.id).collect();
    save_toml(SAVED_RATIO_FILE, &saved)?;
    if !enabled.is_empty() {
        state.activity_log.info("settings", "rTorrent restarted, re-applied the saved ratio groups");
    }
    Ok(enabled)
}

/// Config file holding each server's last-saved ratio groups.
const SAVED_RATIO_FILE: &str = "ratio.toml";

/// Min, max and upload that rTorrent's group.insert gives every new ratio group.
const RTORRENT_GROUP_DEFAULTS: (i64, i64, i64) = (200, 300, 20 << 20);

/// Ratio groups as last saved on one server, and the rTorrent process they were applied to.
#[derive(Clone, Default, Serialize, Deserialize)]
struct SavedGroups {
    pid: i64,
    groups: Vec<RatioGroup>,
}

/// Last-saved ratio groups by server identity, the only record of which groups are enabled.
#[derive(Default, Serialize, Deserialize)]
struct SavedRatioGroups {
    servers: BTreeMap<String, SavedGroups>,
}

/// Identity and process id of the connected rTorrent, pid 0 when the server cannot report it.
async fn server_instance(client: &RtorrentClient) -> Result<(String, i64), String> {
    let server = client.server_id().await.map_err(|e| e.to_string())?;
    let pid = client.call("system.pid", vec![]).await.ok().and_then(|v| v.as_i64()).unwrap_or(0);
    Ok((server, pid))
}

/// Apply groups to rTorrent: thresholds, action and schedule for enabled ones, disable the rest.
async fn apply_ratio_groups(client: &RtorrentClient, groups: &[RatioGroup]) -> Result<(), String> {
    let mut calls: Vec<(String, Vec<serde_json::Value>)> = Vec::new();
    for g in groups {
        let i = g.id;
        if g.enabled {
            let min_raw = (g.min * 100.0).round() as i64;
            let max_raw = (g.max * 100.0).round() as i64;
            let upload_bytes = (g.upload_gib * 1024.0 * 1024.0 * 1024.0).round() as i64;
            calls.push((format!("group.rat_{i}.ratio.enable"), vec![json!("")]));
            calls.push((format!("group.rat_{i}.ratio.min.set"), vec![json!(""), json!(min_raw)]));
            calls.push((format!("group.rat_{i}.ratio.max.set"), vec![json!(""), json!(max_raw)]));
            calls.push((format!("group.rat_{i}.ratio.upload.set"), vec![json!(""), json!(upload_bytes)]));

            let command = match g.action.as_str() {
                "remove" => "d.stop=; d.close=; d.erase=; d.ignore_commands.set=1",
                "close" => "d.try_close=; d.ignore_commands.set=1",
                _ => "d.stop=; d.ignore_commands.set=1",
            };
            calls.push(("system.method.set".into(), vec![
                json!(""),
                json!(format!("group.rat_{i}.ratio.command")),
                json!(command),
            ]));
        } else {
            calls.push((format!("group.rat_{i}.ratio.disable"), vec![json!("")]));
        }
    }

    if !calls.is_empty() {
        client.call_batch(calls).await.map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Round-trip the saved groups through TOML, server keys with colons and slashes included.
    #[test]
    fn saved_groups_round_trip_through_toml() {
        let mut saved = SavedRatioGroups::default();
        let group = RatioGroup {
            id: 3, enabled: true, min: 1.5, max: 2.0, upload_gib: 0.5, action: "remove".into(),
        };
        saved.servers.insert("seedbox:/home/me/.session".into(), SavedGroups { pid: 4242, groups: vec![group] });
        let text = toml::to_string(&saved).unwrap();
        let back: SavedRatioGroups = toml::from_str(&text).unwrap();
        let entry = &back.servers["seedbox:/home/me/.session"];
        assert_eq!(entry.pid, 4242);
        assert_eq!((entry.groups[0].id, entry.groups[0].enabled), (3, true));
        assert_eq!(entry.groups[0].action, "remove");
    }
}
