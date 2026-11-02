//! Ctrl+R's Tauri backend: app state, app-level commands such as window and tray, and startup.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

/// Get the RPC client, reconnecting the SSH tunnel first if it dropped.
macro_rules! get_client {
    ($state:expr) => {{
        {
            let tun = $state.tunnel.lock().await;
            if let Some(ref t) = *tun {
                // the failed attempt that started the backoff was already logged
                if let Some(e) = t.backoff_error() {
                    return Err(e.to_string());
                }
                let was_unhealthy = !t.is_healthy();
                t.ensure().await.map_err(|e| {
                    $state.activity_log.error("connection", format!("SSH tunnel error: {}", e));
                    e.to_string()
                })?;
                if was_unhealthy {
                    $state.activity_log.info("connection", "SSH tunnel reconnected");
                }
            }
        }
        $state.client.lock().await.clone()
            .ok_or_else(|| "Not connected".to_string())?
    }};
}

mod background;
mod connection;
mod history;
mod log;
mod rss;
mod scheduler;
mod server;
mod torrents;
mod update;

use std::sync::Arc;

use tauri::{Emitter, Manager, State};
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::TrayIconBuilder;
use tokio::sync::Mutex;

use ctrlr_core::{RtorrentClient, ServerCapabilities, SshTunnel};
use ctrlr_core::config::{self, Config};
use ctrlr_core::db::Database;

use crate::connection::{
    LAUNCH_RETRY_FIRST, LaunchStatus, conn_desc, is_unreachable, retry_launch_connect,
};
use crate::history::HistorySync;
use crate::log::ActivityLog;

/// Shared state behind every Tauri command.
struct AppState {
    client: Arc<Mutex<Option<Arc<RtorrentClient>>>>,
    tunnel: Arc<Mutex<Option<Arc<SshTunnel>>>>,
    /// Torrent file paths and magnets that arrived before the frontend was ready.
    initial_open: std::sync::Mutex<Vec<String>>,
    /// Set once the frontend reads initial_open and can take open-torrent events.
    frontend_ready: std::sync::atomic::AtomicBool,
    active_profile: Arc<Mutex<Option<String>>>,
    capabilities: Arc<Mutex<Option<ServerCapabilities>>>,
    activity_log: Arc<ActivityLog>,
    db: Arc<Database>,
    rss_manager: Arc<rss::RssManager>,
    scheduler: Arc<scheduler::SchedulerManager>,
    tray: Arc<std::sync::Mutex<Option<tauri::tray::TrayIcon>>>,
    tray_info: Arc<std::sync::Mutex<Option<tauri::menu::MenuItem<tauri::Wry>>>>,
    /// Failed launch connect and its retry, cleared once any connect takes over.
    launch: Mutex<Option<LaunchStatus>>,
    history_sync: Mutex<HistorySync>,
}

/// Current Unix time in seconds.
fn unix_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

/// Set the start-minimized flag in config.toml, read at the next launch.
#[tauri::command]
async fn set_start_minimized(value: bool) -> Result<(), String> {
    let mut config = ctrlr_core::Config::load()?;
    config.start_minimized = value;
    config.save()
}

/// Set launch on login through the OS, and record it in config.toml.
#[tauri::command]
async fn set_autostart(app: tauri::AppHandle, value: bool) -> Result<(), String> {
    use tauri_plugin_autostart::ManagerExt;
    let mut config = ctrlr_core::Config::load()?;
    let manager = app.autolaunch();
    if value {
        manager.enable().map_err(|e| e.to_string())?;
    } else {
        manager.disable().map_err(|e| e.to_string())?;
    }
    config.autostart = value;
    config.save()
}

/// Show, unminimize and focus the main window, each step tried even if an earlier one fails.
fn show_main_window(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        w.show().ok();
        w.unminimize().ok();
        w.set_focus().ok();
    }
}

/// Show the main window, restoring it when minimized, and focus it.
#[tauri::command]
async fn show_window(app: tauri::AppHandle) {
    show_main_window(&app);
}

/// Hide the main window to the tray.
#[tauri::command]
async fn hide_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("main") {
        w.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Shut down the background loops and tunnel, then destroy the window and exit.
async fn shutdown(app: &tauri::AppHandle, state: &AppState) {
    state.rss_manager.stop().await;
    state.scheduler.stop().await;

    // a dropped session holds the remote until its own timeout
    let mut tun = state.tunnel.lock().await;
    if let Some(ref t) = *tun {
        t.close().await.ok();
    }
    *tun = None;
    drop(tun);

    // app.exit with the window still alive raises Win32 error 1412
    if let Some(w) = app.get_webview_window("main") {
        w.destroy().ok();
    }
    app.exit(0);
}

/// Quit the app, stopping the background loops and closing the tunnel first.
#[tauri::command]
async fn quit_app(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    shutdown(&app, &state).await;
    Ok(())
}

/// Check GitHub for a release newer than this build.
#[tauri::command]
async fn check_for_update(app: tauri::AppHandle) -> Result<Option<update::UpdateInfo>, String> {
    update::check(&app.package_info().version).await
}

/// Read a local .torrent file's bytes, refusing any other extension.
#[tauri::command]
fn read_file_bytes(path: String) -> Result<Vec<u8>, String> {
    if !is_torrent_path(&path) {
        return Err("only .torrent files can be read".into());
    }
    std::fs::read(&path).map_err(|e| format!("failed to read {path}: {e}"))
}

/// True when the path has a .torrent extension, in any case.
fn is_torrent_path(path: &str) -> bool {
    std::path::Path::new(path)
        .extension()
        .is_some_and(|e| e.eq_ignore_ascii_case("torrent"))
}

/// The .torrent path or magnet an argument names, None for any other argument.
fn torrent_arg(arg: &str) -> Option<&str> {
    // macOS file associations arrive as file:// URLs
    let path = arg.strip_prefix("file://").unwrap_or(arg);
    (is_torrent_path(path) || path.starts_with("magnet:")).then_some(path)
}

/// Emit an open-torrent event for a .torrent path or magnet, stashed until React mounts.
fn emit_open_torrent(app: &tauri::AppHandle, arg: &str) {
    let Some(path) = torrent_arg(arg) else { return };
    if let Some(state) = app.try_state::<AppState>() {
        // ready flag read under the stash lock, which get_initial_open holds to set it
        if let Ok(mut pending) = state.initial_open.lock()
            && !state.frontend_ready.load(std::sync::atomic::Ordering::SeqCst)
        {
            pending.push(path.to_string());
            return;
        }
    }
    app.emit("open-torrent", path.to_string()).ok();
}

/// Get and clear the cold-start .torrent and magnet args, marking the frontend ready.
#[tauri::command]
fn get_initial_open(state: State<'_, AppState>) -> Vec<String> {
    let mut pending = state.initial_open.lock().unwrap();
    state.frontend_ready.store(true, std::sync::atomic::Ordering::SeqCst);
    std::mem::take(&mut *pending)
}

/// Recent activity entries, oldest first.
#[tauri::command]
fn get_activity_log(state: State<'_, AppState>) -> Vec<crate::log::LogEntry> {
    state.activity_log.entries()
}

/// Clear the activity log in memory and in the database.
#[tauri::command]
fn clear_activity_log(state: State<'_, AppState>) {
    state.activity_log.clear();
}

/// Update the tray tooltip and the speed line in the tray menu.
#[tauri::command]
fn update_tray_info(
    state: State<'_, AppState>,
    tooltip: String,
    menu_text: String,
) -> Result<(), String> {
    if let Some(tray) = state.tray.lock().unwrap().as_ref() {
        tray.set_tooltip(Some(&tooltip)).ok();
    }
    if let Some(info) = state.tray_info.lock().unwrap().as_ref() {
        info.set_text(&menu_text).ok();
    }
    Ok(())
}

/// Connect from the saved config if possible, then build and run the Tauri app.
#[tokio::main]
async fn main() {
    let (client, tunnel, connect_error) = match config::connect_from_config().await {
        Ok((c, t)) => (Some(c), t, None),
        Err(e) => (None, None, Some((is_unreachable(&*e), e.to_string()))),
    };

    let capabilities = if let Some(ref c) = client {
        c.list_methods().await.ok().map(|m| ServerCapabilities::from_methods(&m))
    } else {
        None
    };

    let client_connected = client.is_some();
    let loaded_config = Config::load().ok();
    let active_profile = if client_connected {
        loaded_config.as_ref().map(|c| c.active.clone())
    } else {
        None
    };
    let state_active_name = active_profile.clone().unwrap_or_default();
    let active_conn = loaded_config.as_ref()
        .and_then(|c| c.active_connection().cloned());
    // an unreachable host is worth retrying, a bad password or config is not
    let retry_target = connect_error.as_ref()
        .filter(|(unreachable, _)| *unreachable)
        .and_then(|_| Some((loaded_config.as_ref()?.active.clone(), active_conn.clone()?)));
    let launch = connect_error.map(|(_, e)| LaunchStatus {
        error: match &loaded_config {
            Some(c) => format!("Could not connect to '{}': {e}", c.active),
            None => format!("Could not connect: {e}"),
        },
        attempt: 0,
        retry_at: retry_target.as_ref().map(|_| unix_now() + LAUNCH_RETRY_FIRST.as_secs() as i64),
    });

    let mut db_error = None;
    let db = Arc::new({
        let disk_db = config::config_dir()
            .and_then(|dir| match Database::open(&dir.join("ctrlr.db")) {
                Ok(db) => Some(db),
                Err(e) => {
                    db_error = Some(e.to_string());
                    None
                }
            });
        match disk_db {
            Some(db) => db,
            None => Database::open(std::path::Path::new(":memory:"))
                .expect("in-memory database must not fail"),
        }
    });

    let activity_log = Arc::new(ActivityLog::new(db.clone()));
    if let Some(e) = db_error {
        activity_log.error("database", format!("Failed to open database, history is kept only until exit: {e}"));
    }

    let client_arc = Arc::new(Mutex::new(client.map(Arc::new)));
    let rss_manager = Arc::new(rss::RssManager::new(
        client_arc.clone(),
        activity_log.clone(),
        db.clone(),
    ));

    let scheduler_manager = Arc::new(scheduler::SchedulerManager::new(
        client_arc.clone(),
        activity_log.clone(),
    ));

    let state = AppState {
        client: client_arc,
        tunnel: Arc::new(Mutex::new(tunnel)),
        initial_open: std::sync::Mutex::new(Vec::new()),
        frontend_ready: std::sync::atomic::AtomicBool::new(false),
        active_profile: Arc::new(Mutex::new(active_profile)),
        capabilities: Arc::new(Mutex::new(capabilities)),
        activity_log: activity_log.clone(),
        db: db.clone(),
        rss_manager: rss_manager.clone(),
        scheduler: scheduler_manager.clone(),
        tray: Arc::new(std::sync::Mutex::new(None)),
        tray_info: Arc::new(std::sync::Mutex::new(None)),
        launch: Mutex::new(launch.clone()),
        history_sync: Mutex::new(HistorySync::default()),
    };

    if client_connected {
        let desc = active_conn.as_ref().map_or_else(|| "unknown".into(), conn_desc);
        activity_log.info("connection", format!("Connected to '{}' ({desc})", state_active_name));
    }
    if let Some(l) = launch {
        activity_log.error("connection", l.error);
    }
    activity_log.info("connection", "Application started");

    tauri::Builder::default()
        // single-instance must be registered before deep-link
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            show_main_window(app);
            // the deep-link plugin has already delivered any magnet among these args
            for arg in argv[1..].iter().filter(|a| !a.starts_with("magnet:")) {
                emit_open_torrent(app, arg);
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_window_state::Builder::new()
            // restoring VISIBLE would override start-minimized
            .with_state_flags(
                tauri_plugin_window_state::StateFlags::all()
                    & !tauri_plugin_window_state::StateFlags::VISIBLE
            )
            .build())
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            connection::save_and_connect,
            connection::is_connected,
            connection::disconnect,
            connection::get_capabilities,
            torrents::list_torrents,
            server::get_transfer_stats,
            server::get_speed_limits,
            torrents::add_torrent,
            torrents::add_torrent_file,
            torrents::parse_torrent_meta,
            torrents::parse_magnet_hash,
            torrents::add_torrent_configured,
            torrents::get_torrent_details,
            torrents::get_torrent_file,
            torrents::get_torrent_properties,
            torrents::set_torrent_properties,
            torrents::set_tags,
            torrents::set_date_added,
            torrents::set_file_priority,
            server::set_upload_limit,
            server::set_download_limit,
            server::get_system_info,
            server::get_default_directory,
            server::get_free_diskspace,
            server::get_disk_used,
            server::list_remote_directory,
            server::get_remote_settings,
            server::save_remote_settings,
            server::get_ratio_groups,
            server::save_ratio_groups,
            server::restore_ratio_groups,
            torrents::set_torrents_ratio_group,
            torrents::toggle_tracker,
            torrents::add_tracker,
            torrents::force_announce,
            torrents::ban_peer,
            torrents::disconnect_peer,
            torrents::disconnect_seeders,
            torrents::prioritize_first_piece,
            torrents::prioritize_last_piece,
            torrents::pause_torrents,
            torrents::resume_torrents,
            torrents::remove_torrents,
            torrents::recheck_torrents,
            torrents::reannounce_torrents,
            torrents::set_torrents_priority,
            torrents::set_torrents_throttle,
            torrents::move_torrents,
            read_file_bytes,
            connection::list_profiles,
            connection::get_profile_settings,
            connection::get_launch_status,
            connection::save_profile,
            connection::delete_profile,
            connection::rename_profile,
            connection::switch_profile,
            get_initial_open,
            get_activity_log,
            clear_activity_log,
            update_tray_info,
            set_start_minimized,
            set_autostart,
            show_window,
            hide_window,
            quit_app,
            check_for_update,
            history::history_list,
            history::history_get_blob,
            history::save_torrent_file,
            history::history_delete,
            rss::rss_list_feeds,
            rss::rss_save_feed,
            rss::rss_delete_feed,
            rss::rss_preview_feed,
            rss::rss_list_rules,
            rss::rss_save_rule,
            rss::rss_delete_rule,
            rss::rss_test_rule,
            rss::rss_get_history,
            rss::rss_clear_history,
            rss::rss_set_enabled,
            rss::rss_is_enabled,
            scheduler::scheduler_get_config,
            scheduler::scheduler_save_config,
            scheduler::scheduler_get_active,
        ])
        .setup(move |app| {
            app.state::<AppState>().activity_log.set_app_handle(app.handle().clone());

            if let Some((name, conn)) = retry_target {
                tauri::async_runtime::spawn(retry_launch_connect(app.handle().clone(), name, conn));
            }

            {
                let state = app.state::<AppState>();
                state.rss_manager.set_app_handle(app.handle().clone());
                let mgr = state.rss_manager.clone();
                tauri::async_runtime::spawn(async move {
                    if mgr.is_enabled().await {
                        mgr.start().await;
                    }
                });
            }

            {
                let sched = app.state::<AppState>().scheduler.clone();
                tauri::async_runtime::spawn(async move {
                    let cfg = sched.get_config().await;
                    if cfg.enabled {
                        sched.start().await;
                    }
                });
            }

            {
                let db = app.state::<AppState>().db.clone();
                let client = app.state::<AppState>().client.clone();
                let log = app.state::<AppState>().activity_log.clone();
                tauri::async_runtime::spawn(async move {
                    loop {
                        tokio::time::sleep(std::time::Duration::from_secs(60)).await;
                        let rpc = client.lock().await.clone();
                        let rpc = match rpc {
                            Some(c) => c,
                            None => continue,
                        };
                        let Ok(pending) = db.pending_blobs() else { continue };
                        for hash in pending {
                            history::archive_blob(&db, &log, &rpc, &hash).await;
                        }
                    }
                });
            }

            let db = &app.state::<AppState>().db;
            let log = &app.state::<AppState>().activity_log;
            if let Err(e) = db.rss_prune(5_000) {
                log.warn("database", format!("Failed to prune RSS history: {e}"));
            }
            if let Err(e) = db.prune_removed_blobs(90, unix_now()) {
                log.warn("database", format!("Failed to prune torrent blobs: {e}"));
            }
            if let Err(e) = db.log_prune(10_000) {
                log.warn("database", format!("Failed to prune activity log: {e}"));
            }

            // the HTML has an inline spinner, safe to show before React mounts
            let minimized = ctrlr_core::Config::load()
                .map(|c| c.start_minimized)
                .unwrap_or(false);
            if !minimized
                && let Some(w) = app.get_webview_window("main") {
                    w.show().ok();
                }

            // setup() runs before React mounts; the frontend reads the stash on mount
            let state_ref = app.state::<AppState>();
            let mut initial = state_ref.initial_open.lock().unwrap();
            for arg in std::env::args().skip(1) {
                if let Some(path) = torrent_arg(arg.trim()) {
                    initial.push(path.to_string());
                }
            }
            drop(initial);

            use tauri_plugin_deep_link::DeepLinkExt;
            let handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                for url in event.urls() {
                    emit_open_torrent(&handle, url.as_str());
                }
            });

            let info = MenuItemBuilder::with_id("info", "Ctrl+R")
                .enabled(false)
                .build(app)?;
            let show = MenuItemBuilder::with_id("show", "Show Ctrl+R").build(app)?;
            let quit = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
            let sep = tauri::menu::PredefinedMenuItem::separator(app)?;
            let menu = MenuBuilder::new(app).items(&[&info, &sep, &show, &quit]).build()?;

            let tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .tooltip("Ctrl+R")
                .on_menu_event(|app, event| {
                    match event.id().as_ref() {
                        "show" => show_main_window(app),
                        "quit" => {
                            let app = app.clone();
                            tauri::async_runtime::spawn(async move {
                                let state = app.state::<AppState>();
                                shutdown(&app, &state).await;
                            });
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::DoubleClick { .. } = event {
                        show_main_window(tray.app_handle());
                    }
                })
                .build(app)?;

            let state_ref = app.state::<AppState>();
            *state_ref.tray.lock().unwrap() = Some(tray);
            *state_ref.tray_info.lock().unwrap() = Some(info);

            Ok(())
        })
        // frontend chooses between hide to tray and quit
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                window.emit("close-requested", ()).ok();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
