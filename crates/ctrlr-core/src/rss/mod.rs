//! RSS feed config, release title parsing, rule matching and download history.

pub mod config;
pub mod history;
pub mod matcher;
pub mod parser;

pub use config::{RssConfig, RssFeed, RssRule};
pub use history::{DownloadHistory, DownloadRecord};
pub use matcher::MatchResult;
pub use parser::EpisodeInfo;
