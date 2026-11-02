//! RSS auto-download, polling feeds and adding what the rules match to rTorrent.

use std::collections::BTreeMap;
use std::sync::{Arc, LazyLock};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{Emitter, State};
use tokio::sync::Mutex;

use ctrlr_core::db::Database;
use ctrlr_core::db::history::NewTorrentHistory;
use ctrlr_core::rss::config::{RssConfig, RssFeed, RssRule};
use ctrlr_core::rss::history::{DownloadHistory, DownloadRecord};
use ctrlr_core::rss::matcher;
use ctrlr_core::RtorrentClient;

use crate::AppState;
use crate::background::BackgroundLoop;
use crate::history::record_history;
use crate::log::ActivityLog;

/// One entry parsed from a feed.
#[derive(Debug, Clone, Serialize)]
pub struct FeedItem {
    pub title: String,
    pub guid: String,
    pub link: String,
    pub published: Option<i64>,
}

/// Background loop that polls feeds and adds the torrents the rules match.
pub struct RssManager {
    config: Arc<Mutex<RssConfig>>,
    history: Arc<DownloadHistory>,
    client: Arc<Mutex<Option<Arc<RtorrentClient>>>>,
    activity_log: Arc<ActivityLog>,
    db: Arc<Database>,
    app_handle: Arc<Mutex<Option<tauri::AppHandle>>>,
    /// Last poll time per feed.
    last_poll: Arc<Mutex<BTreeMap<String, Instant>>>,
    task: BackgroundLoop,
    /// Why rss.toml could not be read at launch; while set, nothing writes it.
    load_error: Option<String>,
}

impl RssManager {
    /// RSS manager with its config loaded from rss.toml, not yet started; logs a read failure.
    pub fn new(
        client: Arc<Mutex<Option<Arc<RtorrentClient>>>>,
        activity_log: Arc<ActivityLog>,
        db: Arc<Database>,
    ) -> Self {
        let (config, load_error) = match RssConfig::load() {
            Ok(config) => (config, None),
            Err(e) => {
                activity_log.error("rss", format!("Could not read rss.toml: {e}"));
                (RssConfig::default(), Some(e))
            }
        };
        let history = DownloadHistory::new(db.clone());

        Self {
            config: Arc::new(Mutex::new(config)),
            history: Arc::new(history),
            client,
            activity_log,
            db,
            app_handle: Arc::new(Mutex::new(None)),
            last_poll: Arc::new(Mutex::new(BTreeMap::new())),
            task: BackgroundLoop::default(),
            load_error,
        }
    }

    /// Check rss.toml loaded at launch, failing with its read error when it did not.
    pub fn check_loaded(&self) -> Result<(), String> {
        match &self.load_error {
            Some(e) => Err(format!("rss.toml could not be read, RSS changes are not saved: {e}")),
            None => Ok(()),
        }
    }

    /// Set the app handle used to emit RSS events, from a spawned task.
    pub fn set_app_handle(&self, handle: tauri::AppHandle) {
        let app = self.app_handle.clone();
        tokio::spawn(async move {
            *app.lock().await = Some(handle);
        });
    }

    /// Start the 30 second poll loop unless it is already running.
    pub async fn start(&self) {
        let config = self.config.clone();
        let history = self.history.clone();
        let client = self.client.clone();
        let activity_log = self.activity_log.clone();
        let db = self.db.clone();
        let app_handle = self.app_handle.clone();
        let last_poll = self.last_poll.clone();

        self.task.start(async move {
            loop {
                tokio::time::sleep(Duration::from_secs(30)).await;

                let cfg = config.lock().await.clone();
                if !cfg.enabled {
                    continue;
                }

                let rpc = client.lock().await.clone();
                let rpc = match rpc {
                    Some(c) => c,
                    None => continue,
                };

                let now = Instant::now();
                for (feed_name, feed) in &cfg.feeds {
                    if !feed.enabled {
                        continue;
                    }

                    let mut polls = last_poll.lock().await;
                    let should_poll = match polls.get(feed_name) {
                        Some(last) => now.duration_since(*last).as_secs() >= feed.poll_secs,
                        None => true,
                    };
                    if !should_poll {
                        continue;
                    }
                    polls.insert(feed_name.clone(), now);
                    drop(polls);

                    match fetch_feed(&feed.url, &feed.cookie).await {
                        Ok(items) => {
                            let handle = app_handle.lock().await;
                            if let Some(ref h) = *handle {
                                h.emit("rss-feed-update", feed_name.as_str()).ok();
                            }
                            drop(handle);

                            for item in &items {
                                let m = matcher::find_matching_rule(
                                    &item.title,
                                    &item.guid,
                                    feed_name,
                                    cfg.rules.iter(),
                                    &history,
                                );

                                if let Some(m) = m {
                                    let rule = match cfg.rules.get(&m.rule_name) {
                                        Some(r) => r,
                                        None => continue,
                                    };

                                    let mut torrent_data: Option<Vec<u8>> = None;
                                    let added = if item.link.starts_with("magnet:") {
                                        rpc.add_torrent_with_options(
                                            &item.link, Some(&rule.directory),
                                            Some(&rule.label), Some(&rule.throttle),
                                        ).await
                                    } else {
                                        match fetch_bytes(&item.link, &feed.cookie).await {
                                            Ok(data) => {
                                                let result = rpc.add_torrent_file_with_options(
                                                    &data, Some(&rule.directory),
                                                    Some(&rule.label), Some(&rule.throttle),
                                                ).await;
                                                torrent_data = Some(data);
                                                result
                                            }
                                            Err(e) => {
                                                activity_log.error(
                                                    "rss",
                                                    format!("Failed to download .torrent for '{}': {e}", item.title),
                                                );
                                                continue;
                                            }
                                        }
                                    };

                                    match added {
                                        Ok(()) => {
                                            activity_log.info(
                                                "rss",
                                                format!(
                                                    "Auto-downloaded '{}' (rule: {})",
                                                    item.title, rule.name
                                                ),
                                            );

                                            let now_ts = crate::unix_now();
                                            let ep = m.episode_info.as_ref();
                                            // before any await; an abort must still record it
                                            history.add(DownloadRecord {
                                                timestamp: now_ts,
                                                feed: feed_name.clone(),
                                                rule: rule.name.clone(),
                                                guid: item.guid.clone(),
                                                title: item.title.clone(),
                                                hash: String::new(),
                                                season: ep.map_or(0, |e| e.season),
                                                episode: ep.map_or(0, |e| e.episode),
                                            });

                                            if let Some(ref data) = torrent_data {
                                                if let Ok(meta) = ctrlr_core::meta::parse(data) {
                                                    record_history(&db, &activity_log, &NewTorrentHistory {
                                                        info_hash: &meta.info_hash, name: &meta.name,
                                                        total_size: meta.total_size, directory: &rule.directory,
                                                        source: "rss", added_at: now_ts, torrent_blob: Some(data),
                                                        ..Default::default()
                                                    });
                                                }
                                            } else if item.link.starts_with("magnet:")
                                                && let Some(hash) = ctrlr_core::meta::parse_magnet_hash(&item.link) {
                                                    record_history(&db, &activity_log, &NewTorrentHistory {
                                                        info_hash: &hash, name: &item.title,
                                                        directory: &rule.directory, source: "rss",
                                                        added_at: now_ts, ..Default::default()
                                                    });
                                                }

                                            let handle = app_handle.lock().await;
                                            if let Some(ref h) = *handle {
                                                h.emit("rss-match", &item.title).ok();
                                            }
                                        }
                                        Err(e) => {
                                            activity_log.error(
                                                "rss",
                                                format!(
                                                    "Failed to add '{}': {e}",
                                                    item.title
                                                ),
                                            );
                                        }
                                    }
                                }
                            }
                        }
                        Err(e) => {
                            activity_log.warn(
                                "rss",
                                format!("Failed to fetch feed '{}': {e}", feed_name),
                            );
                        }
                    }
                }
            }
        }).await;
    }

    /// Stop the loop if it is running.
    pub async fn stop(&self) {
        self.task.stop().await;
    }

    /// List every feed with its key.
    pub async fn list_feeds(&self) -> Vec<(String, RssFeed)> {
        let cfg = self.config.lock().await;
        cfg.feeds.iter().map(|(k, v)| (k.clone(), v.clone())).collect()
    }

    /// Save a feed under its key and write rss.toml; a rename refuses a taken key and updates rules.
    pub async fn save_feed(
        &self, key: String, feed: RssFeed, previous_key: Option<&str>,
    ) -> Result<(), String> {
        self.check_loaded()?;
        let mut cfg = self.config.lock().await;
        if let Some(old) = previous_key.filter(|old| *old != key) {
            if cfg.feeds.contains_key(&key) {
                return Err(format!("feed '{key}' already exists"));
            }
            cfg.feeds.remove(old);
            for name in cfg.rules.values_mut().flat_map(|r| r.feeds.iter_mut()) {
                if *name == old {
                    *name = key.clone();
                }
            }
        }
        cfg.feeds.insert(key, feed);
        cfg.save()
    }

    /// Delete a feed and write rss.toml.
    pub async fn delete_feed(&self, name: &str) -> Result<(), String> {
        self.check_loaded()?;
        let mut cfg = self.config.lock().await;
        cfg.feeds.remove(name);
        cfg.save()
    }

    /// List every rule with its key.
    pub async fn list_rules(&self) -> Vec<(String, RssRule)> {
        let cfg = self.config.lock().await;
        cfg.rules.iter().map(|(k, v)| (k.clone(), v.clone())).collect()
    }

    /// Save a valid rule under its key, replacing any existing one, and write rss.toml.
    pub async fn save_rule(&self, key: String, rule: RssRule) -> Result<(), String> {
        self.check_loaded()?;
        matcher::validate_rule(&rule)?;
        let mut cfg = self.config.lock().await;
        cfg.rules.insert(key, rule);
        cfg.save()
    }

    /// Delete a rule and write rss.toml.
    pub async fn delete_rule(&self, name: &str) -> Result<(), String> {
        self.check_loaded()?;
        let mut cfg = self.config.lock().await;
        cfg.rules.remove(name);
        cfg.save()
    }

    /// Feed url and cookie, copied out so no lock is held across the fetch.
    async fn feed_target(&self, name: &str) -> Result<(String, String), String> {
        let cfg = self.config.lock().await;
        let feed = cfg.feeds.get(name).ok_or("feed not found")?;
        Ok((feed.url.clone(), feed.cookie.clone()))
    }

    /// Preview a feed's items without matching rules or touching the poll timer.
    pub async fn preview_feed(&self, name: &str) -> Result<Vec<FeedItem>, String> {
        let (url, cookie) = self.feed_target(name).await?;
        fetch_feed(&url, &cookie).await
    }

    /// Test a rule against a feed's live items and history, without downloading.
    pub async fn test_rule(
        &self,
        rule: &RssRule,
        feed_name: &str,
    ) -> Result<Vec<matcher::MatchResult>, String> {
        let (url, cookie) = self.feed_target(feed_name).await?;
        let items = fetch_feed(&url, &cookie).await?;
        let mut results = Vec::new();
        for item in &items {
            if let Some(m) = matcher::match_item(&item.title, &item.guid, rule, &self.history) {
                results.push(m);
            }
        }
        Ok(results)
    }

    /// Get the most recent download records, newest first.
    pub fn get_history(&self, limit: usize) -> Vec<DownloadRecord> {
        self.history.recent(limit)
    }

    /// Clear download history for one rule, or for every rule.
    pub fn clear_history(&self, rule: Option<&str>) {
        match rule {
            Some(r) => self.history.clear_rule(r),
            None => self.history.clear(),
        }
    }

    /// Set the enabled flag and write rss.toml, without starting or stopping the loop.
    pub async fn set_enabled(&self, enabled: bool) -> Result<(), String> {
        self.check_loaded()?;
        let mut cfg = self.config.lock().await;
        cfg.enabled = enabled;
        cfg.save()
    }

    /// Whether auto-download is enabled in the config.
    pub async fn is_enabled(&self) -> bool {
        self.config.lock().await.enabled
    }
}

/// HTTP client shared by every feed and .torrent request; a stalled tracker must not hang a poll.
static FEED_CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(60))
        .build()
        .unwrap_or_default()
});

/// Fetch a feed or .torrent url's body, sending the cookie when set; fails on a non-2xx status.
async fn fetch_bytes(url: &str, cookie: &str) -> Result<Vec<u8>, String> {
    let mut req = FEED_CLIENT.get(url);
    if !cookie.is_empty() {
        req = req.header("Cookie", cookie);
    }
    let resp = req.send().await.map_err(|e| format!("HTTP error: {e}"))?;
    // the url can carry a tracker passkey
    let resp = resp.error_for_status().map_err(|e| format!("HTTP error: {}", e.without_url()))?;
    let bytes = resp.bytes().await.map_err(|e| format!("read error: {e}"))?;
    Ok(bytes.into())
}

/// Fetch and parse a feed, sending the cookie when one is set.
async fn fetch_feed(url: &str, cookie: &str) -> Result<Vec<FeedItem>, String> {
    let bytes = fetch_bytes(url, cookie).await?;
    let feed = feed_rs::parser::parse(&bytes[..]).map_err(|e| format!("parse error: {e}"))?;

    Ok(feed
        .entries
        .into_iter()
        .map(|entry| {
            let title = entry.title.map_or_else(String::new, |t| t.content);
            let guid = entry
                .id;
            let link = entry
                .links
                .first()
                .map(|l| l.href.clone())
                .or_else(|| {
                    // some feeds put the download link in an enclosure
                    entry.media.first().and_then(|m| {
                        m.content.first().and_then(|c| c.url.as_ref().map(|u| u.to_string()))
                    })
                })
                .unwrap_or_default();
            let published = entry.published.or(entry.updated).map(|dt| dt.timestamp());

            FeedItem {
                title,
                guid,
                link,
                published,
            }
        })
        .collect())
}

/// Feed config flattened with its key, as the frontend sends and receives it.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RssFeedEntry {
    key: String,
    url: String,
    poll_secs: u64,
    enabled: bool,
    cookie: String,
}

/// Rule config flattened with its key, as the frontend sends and receives it.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RssRuleEntry {
    key: String,
    name: String,
    pattern: String,
    exclude: String,
    feeds: Vec<String>,
    directory: String,
    label: String,
    throttle: String,
    smart_episode: bool,
    quality: Vec<String>,
    start_season: u32,
    start_episode: u32,
    enabled: bool,
}

impl From<RssRuleEntry> for RssRule {
    fn from(rule: RssRuleEntry) -> Self {
        RssRule {
            name: rule.name,
            pattern: rule.pattern,
            exclude: rule.exclude,
            feeds: rule.feeds,
            directory: rule.directory,
            label: rule.label,
            throttle: rule.throttle,
            smart_episode: rule.smart_episode,
            quality: rule.quality,
            start_season: rule.start_season,
            start_episode: rule.start_episode,
            enabled: rule.enabled,
        }
    }
}

/// List every configured feed, failing if rss.toml was unreadable at launch.
#[tauri::command]
pub async fn rss_list_feeds(state: State<'_, AppState>) -> Result<Vec<RssFeedEntry>, String> {
    state.rss_manager.check_loaded()?;
    Ok(state
        .rss_manager
        .list_feeds()
        .await
        .into_iter()
        .map(|(key, f)| RssFeedEntry {
            key,
            url: f.url,
            poll_secs: f.poll_secs,
            enabled: f.enabled,
            cookie: f.cookie,
        })
        .collect())
}

/// Save a feed, creating it or replacing the one with its key; renaming one refuses a taken key.
#[tauri::command]
pub async fn rss_save_feed(
    state: State<'_, AppState>,
    feed: RssFeedEntry,
    previous_key: Option<String>,
) -> Result<(), String> {
    state
        .rss_manager
        .save_feed(
            feed.key,
            ctrlr_core::rss::RssFeed {
                url: feed.url,
                poll_secs: feed.poll_secs,
                enabled: feed.enabled,
                cookie: feed.cookie,
            },
            previous_key.as_deref(),
        )
        .await
}

/// Delete a feed, which also stops it being polled.
#[tauri::command]
pub async fn rss_delete_feed(state: State<'_, AppState>, name: String) -> Result<(), String> {
    state.rss_manager.delete_feed(&name).await
}

/// Preview a feed's current items without matching rules against them.
#[tauri::command]
pub async fn rss_preview_feed(
    state: State<'_, AppState>,
    name: String,
) -> Result<Vec<FeedItem>, String> {
    state.rss_manager.preview_feed(&name).await
}

/// List every configured rule, failing if rss.toml was unreadable at launch.
#[tauri::command]
pub async fn rss_list_rules(state: State<'_, AppState>) -> Result<Vec<RssRuleEntry>, String> {
    state.rss_manager.check_loaded()?;
    Ok(state
        .rss_manager
        .list_rules()
        .await
        .into_iter()
        .map(|(key, r)| RssRuleEntry {
            key,
            name: r.name,
            pattern: r.pattern,
            exclude: r.exclude,
            feeds: r.feeds,
            directory: r.directory,
            label: r.label,
            throttle: r.throttle,
            smart_episode: r.smart_episode,
            quality: r.quality,
            start_season: r.start_season,
            start_episode: r.start_episode,
            enabled: r.enabled,
        })
        .collect())
}

/// Save a rule, creating or replacing one by key; refuses broken patterns or a catch-all exclude.
#[tauri::command]
pub async fn rss_save_rule(state: State<'_, AppState>, rule: RssRuleEntry) -> Result<(), String> {
    let key = rule.key.clone();
    state.rss_manager.save_rule(key, rule.into()).await
}

/// Delete a rule, leaving its download history in place.
#[tauri::command]
pub async fn rss_delete_rule(state: State<'_, AppState>, name: String) -> Result<(), String> {
    state.rss_manager.delete_rule(&name).await
}

/// Test which of a feed's live items a rule would match, without downloading.
#[tauri::command]
pub async fn rss_test_rule(
    state: State<'_, AppState>,
    rule: RssRuleEntry,
    feed: String,
) -> Result<Vec<ctrlr_core::rss::MatchResult>, String> {
    state.rss_manager.test_rule(&rule.into(), &feed).await
}

/// Recent auto-downloads, newest first.
#[tauri::command]
pub async fn rss_get_history(
    state: State<'_, AppState>,
    limit: usize,
) -> Result<Vec<ctrlr_core::rss::DownloadRecord>, String> {
    Ok(state.rss_manager.get_history(limit))
}

/// Clear auto-download history for one rule or every rule, resetting GUID and episode dedup.
#[tauri::command]
pub async fn rss_clear_history(
    state: State<'_, AppState>,
    rule: Option<String>,
) -> Result<(), String> {
    state.rss_manager.clear_history(rule.as_deref());
    Ok(())
}

/// Set background polling on or off, saving it to rss.toml and starting or stopping the loop.
#[tauri::command]
pub async fn rss_set_enabled(state: State<'_, AppState>, enabled: bool) -> Result<(), String> {
    state.rss_manager.set_enabled(enabled).await?;
    if enabled {
        state.rss_manager.start().await;
        state.activity_log.info("rss", "RSS auto-download enabled");
    } else {
        state.rss_manager.stop().await;
        state.activity_log.info("rss", "RSS auto-download disabled");
    }
    Ok(())
}

/// Whether background polling is on.
#[tauri::command]
pub async fn rss_is_enabled(state: State<'_, AppState>) -> Result<bool, String> {
    Ok(state.rss_manager.is_enabled().await)
}
