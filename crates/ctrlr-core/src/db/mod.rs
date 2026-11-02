//! SQLite store for torrent history, RSS download history and the activity log.

pub mod history;
pub mod rss_history;
pub mod activity_log;

use std::path::Path;
use std::sync::Mutex;

use rusqlite::Connection;

/// One SQLite connection shared by every table, behind a mutex.
pub struct Database {
    conn: Mutex<Connection>,
}

impl Database {
    /// Open the database with WAL and foreign keys on, migrating the schema.
    pub fn open(path: &Path) -> Result<Self, String> {
        let conn = Connection::open(path)
            .map_err(|e| format!("failed to open database: {e}"))?;

        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
            .map_err(|e| format!("failed to set pragmas: {e}"))?;

        let db = Self { conn: Mutex::new(conn) };
        db.migrate()?;
        Ok(db)
    }

    /// Migrate the schema up from the version stored in user_version.
    fn migrate(&self) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();

        let version: i32 = conn
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .unwrap_or(0);

        if version < 1 {
            conn.execute_batch(SCHEMA_V1)
                .map_err(|e| format!("schema v1 migration failed: {e}"))?;
            conn.pragma_update(None, "user_version", 1)
                .map_err(|e| format!("failed to set schema version: {e}"))?;
        }
        if version < 2 {
            // stored hashes match rTorrent's uppercase d.hash
            conn.execute_batch(
                "UPDATE OR IGNORE torrent_history SET info_hash = upper(info_hash) WHERE info_hash != upper(info_hash);",
            ).map_err(|e| format!("schema v2 migration failed: {e}"))?;
            conn.pragma_update(None, "user_version", 2)
                .map_err(|e| format!("failed to set schema version: {e}"))?;
        }
        if version < 3 {
            // the rTorrent instance an entry was last seen loaded on, null until seen
            conn.execute_batch("ALTER TABLE torrent_history ADD COLUMN server TEXT;")
                .map_err(|e| format!("schema v3 migration failed: {e}"))?;
            conn.pragma_update(None, "user_version", 3)
                .map_err(|e| format!("failed to set schema version: {e}"))?;
        }

        Ok(())
    }

}

/// First schema version, creating all three tables and their indexes.
const SCHEMA_V1: &str = "
CREATE TABLE IF NOT EXISTS torrent_history (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    info_hash    TEXT NOT NULL,
    name         TEXT NOT NULL,
    total_size   INTEGER NOT NULL DEFAULT 0,
    directory    TEXT NOT NULL DEFAULT '',
    labels       TEXT NOT NULL DEFAULT '',
    trackers     TEXT NOT NULL DEFAULT '',
    source       TEXT NOT NULL DEFAULT 'file',
    is_private   INTEGER NOT NULL DEFAULT 0,
    added_at     INTEGER NOT NULL,
    removed_at   INTEGER,
    torrent_blob BLOB
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_th_hash_added ON torrent_history (info_hash, added_at);
CREATE INDEX IF NOT EXISTS idx_th_name ON torrent_history (name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_th_added ON torrent_history (added_at);
CREATE INDEX IF NOT EXISTS idx_th_removed ON torrent_history (removed_at);

CREATE TABLE IF NOT EXISTS rss_downloads (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp INTEGER NOT NULL,
    feed      TEXT NOT NULL,
    rule      TEXT NOT NULL,
    guid      TEXT NOT NULL,
    title     TEXT NOT NULL,
    hash      TEXT NOT NULL DEFAULT '',
    season    INTEGER NOT NULL DEFAULT 0,
    episode   INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_rss_guid ON rss_downloads (guid);
CREATE INDEX IF NOT EXISTS idx_rss_rule_ep ON rss_downloads (rule, season, episode);
CREATE INDEX IF NOT EXISTS idx_rss_timestamp ON rss_downloads (timestamp);

CREATE TABLE IF NOT EXISTS activity_log (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp INTEGER NOT NULL,
    level     TEXT NOT NULL,
    category  TEXT NOT NULL,
    message   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_log_timestamp ON activity_log (timestamp);
CREATE INDEX IF NOT EXISTS idx_log_category ON activity_log (category);
";
