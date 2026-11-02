//! RSS download history the matcher reads for GUID and episode dedup.
use std::sync::Arc;

use serde::{Deserialize, Serialize};

use crate::db::Database;

/// One RSS download as stored in history.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadRecord {
    pub timestamp: i64,
    pub feed: String,
    pub rule: String,
    pub guid: String,
    pub title: String,
    pub hash: String,
    pub season: u32,
    pub episode: u32,
}

/// RSS download history over the SQLite database; every method swallows database errors.
pub struct DownloadHistory {
    db: Arc<Database>,
}

impl DownloadHistory {
    /// Create a history backed by the shared database.
    pub fn new(db: Arc<Database>) -> Self {
        Self { db }
    }

    /// Add a download record for later GUID and episode dedup.
    pub fn add(&self, record: DownloadRecord) {
        self.db.rss_add(&record).ok();
    }

    /// Whether any rule already downloaded an item with the GUID.
    pub fn has_guid(&self, guid: &str) -> bool {
        self.db.rss_has_guid(guid).unwrap_or(false)
    }

    /// Whether the rule already downloaded the season and episode.
    pub fn has_episode(&self, rule: &str, season: u32, episode: u32) -> bool {
        self.db.rss_has_episode(rule, season, episode).unwrap_or(false)
    }

    /// Title of the rule's latest download of the episode, for quality comparison.
    pub fn episode_title(&self, rule: &str, season: u32, episode: u32) -> Option<String> {
        self.db.rss_episode_title(rule, season, episode).unwrap_or(None)
    }

    /// Most recent downloads, newest first.
    pub fn recent(&self, limit: usize) -> Vec<DownloadRecord> {
        self.db.rss_recent(limit as i64).unwrap_or_default()
    }

    /// Clear the download history of every rule.
    pub fn clear(&self) {
        self.db.rss_clear().ok();
    }

    /// Clear the download history of one rule.
    pub fn clear_rule(&self, rule: &str) {
        self.db.rss_clear_rule(rule).ok();
    }
}
