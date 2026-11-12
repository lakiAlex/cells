mod book;
mod commands;
#[cfg(test)]
mod corpus;
mod document;
mod error;
mod formats;
mod google;
mod recent;
mod render;
mod view;

use tauri::{Emitter, Manager};

use commands::AppState;
use recent::Recent;

/// Files macOS hands over before setup has run. A double-clicked file that
/// launches Cells arrives this way, before the app state exists.
static EARLY_OPENS: std::sync::Mutex<Vec<String>> = std::sync::Mutex::new(Vec::new());

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        // Anonymous usage stats. Only release builds from the workflow have the key. Without it the plugin sends nothing.
        .plugin(tauri_plugin_aptabase::Builder::new(option_env!("APTABASE_APP_KEY").unwrap_or("")).build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            let dir = app.path().app_config_dir()?;
            std::fs::create_dir_all(&dir)?;
            // Files given on the command line open like files from Finder.
            let mut args: Vec<String> = std::env::args()
                .skip(1)
                .filter(|a| !a.starts_with('-') && std::path::Path::new(a).is_file())
                .collect();
            args.extend(std::mem::take(&mut *EARLY_OPENS.lock().unwrap_or_else(|e| e.into_inner())));
            app.manage(AppState {
                docs: Default::default(),
                recent: Recent::load(dir.join("recent.json")),
                pending_opens: std::sync::Mutex::new(args),
                clipboard: Default::default(),
                untitled: Default::default(),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::open_path,
            commands::open_google,
            commands::new_doc,
            commands::close_doc,
            commands::layout,
            commands::cells,
            commands::cell,
            commands::stats,
            commands::find,
            commands::column_values,
            commands::set_view,
            commands::edit,
            commands::copy,
            commands::undo,
            commands::redo,
            commands::save,
            commands::save_as,
            commands::recent_list,
            commands::recent_remove,
            commands::take_pending_opens,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|handle, event| {
        // Files opened from Finder ("Open With", double-click, dropped on the Dock icon).
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        if let tauri::RunEvent::Opened { urls } = event {
            let paths: Vec<String> = urls
                .iter()
                .filter_map(|url| url.to_file_path().ok())
                .map(|p| p.to_string_lossy().into_owned())
                .collect();
            match handle.try_state::<AppState>() {
                Some(state) => state.pending_opens.lock().unwrap_or_else(|e| e.into_inner()).extend(paths.clone()),
                None => EARLY_OPENS.lock().unwrap_or_else(|e| e.into_inner()).extend(paths.clone()),
            }
            let _ = handle.emit("open-paths", paths);
        }
    });
}
