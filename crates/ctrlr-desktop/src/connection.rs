//! Connection profiles and the live connection: connect, launch retry, profile edits.

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager, State};

use ctrlr_core::{RtorrentClient, ServerCapabilities, SshTunnel};
use ctrlr_core::config::{self, Config, ConnectionConfig};

use crate::history::HistorySync;
use crate::{AppState, unix_now};

/// A failed launch connect, as the Connection screen shows it.
#[derive(Debug, Clone, Serialize)]
pub(crate) struct LaunchStatus {
    pub(crate) error: String,
    /// Retries made so far.
    pub(crate) attempt: u32,
    /// Unix seconds of the next retry, None when it will not retry.
    pub(crate) retry_at: Option<i64>,
}

/// Wait before the first launch retry; each later wait doubles up to LAUNCH_RETRY_MAX.
pub(crate) const LAUNCH_RETRY_FIRST: std::time::Duration = std::time::Duration::from_secs(5);

/// Longest wait between launch retries.
const LAUNCH_RETRY_MAX: std::time::Duration = std::time::Duration::from_secs(60);

/// Flat struct for frontend <-> backend connection settings.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ConnectionSettings {
    #[serde(default)]
    profile: Option<String>,
    conn_type: String,
    ssh_host: Option<String>,
    ssh_port: Option<u16>,
    ssh_user: Option<String>,
    ssh_password: Option<String>,
    remote_socket: Option<String>,
    host: Option<String>,
    port: Option<u16>,
    url: Option<String>,
    username: Option<String>,
    password: Option<String>,
    socket: Option<String>,
}

impl ConnectionSettings {
    /// Settings from a stored profile, with its password loaded from the keyring.
    fn from_config(profile: &str, config: &ConnectionConfig) -> Self {
        let password = config.credential_key(profile).and_then(|key| config::load_credential(&key));
        let base = ConnectionSettings { profile: Some(profile.to_string()), ..Default::default() };
        match config {
            ConnectionConfig::Ssh { ssh_host, ssh_port, ssh_user, remote_socket } => {
                ConnectionSettings {
                    conn_type: "ssh".into(),
                    ssh_host: Some(ssh_host.clone()),
                    ssh_port: Some(*ssh_port),
                    ssh_user: ssh_user.clone(),
                    ssh_password: password,
                    remote_socket: Some(remote_socket.clone()),
                    ..base
                }
            }
            ConnectionConfig::Tcp { host, port } => ConnectionSettings {
                conn_type: "tcp".into(),
                host: Some(host.clone()),
                port: Some(*port),
                ..base
            },
            ConnectionConfig::Http { url, username, .. } => ConnectionSettings {
                conn_type: "http".into(),
                url: Some(url.clone()),
                username: username.clone(),
                password,
                ..base
            },
            ConnectionConfig::Xmlrpc { url, username, .. } => ConnectionSettings {
                conn_type: "xmlrpc".into(),
                url: Some(url.clone()),
                username: username.clone(),
                password,
                ..base
            },
            ConnectionConfig::Unix { socket } => ConnectionSettings {
                conn_type: "unix".into(),
                socket: Some(socket.clone()),
                ..base
            },
        }
    }

    /// Convert to a stored profile config, failing when a required field is blank.
    fn to_connection_config(&self) -> Result<ConnectionConfig, String> {
        let require = |opt: &Option<String>, name: &str| -> Result<String, String> {
            opt.as_deref()
                .filter(|s| !s.trim().is_empty())
                .map(String::from)
                .ok_or_else(|| format!("{name} is required"))
        };
        match self.conn_type.as_str() {
            "ssh" => Ok(ConnectionConfig::Ssh {
                ssh_host: require(&self.ssh_host, "SSH host")?,
                ssh_port: self.ssh_port.unwrap_or(22),
                ssh_user: self.ssh_user.clone().filter(|s| !s.is_empty()),
                remote_socket: require(&self.remote_socket, "Remote socket path")?,
            }),
            "tcp" => Ok(ConnectionConfig::Tcp {
                host: self.host.clone().unwrap_or_else(|| "localhost".into()),
                port: self.port.unwrap_or(5000),
            }),
            "http" => Ok(ConnectionConfig::Http {
                url: require(&self.url, "URL")?,
                username: self.username.clone(),
                password: None,
            }),
            "xmlrpc" => Ok(ConnectionConfig::Xmlrpc {
                url: require(&self.url, "URL")?,
                username: self.username.clone(),
                password: None,
            }),
            "unix" => Ok(ConnectionConfig::Unix {
                socket: require(&self.socket, "Socket path")?,
            }),
            other => Err(format!("unknown connection type: {other}")),
        }
    }
}

/// Save the profile's password to the OS keyring, or delete it when sent empty.
fn save_connection_credential(profile: &str, conn: &ConnectionConfig, settings: &ConnectionSettings) -> Result<(), String> {
    let Some(key) = conn.credential_key(profile) else { return Ok(()) };
    let password = match conn {
        ConnectionConfig::Ssh { .. } => &settings.ssh_password,
        _ => &settings.password,
    };
    match password.as_deref() {
        Some(pw) if !pw.is_empty() => config::save_credential(&key, pw)?,
        Some(_) => { config::delete_credential(&key).ok(); }
        None => {}
    }
    Ok(())
}

/// Tear down the client, tunnel, profile, capabilities and History sync, returning the old profile.
async fn teardown_connection(state: &AppState) -> Option<String> {
    *state.client.lock().await = None;
    let mut tun = state.tunnel.lock().await;
    if let Some(ref t) = *tun {
        t.close().await.ok();
    }
    *tun = None;
    *state.capabilities.lock().await = None;
    *state.history_sync.lock().await = HistorySync::default();
    state.active_profile.lock().await.take()
}

/// Human-readable target for the activity log.
pub(crate) fn conn_desc(conn: &ConnectionConfig) -> String {
    match conn {
        ConnectionConfig::Ssh { ssh_host, ssh_user, .. } => {
            let user = ssh_user.as_deref().unwrap_or("");
            if user.is_empty() { format!("SSH → {ssh_host}") }
            else { format!("SSH → {user}@{ssh_host}") }
        }
        ConnectionConfig::Xmlrpc { url, .. } => format!("XMLRPC → {url}"),
        ConnectionConfig::Http { url, .. } => format!("HTTP → {url}"),
        ConnectionConfig::Tcp { host, port } => format!("TCP → {host}:{port}"),
        ConnectionConfig::Unix { socket } => format!("Unix → {socket}"),
    }
}

/// Connect to a profile as the live connection, dropping the old one and any launch retry first.
async fn connect_and_store(
    state: &AppState,
    name: &str,
    conn: &ConnectionConfig,
) -> Result<(), String> {
    *state.launch.lock().await = None;
    if let Some(prev) = teardown_connection(state).await {
        state.activity_log.info("connection", format!("Disconnected from profile '{prev}'"));
    }

    let (client, tunnel) = config::connect_with_config(name, conn)
        .await
        .map_err(|e| e.to_string())?;
    store_connection(state, name, conn, client, tunnel).await;
    Ok(())
}

/// Store a client as the live connection, detecting its capabilities and resetting the scheduler.
async fn store_connection(
    state: &AppState,
    name: &str,
    conn: &ConnectionConfig,
    client: RtorrentClient,
    tunnel: Option<Arc<SshTunnel>>,
) {
    let caps = match client.list_methods().await {
        Ok(methods) => Some(ServerCapabilities::from_methods(&methods)),
        Err(e) => {
            state.activity_log.warn("connection", format!("Could not detect server capabilities: {}", e));
            None
        }
    };

    *state.client.lock().await = Some(Arc::new(client));
    *state.tunnel.lock().await = tunnel;
    *state.active_profile.lock().await = Some(name.to_string());
    *state.capabilities.lock().await = caps;
    state.scheduler.reset().await;
    state.activity_log.info("connection", format!("Connected to '{name}' ({})", conn_desc(conn)));
}

/// Whether a connect failed at the socket before any login, the one failure worth retrying.
pub(crate) fn is_unreachable(e: &(dyn std::error::Error + 'static)) -> bool {
    matches!(e.downcast_ref::<ctrlr_core::RpcError>(), Some(ctrlr_core::RpcError::Unreachable(_)))
}

/// Retry the launch connect with backoff while the host is unreachable, emitting each outcome.
pub(crate) async fn retry_launch_connect(app: tauri::AppHandle, name: String, conn: ConnectionConfig) {
    let mut delay = LAUNCH_RETRY_FIRST;
    loop {
        tokio::time::sleep(delay).await;
        let state = app.state::<AppState>();
        if state.launch.lock().await.is_none() {
            return;
        }
        let result = config::connect_with_config(&name, &conn)
            .await
            .map_err(|e| (is_unreachable(&*e), e.to_string()));

        // held through the store; a manual connect waits for it, then replaces it
        let mut launch = state.launch.lock().await;
        let Some(status) = launch.as_mut() else { return };
        match result {
            Ok((client, tunnel)) => {
                *launch = None;
                store_connection(&state, &name, &conn, client, tunnel).await;
                app.emit("launch-connected", ()).ok();
                return;
            }
            Err((unreachable, e)) => {
                status.attempt += 1;
                status.error = format!("Could not connect to '{name}': {e}");
                status.retry_at = None;
                if unreachable {
                    delay = (delay * 2).min(LAUNCH_RETRY_MAX);
                    status.retry_at = Some(unix_now() + delay.as_secs() as i64);
                } else {
                    state.activity_log.error("connection", status.error.clone());
                }
                app.emit("launch-retry", status.clone()).ok();
                if !unreachable {
                    return;
                }
            }
        }
    }
}

/// Save a profile and connect to it, rolling back the active profile if it fails.
#[tauri::command]
pub async fn save_and_connect(
    state: State<'_, AppState>,
    settings: ConnectionSettings,
) -> Result<(), String> {
    let profile_name = settings.profile.clone().unwrap_or_else(|| "default".to_string());
    let conn_config = settings.to_connection_config()?;
    save_connection_credential(&profile_name, &conn_config, &settings)?;

    let mut cfg = Config::load()?;
    let previous_active = cfg.active.clone();
    cfg.profiles.insert(profile_name.clone(), conn_config.clone());
    cfg.active = profile_name.clone();
    cfg.save()?;

    if let Err(e) = connect_and_store(&state, &profile_name, &conn_config).await {
        // keep the profile, but a failing one must not auto-connect on next launch
        if let Ok(mut cfg) = Config::load() {
            cfg.active = previous_active;
            cfg.save().ok();
        }
        return Err(e);
    }
    Ok(())
}

/// Whether an RPC client is currently held.
#[tauri::command]
pub async fn is_connected(state: State<'_, AppState>) -> Result<bool, String> {
    let guard = state.client.lock().await;
    Ok(guard.is_some())
}

/// Disconnect from the server, clearing client, tunnel, profile, capabilities and History sync.
#[tauri::command]
pub async fn disconnect(state: State<'_, AppState>) -> Result<(), String> {
    teardown_connection(&state).await;
    state.activity_log.info("connection", "Disconnected");
    Ok(())
}

/// Which optional rTorrent commands this server exposes, from system.listMethods.
#[tauri::command]
pub async fn get_capabilities(state: State<'_, AppState>) -> Result<Option<ServerCapabilities>, String> {
    Ok(state.capabilities.lock().await.clone())
}

/// Profile name and connection type for the profile list.
#[derive(Debug, Serialize)]
struct ProfileInfo {
    name: String,
    conn_type: String,
}

/// Configured profiles, the one currently connected, and the one launch connects to.
#[derive(Debug, Serialize)]
pub struct ProfileList {
    active: Option<String>,
    /// The config's active profile, when it names one that exists.
    startup: Option<String>,
    profiles: Vec<ProfileInfo>,
}

/// List every profile plus the connected and launch ones; fails if config.toml is unreadable.
#[tauri::command]
pub async fn list_profiles(state: State<'_, AppState>) -> Result<ProfileList, String> {
    let active = state.active_profile.lock().await.clone();
    let config = Config::load()?;
    Ok(ProfileList {
        active,
        startup: config.profiles.contains_key(&config.active).then(|| config.active.clone()),
        profiles: config.profiles.iter().map(|(name, conn)| {
            let conn_type = match conn {
                ConnectionConfig::Ssh { .. } => "SSH",
                ConnectionConfig::Xmlrpc { .. } => "XMLRPC",
                ConnectionConfig::Http { .. } => "HTTP",
                ConnectionConfig::Tcp { .. } => "TCP",
                ConnectionConfig::Unix { .. } => "Unix",
            };
            ProfileInfo { name: name.clone(), conn_type: conn_type.into() }
        }).collect(),
    })
}

/// Settings for a named profile, null if not on disk yet; fails if config.toml is unreadable.
#[tauri::command]
pub async fn get_profile_settings(name: String) -> Result<Option<ConnectionSettings>, String> {
    let config = Config::load()?;
    Ok(config.profiles.get(&name).map(|conn| ConnectionSettings::from_config(&name, conn)))
}

/// The failed launch connect and its retry, or null once any connect takes over.
#[tauri::command]
pub async fn get_launch_status(state: State<'_, AppState>) -> Result<Option<LaunchStatus>, String> {
    Ok(state.launch.lock().await.clone())
}

/// Save a profile and its credential without connecting to it.
#[tauri::command]
pub async fn save_profile(name: String, settings: ConnectionSettings) -> Result<(), String> {
    let conn_config = settings.to_connection_config()?;
    save_connection_credential(&name, &conn_config, &settings)?;

    let mut cfg = Config::load()?;
    cfg.profiles.insert(name, conn_config);
    cfg.save()
}

/// Delete a profile and its stored credential, disconnecting if active; unsaved is a no-op.
#[tauri::command]
pub async fn delete_profile(state: State<'_, AppState>, name: String) -> Result<(), String> {
    let mut cfg = Config::load().map_err(|e| e.to_string())?;
    if !cfg.profiles.contains_key(&name) {
        return Ok(());
    }

    let active = state.active_profile.lock().await.clone();
    if active.as_deref() == Some(&name) {
        teardown_connection(&state).await;
    }

    if let Some(key) = cfg.profiles.remove(&name).and_then(|conn| conn.credential_key(&name)) {
        config::delete_credential(&key).ok();
    }
    if cfg.active == name {
        cfg.active = cfg.profiles.keys().next().cloned().unwrap_or_default();
    }
    cfg.save()?;
    state.activity_log.info("settings", format!("Deleted profile '{name}'"));
    Ok(())
}

/// Rename a profile, carrying its keyring credential; refuses a taken name or a failed copy.
#[tauri::command]
pub async fn rename_profile(state: State<'_, AppState>, old_name: String, new_name: String) -> Result<(), String> {
    let mut cfg = Config::load().map_err(|e| e.to_string())?;
    let conn = cfg.profiles.remove(&old_name)
        .ok_or_else(|| format!("profile '{old_name}' does not exist"))?;

    if new_name == old_name {
        return Ok(());
    }
    if cfg.profiles.contains_key(&new_name) {
        return Err(format!("profile '{new_name}' already exists"));
    }

    let keys = conn.credential_key(&old_name).zip(conn.credential_key(&new_name));
    // the old key stays until the renamed config is on disk
    if let Some((old_key, new_key)) = &keys
        && let Some(pw) = config::read_credential(old_key)?
    {
        config::save_credential(new_key, &pw)
            .map_err(|e| format!("could not copy the saved password: {e}"))?;
    }

    cfg.profiles.insert(new_name.clone(), conn);
    if cfg.active == old_name {
        cfg.active = new_name.clone();
    }
    cfg.save()?;

    if let Some((old_key, _)) = &keys {
        config::delete_credential(old_key).ok();
    }
    let mut active = state.active_profile.lock().await;
    if active.as_deref() == Some(old_name.as_str()) {
        *active = Some(new_name.clone());
    }
    state.activity_log.info("settings", format!("Renamed profile '{}' to '{}'", old_name, new_name));
    Ok(())
}

/// Switch to a different profile, connecting first and then saving it as active.
#[tauri::command]
pub async fn switch_profile(state: State<'_, AppState>, name: String) -> Result<(), String> {
    let mut cfg = Config::load().map_err(|e| e.to_string())?;
    let conn = cfg.profiles.get(&name)
        .ok_or_else(|| format!("profile '{name}' does not exist"))?
        .clone();

    connect_and_store(&state, &name, &conn).await?;

    cfg.active = name;
    cfg.save()
}
