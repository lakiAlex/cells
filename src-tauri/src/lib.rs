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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            let dir = app.path().app_config_dir()?;
            std::fs::create_dir_all(&dir)?;
            // Files given on the command line open like files from Finder.
            let args: Vec<String> = std::env::args()
                .skip(1)
                .filter(|a| !a.starts_with('-') && std::path::Path::new(a).is_file())
                .collect();
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
            if let Some(state) = handle.try_state::<AppState>() {
                state.pending_opens.lock().unwrap().extend(paths.clone());
            }
            let _ = handle.emit("open-paths", paths);
        }
    });
}
