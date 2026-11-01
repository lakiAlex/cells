pub mod carry;
pub mod csv;
pub mod excel;
pub mod xlsx;

use std::path::{Path, PathBuf};

use crate::error::{AppError, AppResult};

/// Writes a file next to `target` and then moves it into place, so a failed
/// write never leaves a half-written file. When `keep_original` is set, the
/// existing file goes to the Trash first instead of being overwritten.
pub fn replace_file(target: &Path, keep_original: bool, write: impl FnOnce(&Path) -> AppResult<()>) -> AppResult<()> {
    let name = target.file_name().and_then(|n| n.to_str()).unwrap_or("file");
    let temp: PathBuf = target.with_file_name(format!(".{name}.cells-tmp"));
    if let Err(e) = write(&temp) {
        let _ = std::fs::remove_file(&temp);
        return Err(e);
    }
    if keep_original && target.exists() {
        if let Err(e) = trash::delete(target) {
            let _ = std::fs::remove_file(&temp);
            return Err(AppError::other(format!("Could not move the original to the Trash: {e}")));
        }
    }
    std::fs::rename(&temp, target)?;
    Ok(())
}
