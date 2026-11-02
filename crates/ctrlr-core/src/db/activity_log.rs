//! Activity log table: add, list, clear and prune entries.
use rusqlite::params;
use serde::Serialize;

use super::Database;

/// One activity log row.
#[derive(Debug, Clone, Serialize)]
pub struct LogEntry {
    pub timestamp: i64,
    pub level: String,
    pub category: String,
    pub message: String,
}

impl Database {
    /// Add an entry to the activity log.
    pub fn log_add(&self, timestamp: i64, level: &str, category: &str, message: &str) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO activity_log (timestamp, level, category, message) VALUES (?1,?2,?3,?4)",
            params![timestamp, level, category, message],
        ).map_err(|e| format!("failed to insert log: {e}"))?;
        Ok(())
    }

    /// Clear every activity log entry.
    pub fn log_clear(&self) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM activity_log", [])
            .map_err(|e| format!("failed to clear log: {e}"))?;
        Ok(())
    }

    /// The most recent entries, oldest first.
    pub fn log_recent(&self, limit: i64) -> Result<Vec<LogEntry>, String> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT timestamp, level, category, message FROM \
             (SELECT * FROM activity_log ORDER BY id DESC LIMIT ?1) ORDER BY id",
        ).map_err(|e| format!("failed to read log: {e}"))?;
        let rows = stmt.query_map(params![limit], |r| Ok(LogEntry {
            timestamp: r.get(0)?,
            level: r.get(1)?,
            category: r.get(2)?,
            message: r.get(3)?,
        })).map_err(|e| format!("failed to read log: {e}"))?;
        rows.collect::<Result<_, _>>().map_err(|e| format!("failed to read log: {e}"))
    }

    /// Prune all but the most recent entries.
    pub fn log_prune(&self, keep: i64) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM activity_log WHERE id NOT IN (SELECT id FROM activity_log ORDER BY id DESC LIMIT ?1)",
            params![keep],
        ).map_err(|e| format!("failed to prune log: {e}"))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Keep the newest 3 of 5 entries, oldest first.
    #[test]
    fn test_log_recent_keeps_newest_in_order() {
        let db = Database::open(std::path::Path::new(":memory:")).unwrap();
        for i in 0..5 {
            db.log_add(i, "info", "test", &format!("m{i}")).unwrap();
        }
        let got: Vec<String> = db.log_recent(3).unwrap().into_iter().map(|e| e.message).collect();
        assert_eq!(got, ["m2", "m3", "m4"]);
    }
}
