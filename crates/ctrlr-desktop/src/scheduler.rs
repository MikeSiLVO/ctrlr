//! Bandwidth scheduler applying a weekly grid of speed profiles to rTorrent.

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::State;
use tokio::sync::Mutex;

use chrono::{Datelike, Timelike};

use ctrlr_core::config::{load_toml, save_toml};
use ctrlr_core::RtorrentClient;

use crate::AppState;
use crate::background::BackgroundLoop;
use crate::log::ActivityLog;

/// Named speed profile, limits in KB/s with 0 for unlimited.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchedulerProfile {
    pub name: String,
    #[serde(default)]
    pub down_kb: u64,
    #[serde(default)]
    pub up_kb: u64,
}

/// Profile index for each hour of each day, 0 for unlimited.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchedulerGrid {
    #[serde(default = "default_day")]
    pub mon: Vec<usize>,
    #[serde(default = "default_day")]
    pub tue: Vec<usize>,
    #[serde(default = "default_day")]
    pub wed: Vec<usize>,
    #[serde(default = "default_day")]
    pub thu: Vec<usize>,
    #[serde(default = "default_day")]
    pub fri: Vec<usize>,
    #[serde(default = "default_day")]
    pub sat: Vec<usize>,
    #[serde(default = "default_day")]
    pub sun: Vec<usize>,
}

/// Default day of 24 unlimited hours.
fn default_day() -> Vec<usize> {
    vec![0; 24]
}

impl Default for SchedulerGrid {
    fn default() -> Self {
        Self {
            mon: default_day(),
            tue: default_day(),
            wed: default_day(),
            thu: default_day(),
            fri: default_day(),
            sat: default_day(),
            sun: default_day(),
        }
    }
}

impl SchedulerGrid {
    /// Get the profile index for a weekday counted from Monday, 0 when out of range.
    pub fn get(&self, day: usize, hour: usize) -> usize {
        let row = match day {
            0 => &self.mon,
            1 => &self.tue,
            2 => &self.wed,
            3 => &self.thu,
            4 => &self.fri,
            5 => &self.sat,
            6 => &self.sun,
            _ => return 0,
        };
        row.get(hour).copied().unwrap_or(0)
    }

    /// Get the profile index for the current local day and hour, with that day and hour.
    pub fn active_now(&self) -> SchedulerActive {
        let now = chrono::Local::now();
        let day = now.weekday().num_days_from_monday() as usize;
        let hour = now.hour() as usize;
        SchedulerActive { profile_index: self.get(day, hour), day, hour }
    }
}

/// Scheduler settings stored in scheduler.toml.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[derive(Default)]
pub struct SchedulerConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub profiles: Vec<SchedulerProfile>,
    #[serde(default)]
    pub grid: SchedulerGrid,
}

impl SchedulerConfig {
    /// Load scheduler.toml, or defaults when it does not exist.
    pub fn load() -> Result<Self, String> {
        load_toml("scheduler.toml")
    }

    /// Save scheduler.toml, readable by the owner only on Unix.
    pub fn save(&self) -> Result<(), String> {
        save_toml("scheduler.toml", self)
    }
}

/// Profile index the grid selects for the current day and hour.
#[derive(Debug, Clone, Serialize)]
pub struct SchedulerActive {
    pub profile_index: usize,
    pub day: usize,
    pub hour: usize,
}

/// Background loop that applies the grid's speed limits once a minute.
pub struct SchedulerManager {
    config: Arc<Mutex<SchedulerConfig>>,
    client: Arc<Mutex<Option<Arc<RtorrentClient>>>>,
    activity_log: Arc<ActivityLog>,
    task: BackgroundLoop,
    /// Last profile index applied; a tick on the same index sends no RPC.
    last_applied: Arc<Mutex<Option<usize>>>,
    /// Why scheduler.toml could not be read at launch; while set, nothing writes it.
    load_error: Option<String>,
}

impl SchedulerManager {
    /// Scheduler with its config loaded from scheduler.toml, not yet started; logs a read failure.
    pub fn new(
        client: Arc<Mutex<Option<Arc<RtorrentClient>>>>,
        activity_log: Arc<ActivityLog>,
    ) -> Self {
        let (config, load_error) = match SchedulerConfig::load() {
            Ok(config) => (config, None),
            Err(e) => {
                activity_log.error("scheduler", format!("Could not read scheduler.toml: {e}"));
                (SchedulerConfig::default(), Some(e))
            }
        };
        Self {
            config: Arc::new(Mutex::new(config)),
            client,
            activity_log,
            task: BackgroundLoop::default(),
            last_applied: Arc::new(Mutex::new(None)),
            load_error,
        }
    }

    /// Start the loop unless it is running; the first tick always applies the grid.
    pub async fn start(&self) {
        let config = self.config.clone();
        let client = self.client.clone();
        let activity_log = self.activity_log.clone();
        let last_applied = self.last_applied.clone();

        let started = self.task.start(async move {
            loop {
                tokio::time::sleep(std::time::Duration::from_secs(60)).await;

                let cfg = config.lock().await.clone();
                if !cfg.enabled {
                    continue;
                }

                let rpc = client.lock().await.clone();
                let rpc = match rpc {
                    Some(c) => c,
                    None => continue,
                };

                let profile_idx = cfg.grid.active_now().profile_index;

                let mut last = last_applied.lock().await;
                if *last == Some(profile_idx) {
                    continue;
                }

                // index 0 is Unlimited, profiles start at 1
                let (down_kb, up_kb) = if profile_idx == 0 {
                    (0i64, 0i64)
                } else {
                    match cfg.profiles.get(profile_idx - 1) {
                        Some(p) => (p.down_kb as i64, p.up_kb as i64),
                        None => (0, 0),
                    }
                };

                let profile_name = if profile_idx == 0 {
                    "Unlimited".to_string()
                } else {
                    cfg.profiles
                        .get(profile_idx - 1)
                        .map(|p| p.name.clone())
                        .unwrap_or_else(|| format!("Profile {profile_idx}"))
                };

                match (
                    rpc.set_download_limit(down_kb).await,
                    rpc.set_upload_limit(up_kb).await,
                ) {
                    (Ok(()), Ok(())) => {
                        *last = Some(profile_idx);
                        let down_desc = if down_kb == 0 {
                            "\u{221e}".to_string()
                        } else {
                            format!("{down_kb} KB/s")
                        };
                        let up_desc = if up_kb == 0 {
                            "\u{221e}".to_string()
                        } else {
                            format!("{up_kb} KB/s")
                        };
                        activity_log.info(
                            "scheduler",
                            format!(
                                "Applied profile '{profile_name}' (\u{2193}{down_desc} \u{2191}{up_desc})"
                            ),
                        );
                    }
                    (Err(e), _) | (_, Err(e)) => {
                        activity_log.warn(
                            "scheduler",
                            format!("Failed to apply profile '{profile_name}': {e}"),
                        );
                    }
                }
            }
        }).await;
        // safe after spawn: the loop sleeps 60s before its first read
        if started {
            *self.last_applied.lock().await = None;
        }
    }

    /// Stop the loop if it is running.
    pub async fn stop(&self) {
        self.task.stop().await;
    }

    /// Reset the applied profile so the next tick applies the grid to a new server.
    pub async fn reset(&self) {
        *self.last_applied.lock().await = None;
    }

    /// Get a copy of the current config.
    pub async fn get_config(&self) -> SchedulerConfig {
        self.config.lock().await.clone()
    }

    /// Check scheduler.toml loaded at launch, failing with its read error when it did not.
    pub fn check_loaded(&self) -> Result<(), String> {
        match &self.load_error {
            Some(e) => Err(format!("scheduler.toml could not be read, schedule changes are not saved: {e}")),
            None => Ok(()),
        }
    }

    /// Save the config, starting or stopping the loop when the enabled flag flips.
    pub async fn save_config(&self, new_config: SchedulerConfig) -> Result<(), String> {
        self.check_loaded()?;
        new_config.save()?;
        let was_enabled = {
            let mut cfg = self.config.lock().await;
            let prev = cfg.enabled;
            *cfg = new_config.clone();
            prev
        };
        *self.last_applied.lock().await = None;
        if new_config.enabled && !was_enabled {
            self.start().await;
        } else if !new_config.enabled && was_enabled {
            self.stop().await;
        }
        Ok(())
    }

    /// Get the profile index the grid selects right now.
    pub async fn get_active(&self) -> SchedulerActive {
        self.config.lock().await.grid.active_now()
    }
}

/// Speed profiles and the 7x24 grid, failing if scheduler.toml was unreadable at launch.
#[tauri::command]
pub async fn scheduler_get_config(state: State<'_, AppState>) -> Result<SchedulerConfig, String> {
    state.scheduler.check_loaded()?;
    Ok(state.scheduler.get_config().await)
}

/// Save the schedule, starting or stopping the loop and reapplying it on the next tick.
#[tauri::command]
pub async fn scheduler_save_config(state: State<'_, AppState>, config: SchedulerConfig) -> Result<(), String> {
    let was_enabled = state.scheduler.get_config().await.enabled;
    state.scheduler.save_config(config.clone()).await?;
    if config.enabled && !was_enabled {
        state.activity_log.info("scheduler", "Bandwidth scheduler enabled");
    } else if !config.enabled && was_enabled {
        state.activity_log.info("scheduler", "Bandwidth scheduler disabled");
    }
    Ok(())
}

/// Which profile the grid selects for the current day and hour.
#[tauri::command]
pub async fn scheduler_get_active(state: State<'_, AppState>) -> Result<SchedulerActive, String> {
    Ok(state.scheduler.get_active().await)
}
