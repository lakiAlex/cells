use std::collections::HashMap;
use std::panic::AssertUnwindSafe;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Mutex, MutexGuard};

use serde::Serialize;
use tauri::State;

use crate::document::{CellInfo, CellsOut, Clip, DocInfo, Document, Edit, EditOutcome, FindOptions, Layout, Rect, Stats};
use crate::error::{AppError, AppResult};
use crate::google;
use crate::recent::{Recent, RecentItem};
use crate::view::SortKey;

pub struct AppState {
    pub docs: Mutex<HashMap<String, Document>>,
    pub recent: Recent,
    /// Files opened from Finder before the window was ready to receive them.
    pub pending_opens: Mutex<Vec<String>>,
    /// Cells last copied in Cells, so pasting them keeps formulas and formatting.
    pub clipboard: Mutex<Option<Clip>>,
    pub untitled: AtomicUsize,
}

/// Locks a mutex, also after a panic while it was held.
fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|e| e.into_inner())
}

impl AppState {
    /// Runs `f` on an open document. A panic inside the spreadsheet engine
    /// becomes an error instead of taking the app down.
    fn with_doc<T>(&self, id: &str, f: impl FnOnce(&mut Document) -> AppResult<T>) -> AppResult<T> {
        let mut docs = lock(&self.docs);
        let doc = docs.get_mut(id).ok_or_else(|| AppError::other("This document is no longer open"))?;
        std::panic::catch_unwind(AssertUnwindSafe(|| f(doc))).unwrap_or_else(|panic| {
            let detail = panic
                .downcast_ref::<String>()
                .cloned()
                .or_else(|| panic.downcast_ref::<&str>().map(|s| s.to_string()))
                .unwrap_or_default();
            Err(AppError::other(format!("Cells could not do that: {detail}")))
        })
    }

    fn insert(&self, doc: Document) -> DocInfo {
        let info = doc.info();
        lock(&self.docs).insert(doc.id.clone(), doc);
        info
    }
}

fn join_error(e: tokio::task::JoinError) -> AppError {
    AppError::other(e.to_string())
}

async fn open_google_id(state: &AppState, id: &str) -> AppResult<DocInfo> {
    let (bytes, title) = google::download(id).await?;
    let link = google::link_for(id);
    let (doc_title, doc_link) = (title.clone(), link.clone());
    let doc = tokio::task::spawn_blocking(move || Document::google(doc_title, doc_link, &bytes))
        .await
        .map_err(join_error)??;
    state.recent.add("google", &link, &title);
    Ok(state.insert(doc))
}

#[tauri::command]
pub async fn open_path(state: State<'_, AppState>, path: String) -> AppResult<DocInfo> {
    let file = PathBuf::from(&path);
    if file.extension().is_some_and(|e| e.eq_ignore_ascii_case("gsheet")) {
        let id = google::id_from_gsheet_file(&file)?;
        return open_google_id(&state, &id).await;
    }
    let doc = tokio::task::spawn_blocking(move || Document::open_path(&file)).await.map_err(join_error)??;
    state.recent.add("file", &doc.location, &doc.title);
    Ok(state.insert(doc))
}

#[tauri::command]
pub async fn open_google(state: State<'_, AppState>, link: String) -> AppResult<DocInfo> {
    let id = google::spreadsheet_id(&link)
        .ok_or_else(|| AppError::new("bad_link", "This does not look like a Google Sheets link"))?;
    open_google_id(&state, &id).await
}

#[tauri::command]
pub fn new_doc(state: State<AppState>) -> AppResult<DocInfo> {
    let number = state.untitled.fetch_add(1, Ordering::Relaxed) + 1;
    Ok(state.insert(Document::blank(number)?))
}

#[tauri::command]
pub fn close_doc(state: State<AppState>, id: String) {
    lock(&state.docs).remove(&id);
}

#[tauri::command]
pub async fn layout(state: State<'_, AppState>, id: String, sheet: u32) -> AppResult<Layout> {
    state.with_doc(&id, |doc| doc.layout(sheet))
}

#[tauri::command]
pub async fn cells(
    state: State<'_, AppState>,
    id: String,
    sheet: u32,
    start: i32,
    count: i32,
    cols: i32,
) -> AppResult<CellsOut> {
    state.with_doc(&id, |doc| doc.cells(sheet, start, count, cols))
}

#[tauri::command]
pub async fn cell(state: State<'_, AppState>, id: String, sheet: u32, pos: i32, col: i32) -> AppResult<CellInfo> {
    state.with_doc(&id, |doc| doc.cell(sheet, pos, col))
}

#[tauri::command]
pub async fn stats(state: State<'_, AppState>, id: String, sheet: u32, rect: Rect) -> AppResult<Stats> {
    state.with_doc(&id, |doc| doc.stats(sheet, rect))
}

#[tauri::command]
pub async fn find(state: State<'_, AppState>, id: String, sheet: u32, find: FindOptions) -> AppResult<Vec<(i32, i32)>> {
    state.with_doc(&id, |doc| doc.find(sheet, &find))
}

#[tauri::command]
pub async fn column_values(
    state: State<'_, AppState>,
    id: String,
    sheet: u32,
    col: i32,
) -> AppResult<Vec<(String, usize)>> {
    state.with_doc(&id, |doc| doc.column_values(sheet, col))
}

#[tauri::command]
pub async fn set_view(
    state: State<'_, AppState>,
    id: String,
    sheet: u32,
    sort: Vec<SortKey>,
    filter: String,
    values: Vec<(i32, Vec<String>)>,
) -> AppResult<()> {
    state.with_doc(&id, |doc| doc.set_view(sheet, sort, filter, values))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditResult {
    doc: DocInfo,
    outcome: EditOutcome,
}

#[tauri::command]
pub async fn edit(state: State<'_, AppState>, id: String, sheet: u32, edit: Edit) -> AppResult<EditResult> {
    state.with_doc(&id, |doc| {
        let mut clipboard = lock(&state.clipboard);
        let outcome = doc.edit(sheet, edit, clipboard.as_ref())?;
        if outcome.clip_used {
            *clipboard = None;
        }
        Ok(EditResult { doc: doc.info(), outcome })
    })
}

#[tauri::command]
pub async fn copy(state: State<'_, AppState>, id: String, sheet: u32, rect: Rect, cut: bool) -> AppResult<String> {
    state.with_doc(&id, |doc| {
        let (text, clip) = doc.copy(sheet, rect, cut)?;
        *lock(&state.clipboard) = clip;
        Ok(text)
    })
}

#[tauri::command]
pub async fn undo(state: State<'_, AppState>, id: String) -> AppResult<DocInfo> {
    state.with_doc(&id, |doc| doc.undo().map(|_| doc.info()))
}

#[tauri::command]
pub async fn redo(state: State<'_, AppState>, id: String) -> AppResult<DocInfo> {
    state.with_doc(&id, |doc| doc.redo().map(|_| doc.info()))
}

#[tauri::command]
pub async fn save(state: State<'_, AppState>, id: String) -> AppResult<DocInfo> {
    state.with_doc(&id, |doc| doc.save().map(|_| doc.info()))
}

#[tauri::command]
pub async fn save_as(state: State<'_, AppState>, id: String, path: String, sheet: u32) -> AppResult<DocInfo> {
    let info = state.with_doc(&id, |doc| doc.save_as(&PathBuf::from(&path), sheet).map(|_| doc.info()))?;
    state.recent.add("file", &info.location, &info.title);
    Ok(info)
}

#[tauri::command]
pub fn recent_list(state: State<AppState>) -> Vec<RecentItem> {
    state.recent.list()
}

#[tauri::command]
pub fn recent_remove(state: State<AppState>, location: String) -> Vec<RecentItem> {
    state.recent.remove(&location);
    state.recent.list()
}

#[tauri::command]
pub fn take_pending_opens(state: State<AppState>) -> Vec<String> {
    std::mem::take(&mut *lock(&state.pending_opens))
}
