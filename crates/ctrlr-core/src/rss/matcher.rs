//! Match feed items against download rules, with GUID, episode and quality checks.
use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};

use regex::Regex;
use serde::Serialize;

use super::config::RssRule;
use super::history::DownloadHistory;
use super::parser::{self, quality_rank};

/// Outcome of a feed item that passed a rule's patterns.
#[derive(Debug, Clone, Serialize)]
pub struct MatchResult {
    pub title: String,
    pub rule_name: String,
    pub guid: String,
    pub episode_info: Option<MatchEpisodeInfo>,
    /// Whether the item matched but will not download, from history or episode checks.
    pub skipped: bool,
    pub skip_reason: Option<String>,
}

/// Season, episode and quality parsed from a matched item.
#[derive(Debug, Clone, Serialize)]
pub struct MatchEpisodeInfo {
    pub season: u32,
    pub episode: u32,
    pub quality: Option<String>,
}

/// Compiled rule patterns keyed by source, None for invalid ones, cleared past 256 entries.
static REGEX_CACHE: LazyLock<Mutex<HashMap<String, Option<Regex>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// Compile a rule pattern case-insensitively through the cache, or None if it is invalid.
fn cached_regex(pattern: &str) -> Option<Regex> {
    let mut cache = REGEX_CACHE.lock().unwrap_or_else(|e| e.into_inner());
    if cache.len() > 256 {
        cache.clear();
    }
    cache
        .entry(pattern.to_string())
        .or_insert_with(|| Regex::new(&format!("(?i){pattern}")).ok())
        .clone()
}

/// Validate a rule's patterns: each must compile, and the exclude must not match every title.
pub fn validate_rule(rule: &RssRule) -> Result<(), String> {
    Regex::new(&format!("(?i){}", rule.pattern)).map_err(|e| format!("invalid pattern: {e}"))?;
    if rule.exclude.is_empty() {
        return Ok(());
    }
    let exclude = Regex::new(&format!("(?i){}", rule.exclude))
        .map_err(|e| format!("invalid exclude: {e}"))?;
    if exclude.is_match("") {
        return Err("exclude matches every title; check for an empty alternative like 720p|".into());
    }
    Ok(())
}

/// Why a rule with quality preferences skips this episode, None when it should download.
fn quality_skip_reason(
    quality: Option<&str>, rule: &RssRule, history: &DownloadHistory, season: u32, episode: u32,
) -> Option<String> {
    let rank = quality.and_then(|q| quality_rank(q, &rule.quality));
    let outside_prefs = quality.is_some() && rank.is_none();

    let Some(existing) = history.episode_title(&rule.name, season, episode) else {
        // an untagged first copy is taken, there is nothing to compare it with
        return outside_prefs.then(|| "quality not in preferences".to_string());
    };

    let Some(rank) = rank else {
        return Some(if outside_prefs {
            "quality not in preferences".to_string()
        } else {
            "already have episode, new has no quality tag".to_string()
        });
    };

    let old_quality = parser::parse_episode(&existing).and_then(|e| e.quality);
    match old_quality.as_deref().and_then(|q| quality_rank(q, &rule.quality)) {
        Some(old_rank) if rank >= old_rank => {
            Some(format!("already have {} quality", old_quality.unwrap_or_default()))
        }
        // an untagged or unlisted copy loses to any preferred one
        _ => None,
    }
}

/// Match a feed item against one rule, None when the rule is off or its patterns reject it.
pub fn match_item(
    title: &str,
    guid: &str,
    rule: &RssRule,
    history: &DownloadHistory,
) -> Option<MatchResult> {
    if !rule.enabled {
        return None;
    }

    if !cached_regex(&rule.pattern).is_some_and(|re| re.is_match(title)) {
        return None;
    }

    if !rule.exclude.is_empty() {
        match cached_regex(&rule.exclude) {
            Some(re) if re.is_match(title) => return None,
            // a broken exclude must not let through what it meant to exclude
            None => return None,
            Some(_) => {}
        }
    }

    if history.has_guid(guid) {
        return Some(MatchResult {
            title: title.to_string(),
            rule_name: rule.name.clone(),
            guid: guid.to_string(),
            episode_info: None,
            skipped: true,
            skip_reason: Some("already downloaded (GUID)".into()),
        });
    }

    if rule.smart_episode {
        if let Some(ep) = parser::parse_episode(title) {
            let ep_info = MatchEpisodeInfo {
                season: ep.season,
                episode: ep.episode,
                quality: ep.quality.clone(),
            };

            if !ep.date_based
                && (ep.season < rule.start_season
                    || (ep.season == rule.start_season && ep.episode < rule.start_episode))
            {
                return Some(MatchResult {
                    title: title.to_string(),
                    rule_name: rule.name.clone(),
                    guid: guid.to_string(),
                    episode_info: Some(ep_info),
                    skipped: true,
                    skip_reason: Some(format!(
                        "before start S{:02}E{:02}",
                        rule.start_season, rule.start_episode
                    )),
                });
            }

            let skip_reason = if !rule.quality.is_empty() {
                quality_skip_reason(ep.quality.as_deref(), rule, history, ep.season, ep.episode)
            } else if history.has_episode(&rule.name, ep.season, ep.episode) {
                Some("already downloaded episode".to_string())
            } else {
                None
            };

            return Some(MatchResult {
                title: title.to_string(),
                rule_name: rule.name.clone(),
                guid: guid.to_string(),
                episode_info: Some(ep_info),
                skipped: skip_reason.is_some(),
                skip_reason,
            });
        } else {
            // unnumbered titles are season packs, collections and the like
            return Some(MatchResult {
                title: title.to_string(),
                rule_name: rule.name.clone(),
                guid: guid.to_string(),
                episode_info: None,
                skipped: true,
                skip_reason: Some("no episode number found".into()),
            });
        }
    }

    Some(MatchResult {
        title: title.to_string(),
        rule_name: rule.name.clone(),
        guid: guid.to_string(),
        episode_info: None,
        skipped: false,
        skip_reason: None,
    })
}

/// Find the first rule in scope for the feed that matches the item and is not skipped.
pub fn find_matching_rule<'a>(
    title: &str,
    guid: &str,
    feed_name: &str,
    rules: impl Iterator<Item = (&'a String, &'a RssRule)>,
    history: &DownloadHistory,
) -> Option<MatchResult> {
    for (_, rule) in rules {
        if !rule.feeds.is_empty() && !rule.feeds.iter().any(|f| f == feed_name) {
            continue;
        }

        if let Some(result) = match_item(title, guid, rule, history)
            && !result.skipped {
                return Some(result);
            }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use crate::db::Database;
    use crate::rss::config::RssRule;
    use crate::rss::history::DownloadHistory;

    /// Rule matching test.show from S01E01, with or without smart episode handling.
    fn test_rule(smart: bool) -> RssRule {
        RssRule {
            name: "test-show".into(),
            pattern: "test.show".into(),
            exclude: String::new(),
            feeds: vec![],
            directory: String::new(),
            label: String::new(),
            throttle: String::new(),
            smart_episode: smart,
            quality: vec![],
            start_season: 1,
            start_episode: 1,
            enabled: true,
        }
    }

    /// History over a fresh in-memory database.
    fn empty_history() -> DownloadHistory {
        let db = Arc::new(Database::open(std::path::Path::new(":memory:")).unwrap());
        DownloadHistory::new(db)
    }

    /// Test.Show.S01E01.720p matches pattern test.show case-insensitively and is not skipped.
    #[test]
    fn test_plain_match() {
        let history = empty_history();
        let rule = test_rule(false);
        let result = match_item("Test.Show.S01E01.720p", "guid1", &rule, &history);
        assert!(result.is_some());
        assert!(!result.unwrap().skipped);
    }

    /// Test.Show.S01E01.720p.Spanish gives no result when an exclude of spanish matches it.
    #[test]
    fn test_exclude_pattern() {
        let history = empty_history();
        let mut rule = test_rule(false);
        rule.exclude = "spanish".into();
        let result = match_item(
            "Test.Show.S01E01.720p.Spanish",
            "guid1",
            &rule,
            &history,
        );
        assert!(result.is_none());
    }

    /// Smart rule preferring 1080p over 720p, with S01E01 already downloaded under a title.
    fn quality_case(downloaded: &str) -> (RssRule, DownloadHistory) {
        let mut rule = test_rule(true);
        rule.quality = vec!["1080p".into(), "720p".into()];
        let history = empty_history();
        history.add(crate::rss::history::DownloadRecord {
            timestamp: 1,
            feed: "feed".into(),
            rule: rule.name.clone(),
            guid: "old".into(),
            title: downloaded.into(),
            hash: String::new(),
            season: 1,
            episode: 1,
        });
        (rule, history)
    }

    /// Skip reason for a new S01E01 title under quality_case, None when it downloads.
    fn quality_verdict(downloaded: &str, new: &str) -> Option<String> {
        let (rule, history) = quality_case(downloaded);
        match_item(new, "new", &rule, &history).unwrap().skip_reason
    }

    /// Skip a second untagged copy of an episode already downloaded untagged.
    #[test]
    fn untagged_repeat_is_skipped() {
        let reason = quality_verdict("Test.Show.S01E01.WEB", "Test.Show.S01E01.HDTV");
        assert_eq!(reason.as_deref(), Some("already have episode, new has no quality tag"));
    }

    /// Skip a tagged copy outside the preferences, even after an untagged one.
    #[test]
    fn unlisted_quality_after_untagged_is_skipped() {
        let reason = quality_verdict("Test.Show.S01E01.WEB", "Test.Show.S01E01.480p");
        assert_eq!(reason.as_deref(), Some("quality not in preferences"));
    }

    /// Take a preferred quality over an untagged copy or a less preferred one.
    #[test]
    fn preferred_quality_upgrades() {
        assert_eq!(quality_verdict("Test.Show.S01E01.WEB", "Test.Show.S01E01.1080p"), None);
        assert_eq!(quality_verdict("Test.Show.S01E01.720p", "Test.Show.S01E01.1080p"), None);
    }

    /// Skip the same or a less preferred quality than the copy already downloaded.
    #[test]
    fn same_or_worse_quality_is_skipped() {
        let same = quality_verdict("Test.Show.S01E01.1080p", "Test.Show.S01E01.1080p.WEB");
        assert_eq!(same.as_deref(), Some("already have 1080p quality"));
        let worse = quality_verdict("Test.Show.S01E01.1080p", "Test.Show.S01E01.720p");
        assert_eq!(worse.as_deref(), Some("already have 1080p quality"));
    }

    /// Refuse an exclude with an empty alternative or a broken pattern; accept a plain exclude.
    #[test]
    fn validate_rule_refuses_catch_all_and_broken_patterns() {
        let mut rule = test_rule(false);
        rule.exclude = "720p|".into();
        assert!(validate_rule(&rule).unwrap_err().contains("every title"));
        rule.exclude = "(720p".into();
        assert!(validate_rule(&rule).unwrap_err().starts_with("invalid exclude"));
        rule.exclude = "720p|spanish".into();
        assert!(validate_rule(&rule).is_ok());
        rule.pattern = "[".into();
        assert!(validate_rule(&rule).unwrap_err().starts_with("invalid pattern"));
    }

    /// Other.Show.S01E01 gives no result against pattern test.show.
    #[test]
    fn test_no_match() {
        let history = empty_history();
        let rule = test_rule(false);
        let result = match_item("Other.Show.S01E01", "guid1", &rule, &history);
        assert!(result.is_none());
    }
}
