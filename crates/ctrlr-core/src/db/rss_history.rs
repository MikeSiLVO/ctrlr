//! RSS download history table, read for GUID and episode dedup.
use rusqlite::params;

use super::Database;
use crate::rss::history::DownloadRecord;

impl Database {
    /// Add a record to the RSS download history.
    pub fn rss_add(&self, record: &DownloadRecord) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO rss_downloads (timestamp, feed, rule, guid, title, hash, season, episode) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
            params![record.timestamp, record.feed, record.rule, record.guid, record.title, record.hash, record.season, record.episode],
        ).map_err(|e| format!("failed to insert rss record: {e}"))?;
        Ok(())
    }

    /// Prune all but the most recent records.
    pub fn rss_prune(&self, keep: i64) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM rss_downloads WHERE id NOT IN (SELECT id FROM rss_downloads ORDER BY id DESC LIMIT ?1)",
            params![keep],
        ).map_err(|e| format!("failed to prune rss history: {e}"))?;
        Ok(())
    }

    /// Whether an item with this GUID was already downloaded.
    pub fn rss_has_guid(&self, guid: &str) -> Result<bool, String> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM rss_downloads WHERE guid = ?1)",
            params![guid],
            |row| row.get(0),
        ).map_err(|e| format!("query failed: {e}"))
    }

    /// Whether this rule already downloaded the episode.
    pub fn rss_has_episode(&self, rule: &str, season: u32, episode: u32) -> Result<bool, String> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM rss_downloads WHERE rule = ?1 AND season = ?2 AND episode = ?3)",
            params![rule, season, episode],
            |row| row.get(0),
        ).map_err(|e| format!("query failed: {e}"))
    }

    /// Title of this rule's newest download of the episode.
    pub fn rss_episode_title(&self, rule: &str, season: u32, episode: u32) -> Result<Option<String>, String> {
        let conn = self.conn.lock().unwrap();
        match conn.query_row(
            "SELECT title FROM rss_downloads WHERE rule = ?1 AND season = ?2 AND episode = ?3 ORDER BY timestamp DESC LIMIT 1",
            params![rule, season, episode],
            |row| row.get(0),
        ) {
            Ok(title) => Ok(Some(title)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(format!("query failed: {e}")),
        }
    }

    /// The most recent records, newest first.
    pub fn rss_recent(&self, limit: i64) -> Result<Vec<DownloadRecord>, String> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT timestamp, feed, rule, guid, title, hash, season, episode FROM rss_downloads ORDER BY timestamp DESC LIMIT ?1"
        ).map_err(|e| format!("query failed: {e}"))?;
        let rows = stmt.query_map(params![limit], |row| {
            Ok(DownloadRecord {
                timestamp: row.get(0)?,
                feed: row.get(1)?,
                rule: row.get(2)?,
                guid: row.get(3)?,
                title: row.get(4)?,
                hash: row.get(5)?,
                season: row.get(6)?,
                episode: row.get(7)?,
            })
        }).map_err(|e| format!("query failed: {e}"))?
        .filter_map(|r| r.ok())
        .collect();
        Ok(rows)
    }

    /// Clear every RSS download record.
    pub fn rss_clear(&self) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM rss_downloads", [])
            .map_err(|e| format!("failed to clear: {e}"))?;
        Ok(())
    }

    /// Clear the RSS download records of one rule.
    pub fn rss_clear_rule(&self, rule: &str) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM rss_downloads WHERE rule = ?1", params![rule])
            .map_err(|e| format!("failed to clear rule: {e}"))?;
        Ok(())
    }
}
