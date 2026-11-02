//! RSS feed and rule settings in ~/.ctrlr/rss.toml.
use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::config::{load_toml, save_toml};

/// A polled RSS feed and its fetch settings.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RssFeed {
    pub url: String,
    #[serde(default = "default_poll_secs")]
    pub poll_secs: u64,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub cookie: String,
}

/// Default feed poll interval in seconds.
fn default_poll_secs() -> u64 {
    300
}

/// Serde default for flags that start enabled.
fn default_true() -> bool {
    true
}

/// A download rule that matches feed item titles by regex.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RssRule {
    pub name: String,
    pub pattern: String,
    #[serde(default)]
    pub exclude: String,
    /// Feed names the rule applies to, empty for every feed.
    #[serde(default)]
    pub feeds: Vec<String>,
    #[serde(default)]
    pub directory: String,
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub throttle: String,
    #[serde(default)]
    pub smart_episode: bool,
    /// Accepted qualities, most preferred first.
    #[serde(default)]
    pub quality: Vec<String>,
    #[serde(default)]
    pub start_season: u32,
    #[serde(default)]
    pub start_episode: u32,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

/// RSS feeds and download rules, stored in rss.toml.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RssConfig {
    #[serde(default)]
    pub feeds: BTreeMap<String, RssFeed>,
    #[serde(default)]
    pub rules: BTreeMap<String, RssRule>,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

impl RssConfig {
    /// Load rss.toml, or defaults when it does not exist.
    pub fn load() -> Result<RssConfig, String> {
        load_toml("rss.toml")
    }

    /// Save rss.toml, readable by the owner only on Unix.
    pub fn save(&self) -> Result<(), String> {
        save_toml("rss.toml", self)
    }
}
