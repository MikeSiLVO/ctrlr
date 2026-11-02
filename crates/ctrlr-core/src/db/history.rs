//! Torrent history table: one row per add, its archived .torrent, and live status per server.
use serde::{Deserialize, Serialize};
use rusqlite::{params, OptionalExtension};

use super::Database;

/// One torrent history row, without the .torrent blob itself.
#[derive(Debug, Clone, Serialize)]
pub struct TorrentHistoryEntry {
    pub id: i64,
    pub info_hash: String,
    pub name: String,
    pub total_size: i64,
    pub directory: String,
    pub labels: Vec<String>,
    pub trackers: Vec<String>,
    pub source: String,
    pub is_private: bool,
    pub added_at: i64,
    pub removed_at: Option<i64>,
    pub has_blob: bool,
    /// Loaded on the connected server, or not yet removed while disconnected.
    pub loaded: bool,
}

/// Columns History can sort by.
#[derive(Debug, Default, Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum HistorySort {
    Name,
    Size,
    #[default]
    Added,
    Status,
}

/// Filters, sort order and page for one History listing.
#[derive(Debug, Default, Deserialize)]
pub struct HistoryQuery {
    pub page: i64,
    pub page_size: i64,
    pub search: Option<String>,
    pub source: Option<String>,
    /// Only loaded entries, or only removed ones.
    pub loaded: Option<bool>,
    pub sort: HistorySort,
    pub desc: bool,
}

/// One page of history entries, with the total count matching the filters.
#[derive(Debug, Clone, Serialize)]
pub struct TorrentHistoryPage {
    pub entries: Vec<TorrentHistoryEntry>,
    pub total: i64,
}

/// A torrent history row to insert.
#[derive(Default)]
pub struct NewTorrentHistory<'a> {
    pub info_hash: &'a str,
    pub name: &'a str,
    pub total_size: i64,
    pub directory: &'a str,
    pub labels: &'a [String],
    pub trackers: &'a [String],
    pub source: &'a str,
    pub is_private: bool,
    pub added_at: i64,
    pub torrent_blob: Option<&'a [u8]>,
}

impl Database {
    /// Add a history row under the uppercase hash, replacing any with the same hash and add time.
    pub fn add_torrent_history(&self, entry: &NewTorrentHistory<'_>) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        let labels_str = entry.labels.join(",");
        let trackers_str = entry.trackers.join("\n");
        conn.execute(
            "INSERT OR REPLACE INTO torrent_history (info_hash, name, total_size, directory, labels, trackers, source, is_private, added_at, torrent_blob)
             VALUES (upper(?1), ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![entry.info_hash, entry.name, entry.total_size, entry.directory, labels_str,
                    trackers_str, entry.source, entry.is_private as i32, entry.added_at, entry.torrent_blob],
        ).map_err(|e| format!("failed to insert torrent history: {e}"))?;
        Ok(())
    }

    /// Mark every live entry for this hash removed, leaving earlier lifetimes alone.
    pub fn mark_torrent_removed(&self, info_hash: &str, removed_at: i64) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE torrent_history SET removed_at = ?1 WHERE info_hash = upper(?2) AND removed_at IS NULL",
            params![removed_at, info_hash],
        ).map_err(|e| format!("failed to mark torrent removed: {e}"))?;
        Ok(())
    }

    /// Sync live status to one server's loaded hashes; entries with no server yet sync to any.
    pub fn sync_loaded(&self, server: &str, hashes: &[String], now: i64) -> Result<(), String> {
        let loaded = serde_json::to_string(hashes).map_err(|e| e.to_string())?;
        let err = |e: rusqlite::Error| format!("sync failed: {e}");
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction().map_err(err)?;
        // info hashes are unique; one loaded here puts all its entries on this server
        tx.execute(
            "UPDATE torrent_history SET server = ?1
             WHERE info_hash IN (SELECT upper(value) FROM json_each(?2)) AND server IS NOT ?1",
            params![server, loaded],
        ).map_err(err)?;
        // loaded with no live entry, as after a re-add outside Ctrl+R: the newest is live again
        tx.execute(
            "UPDATE torrent_history SET removed_at = NULL WHERE id IN (
                 SELECT max(id) FROM torrent_history
                 WHERE info_hash IN (SELECT upper(value) FROM json_each(?1))
                 GROUP BY info_hash HAVING count(removed_at) = count(*))",
            params![loaded],
        ).map_err(err)?;
        tx.execute(
            "UPDATE torrent_history SET removed_at = ?1
             WHERE removed_at IS NULL AND (server = ?2 OR server IS NULL)
             AND info_hash NOT IN (SELECT upper(value) FROM json_each(?3))",
            params![now, server, loaded],
        ).map_err(err)?;
        tx.commit().map_err(err)
    }

    /// Prune the .torrent blobs of entries removed before the cutoff, keeping the rows.
    pub fn prune_removed_blobs(&self, days: i64, now: i64) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE torrent_history SET torrent_blob = NULL
             WHERE torrent_blob IS NOT NULL AND removed_at IS NOT NULL AND removed_at < ?1",
            params![now - days * 86_400],
        ).map_err(|e| format!("failed to prune torrent blobs: {e}"))?;
        Ok(())
    }

    /// Get one page of history, its status from the connected list when given, else from removal.
    pub fn get_torrent_history(
        &self,
        query: &HistoryQuery,
        loaded: Option<&[String]>,
    ) -> Result<TorrentHistoryPage, String> {
        let hashes = serde_json::to_string(loaded.unwrap_or_default()).map_err(|e| e.to_string())?;
        // opens both queries even when unused: ?1 is the hashes, and every later ? numbers from 2
        let with = "WITH loaded(hash) AS (SELECT value FROM json_each(?1))";
        let is_loaded = if loaded.is_some() { "info_hash IN (SELECT hash FROM loaded)" } else { "removed_at IS NULL" };
        let is_removed = format!("NOT ({is_loaded})");

        let mut where_clauses = vec![];
        let mut bind_values: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(hashes)];

        if let Some(s) = &query.search {
            where_clauses.push("name LIKE ?".to_string());
            bind_values.push(Box::new(format!("%{s}%")));
        }
        if let Some(src) = &query.source {
            where_clauses.push("source = ?".to_string());
            bind_values.push(Box::new(src.clone()));
        }
        match query.loaded {
            Some(true) => where_clauses.push(is_loaded.to_string()),
            Some(false) => where_clauses.push(is_removed.clone()),
            None => {}
        }

        let where_sql = if where_clauses.is_empty() {
            String::new()
        } else {
            format!("WHERE {}", where_clauses.join(" AND "))
        };
        let key = match query.sort {
            HistorySort::Name => "COALESCE(NULLIF(name, ''), info_hash) COLLATE NOCASE",
            HistorySort::Size => "total_size",
            HistorySort::Added => "added_at",
            HistorySort::Status => &is_removed,
        };
        let dir = if query.desc { "DESC" } else { "ASC" };

        let conn = self.conn.lock().unwrap();
        let count_sql = format!("{with} SELECT COUNT(*) FROM torrent_history {where_sql}");
        let total: i64 = {
            let mut stmt = conn.prepare(&count_sql)
                .map_err(|e| format!("count query failed: {e}"))?;
            let refs: Vec<&dyn rusqlite::types::ToSql> = bind_values.iter().map(|b| b.as_ref()).collect();
            stmt.query_row(refs.as_slice(), |row| row.get(0))
                .map_err(|e| format!("count failed: {e}"))?
        };

        let query_sql = format!(
            "{with} SELECT id, info_hash, name, total_size, directory, labels, trackers, source, is_private, added_at, removed_at, torrent_blob IS NOT NULL, {is_loaded}
             FROM torrent_history {where_sql}
             ORDER BY {key} {dir}, added_at DESC, id DESC
             LIMIT ? OFFSET ?"
        );
        let mut all_binds: Vec<Box<dyn rusqlite::types::ToSql>> = bind_values;
        all_binds.push(Box::new(query.page_size));
        all_binds.push(Box::new(query.page * query.page_size));

        let mut stmt = conn.prepare(&query_sql)
            .map_err(|e| format!("query failed: {e}"))?;
        let refs: Vec<&dyn rusqlite::types::ToSql> = all_binds.iter().map(|b| b.as_ref()).collect();
        let entries = stmt.query_map(refs.as_slice(), |row| {
            let labels_str: String = row.get(5)?;
            let trackers_str: String = row.get(6)?;
            Ok(TorrentHistoryEntry {
                id: row.get(0)?,
                info_hash: row.get(1)?,
                name: row.get(2)?,
                total_size: row.get(3)?,
                directory: row.get(4)?,
                labels: if labels_str.is_empty() { vec![] } else { labels_str.split(',').map(|s| s.to_string()).collect() },
                trackers: if trackers_str.is_empty() { vec![] } else { trackers_str.split('\n').map(|s| s.to_string()).collect() },
                source: row.get(7)?,
                is_private: row.get::<_, i32>(8)? != 0,
                added_at: row.get(9)?,
                removed_at: row.get(10)?,
                has_blob: row.get(11)?,
                loaded: row.get(12)?,
            })
        }).map_err(|e| format!("query failed: {e}"))?
        .filter_map(|r| r.ok())
        .collect();

        Ok(TorrentHistoryPage { entries, total })
    }

    /// Get the archived .torrent of one entry, None when it has none.
    pub fn get_torrent_blob(&self, id: i64) -> Result<Option<Vec<u8>>, String> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT torrent_blob FROM torrent_history WHERE id = ?1",
            params![id],
            |row| row.get(0),
        ).map_err(|e| format!("failed to get blob: {e}"))
    }

    /// Get the hashes of live history entries missing their .torrent blob, each once.
    pub fn pending_blobs(&self) -> Result<Vec<String>, String> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT DISTINCT info_hash FROM torrent_history WHERE torrent_blob IS NULL AND removed_at IS NULL"
        ).map_err(|e| format!("query failed: {e}"))?;
        let rows = stmt.query_map([], |row| row.get(0))
            .map_err(|e| format!("query failed: {e}"))?
            .filter_map(|r| r.ok())
            .collect();
        Ok(rows)
    }

    /// Name of the newest named live entry for this hash, None when there is none.
    pub fn live_entry_name(&self, info_hash: &str) -> Result<Option<String>, String> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT name FROM torrent_history WHERE info_hash = upper(?1) AND removed_at IS NULL AND name != '' \
             ORDER BY added_at DESC, id DESC LIMIT 1",
            params![info_hash],
            |row| row.get(0),
        ).optional().map_err(|e| format!("query failed: {e}"))
    }

    /// Whether a live entry for this hash still lacks its blob.
    pub fn live_entry_lacks_blob(&self, info_hash: &str) -> Result<bool, String> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM torrent_history \
             WHERE info_hash = upper(?1) AND removed_at IS NULL AND torrent_blob IS NULL)",
            params![info_hash],
            |row| row.get(0),
        ).map_err(|e| format!("query failed: {e}"))
    }

    /// Set the blob on each live entry for this hash lacking one, filling an empty name and size.
    pub fn set_blob_by_hash(
        &self, info_hash: &str, blob: &[u8], name: &str, total_size: i64,
    ) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE torrent_history SET torrent_blob = ?1, \
             name = CASE WHEN name = '' THEN ?2 ELSE name END, \
             total_size = CASE WHEN total_size = 0 THEN ?3 ELSE total_size END \
             WHERE info_hash = upper(?4) AND removed_at IS NULL AND torrent_blob IS NULL",
            params![blob, name, total_size, info_hash],
        ).map_err(|e| format!("failed to set blob by hash: {e}"))?;
        Ok(())
    }

    /// Delete one history entry along with its archived .torrent.
    pub fn delete_history_entry(&self, id: i64) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM torrent_history WHERE id = ?1", params![id])
            .map_err(|e| format!("failed to delete: {e}"))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// History entry under the shared test hash.
    fn entry<'a>(added_at: i64, blob: Option<&'a [u8]>) -> NewTorrentHistory<'a> {
        NewTorrentHistory {
            info_hash: "AB12",
            name: "test",
            total_size: 1,
            directory: "/data",
            labels: &[],
            trackers: &[],
            source: "file",
            is_private: false,
            added_at,
            torrent_blob: blob,
        }
    }

    /// A re-added torrent still needs its blob after an earlier entry archived one.
    #[test]
    fn readded_torrent_still_needs_its_blob() {
        let db = Database::open(std::path::Path::new(":memory:")).unwrap();
        db.add_torrent_history(&entry(1, Some(b"old"))).unwrap();
        db.mark_torrent_removed("AB12", 2).unwrap();
        db.add_torrent_history(&entry(3, None)).unwrap();
        assert!(db.live_entry_lacks_blob("AB12").unwrap());

        db.set_blob_by_hash("AB12", b"new", "test", 1).unwrap();
        assert!(!db.live_entry_lacks_blob("AB12").unwrap());
    }

    /// A magnet entry's archived blob fills its empty name and takes it off the pending list.
    #[test]
    fn archived_blob_fills_a_magnet_name() {
        let db = Database::open(std::path::Path::new(":memory:")).unwrap();
        db.add_torrent_history(&NewTorrentHistory { name: "", total_size: 0, ..entry(1, None) })
            .unwrap();
        assert_eq!(db.pending_blobs().unwrap(), ["AB12"]);

        db.set_blob_by_hash("AB12", b"blob", "named", 7).unwrap();
        assert_eq!(db.live_entry_name("AB12").unwrap().as_deref(), Some("named"));
        assert!(db.pending_blobs().unwrap().is_empty());
    }

    /// A hash recorded in lowercase is still found by rTorrent's uppercase one.
    #[test]
    fn hash_case_does_not_matter() {
        let db = Database::open(std::path::Path::new(":memory:")).unwrap();
        db.add_torrent_history(&NewTorrentHistory { info_hash: "ab12", ..entry(1, None) }).unwrap();
        assert!(db.live_entry_lacks_blob("AB12").unwrap());
        db.mark_torrent_removed("AB12", 2).unwrap();
        assert!(!db.live_entry_lacks_blob("ab12").unwrap());
    }

    /// Sync claims and revives what a server has, and removes missing ones it owns or none owns.
    #[test]
    fn sync_follows_each_servers_list() {
        let db = Database::open(std::path::Path::new(":memory:")).unwrap();
        db.add_torrent_history(&entry(1, None)).unwrap();
        db.add_torrent_history(&NewTorrentHistory { info_hash: "CD34", ..entry(1, None) }).unwrap();

        db.sync_loaded("a", &["AB12".into()], 5).unwrap();
        assert!(db.live_entry_lacks_blob("AB12").unwrap());
        assert!(!db.live_entry_lacks_blob("CD34").unwrap());

        db.sync_loaded("b", &["CD34".into()], 6).unwrap();
        assert!(db.live_entry_lacks_blob("AB12").unwrap());
        assert!(db.live_entry_lacks_blob("CD34").unwrap());
    }

    /// Removing a hash recorded twice while loaded leaves neither entry live.
    #[test]
    fn removal_marks_every_live_entry() {
        let db = Database::open(std::path::Path::new(":memory:")).unwrap();
        db.add_torrent_history(&entry(1, None)).unwrap();
        db.add_torrent_history(&entry(2, Some(b"blob"))).unwrap();
        db.mark_torrent_removed("AB12", 3).unwrap();
        assert!(!db.live_entry_lacks_blob("AB12").unwrap());
    }

    /// Status sorts and filters by the connected list, or by removal while disconnected.
    #[test]
    fn status_follows_the_connected_list() {
        let db = Database::open(std::path::Path::new(":memory:")).unwrap();
        db.add_torrent_history(&NewTorrentHistory { name: "b", ..entry(1, None) }).unwrap();
        db.add_torrent_history(&NewTorrentHistory { info_hash: "CD34", name: "a", ..entry(2, None) }).unwrap();
        db.mark_torrent_removed("CD34", 3).unwrap();
        let list = |query: HistoryQuery, loaded: Option<&[String]>| -> (i64, Vec<(String, bool)>) {
            let page = db.get_torrent_history(&query, loaded).unwrap();
            (page.total, page.entries.into_iter().map(|e| (e.name, e.loaded)).collect())
        };
        let by_status = || HistoryQuery { page_size: 10, sort: HistorySort::Status, ..Default::default() };
        let loaded = ["CD34".to_string()];

        assert_eq!(list(by_status(), None).1, [("b".into(), true), ("a".into(), false)]);
        assert_eq!(list(by_status(), Some(&loaded)).1, [("a".into(), true), ("b".into(), false)]);
        assert_eq!(list(HistoryQuery { loaded: Some(false), ..by_status() }, Some(&loaded)), (1, vec![("b".into(), false)]));
        assert_eq!(list(HistoryQuery { sort: HistorySort::Name, ..by_status() }, Some(&[])).1[0].0, "a");
    }
}
