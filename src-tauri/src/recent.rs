use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

const LIMIT: usize = 20;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentItem {
    /// "file" or "google".
    pub kind: String,
    /// File path, or the Google Sheets link.
    pub location: String,
    pub title: String,
    pub opened_at: i64,
}

/// Recently opened files and Google Sheets, newest first.
pub struct Recent {
    path: PathBuf,
    items: Mutex<Vec<RecentItem>>,
}

impl Recent {
    pub fn load(path: PathBuf) -> Self {
        let items = std::fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        Self { path, items: Mutex::new(items) }
    }

    pub fn list(&self) -> Vec<RecentItem> {
        self.items.lock().unwrap().clone()
    }

    pub fn add(&self, kind: &str, location: &str, title: &str) {
        let mut items = self.items.lock().unwrap();
        items.retain(|i| i.location != location);
        items.insert(
            0,
            RecentItem {
                kind: kind.to_string(),
                location: location.to_string(),
                title: title.to_string(),
                opened_at: chrono::Utc::now().timestamp(),
            },
        );
        items.truncate(LIMIT);
        self.persist(&items);
    }

    pub fn remove(&self, location: &str) {
        let mut items = self.items.lock().unwrap();
        items.retain(|i| i.location != location);
        self.persist(&items);
    }

    fn persist(&self, items: &[RecentItem]) {
        if let Ok(json) = serde_json::to_string_pretty(items) {
            let _ = std::fs::write(&self.path, json);
        }
    }
}
