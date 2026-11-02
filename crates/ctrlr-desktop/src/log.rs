//! Activity log behind the frontend's log panel.

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::Emitter;

pub use ctrlr_core::db::activity_log::LogEntry;
use ctrlr_core::db::Database;

/// Most entries held in memory and seeded at startup.
const MAX_ENTRIES: usize = 500;

/// Activity log kept in memory and in SQLite, pushed live to the frontend.
pub struct ActivityLog {
    entries: Mutex<VecDeque<LogEntry>>,
    db: Option<Arc<Database>>,
    app_handle: Mutex<Option<tauri::AppHandle>>,
}

impl ActivityLog {
    /// Activity log seeded with the newest entries from earlier runs.
    pub fn new(db: Arc<Database>) -> Self {
        let mut entries = VecDeque::with_capacity(MAX_ENTRIES);
        entries.extend(db.log_recent(MAX_ENTRIES as i64).unwrap_or_default());
        Self {
            entries: Mutex::new(entries),
            db: Some(db),
            app_handle: Mutex::new(None),
        }
    }

    /// Set the app handle used to emit activity-log events.
    pub fn set_app_handle(&self, handle: tauri::AppHandle) {
        if let Ok(mut guard) = self.app_handle.lock() {
            *guard = Some(handle);
        }
    }

    /// Log an entry to the database, the frontend and the in-memory buffer.
    pub fn log(&self, level: &str, category: &str, message: impl Into<String>) {
        let entry = LogEntry {
            timestamp: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as i64,
            level: level.into(),
            category: category.into(),
            message: message.into(),
        };

        if let Some(ref db) = self.db {
            db.log_add(entry.timestamp, &entry.level, &entry.category, &entry.message).ok();
        }

        if let Ok(handle) = self.app_handle.lock()
            && let Some(ref h) = *handle {
                let _ = h.emit("activity-log", &entry);
            }

        if let Ok(mut entries) = self.entries.lock() {
            if entries.len() >= MAX_ENTRIES {
                entries.pop_front();
            }
            entries.push_back(entry);
        }
    }

    /// Log an info-level entry.
    pub fn info(&self, category: &str, message: impl Into<String>) {
        self.log("info", category, message);
    }

    /// Log a warn-level entry.
    pub fn warn(&self, category: &str, message: impl Into<String>) {
        self.log("warn", category, message);
    }

    /// Log an error-level entry.
    pub fn error(&self, category: &str, message: impl Into<String>) {
        self.log("error", category, message);
    }

    /// Entries held in memory, oldest first.
    pub fn entries(&self) -> Vec<LogEntry> {
        self.entries.lock().unwrap_or_else(|e| e.into_inner()).iter().cloned().collect()
    }

    /// Clear the log in memory and in the database.
    pub fn clear(&self) {
        self.entries.lock().unwrap_or_else(|e| e.into_inner()).clear();
        if let Some(ref db) = self.db {
            db.log_clear().ok();
        }
    }
}
