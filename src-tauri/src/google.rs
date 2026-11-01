//! Google Sheets by share link. The whole spreadsheet is downloaded through
//! Google's export link as .xlsx, which works for sheets shared as "anyone
//! with the link can view" and needs no sign-in.

use std::path::Path;

use crate::error::{AppError, AppResult};

/// The spreadsheet id from a link like https://docs.google.com/spreadsheets/d/<id>/edit#gid=0.
pub fn spreadsheet_id(link: &str) -> Option<String> {
    let rest = link.split("/spreadsheets/d/").nth(1)?;
    let id: String = rest.chars().take_while(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_').collect();
    (id.len() >= 20).then_some(id)
}

/// The id stored in a .gsheet file, the shortcut Google Drive for desktop puts on disk.
pub fn id_from_gsheet_file(path: &Path) -> AppResult<String> {
    let text = std::fs::read_to_string(path)?;
    let json: serde_json::Value =
        serde_json::from_str(&text).map_err(|_| AppError::other("This .gsheet file could not be read"))?;
    let doc_id = json.get("doc_id").and_then(|v| v.as_str()).map(str::to_string);
    let from_url = json.get("url").and_then(|v| v.as_str()).and_then(spreadsheet_id);
    doc_id.or(from_url).ok_or_else(|| AppError::other("This .gsheet file has no spreadsheet id"))
}

pub fn link_for(id: &str) -> String {
    format!("https://docs.google.com/spreadsheets/d/{id}/edit")
}

/// The file name from a Content-Disposition header, preferring the UTF-8 form.
fn title_from_disposition(header: &str) -> Option<String> {
    let encoded = header.split(';').map(str::trim).find_map(|part| part.strip_prefix("filename*=UTF-8''"));
    let name = match encoded {
        Some(value) => percent_decode(value),
        None => header
            .split(';')
            .map(str::trim)
            .find_map(|part| part.strip_prefix("filename="))
            .map(|v| v.trim_matches('"').to_string())?,
    };
    Some(name.trim_end_matches(".xlsx").to_string())
}

fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(byte) = u8::from_str_radix(&value[i + 1..i + 3], 16) {
                out.push(byte);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Downloads the spreadsheet as .xlsx. Returns the file bytes and its title.
pub async fn download(id: &str) -> AppResult<(Vec<u8>, String)> {
    let url = format!("https://docs.google.com/spreadsheets/d/{id}/export?format=xlsx");
    let response = reqwest::Client::new()
        .get(&url)
        .send()
        .await
        .map_err(|e| AppError::new("network", format!("Could not reach Google Sheets: {e}")))?;
    let status = response.status();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let title = response
        .headers()
        .get(reqwest::header::CONTENT_DISPOSITION)
        .and_then(|v| v.to_str().ok())
        .and_then(title_from_disposition)
        .unwrap_or_else(|| "Google Sheet".to_string());
    let bytes = response.bytes().await.map_err(|e| AppError::new("network", e.to_string()))?.to_vec();

    // A sheet that is not shared publicly answers with a sign-in page, not a file.
    let is_xlsx = bytes.starts_with(b"PK") || content_type.contains("spreadsheetml");
    if status.as_u16() == 404 {
        return Err(AppError::new("not_found", "No Google Sheet was found at this link"));
    }
    if !status.is_success() || !is_xlsx {
        return Err(AppError::new(
            "not_shared",
            "This sheet is not shared publicly. In Google Sheets, choose Share, set General access to \
             \"Anyone with the link\", and try again.",
        ));
    }
    Ok((bytes, title))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_from_links() {
        let id = "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms";
        assert_eq!(spreadsheet_id(&format!("https://docs.google.com/spreadsheets/d/{id}/edit#gid=0")).as_deref(), Some(id));
        assert_eq!(spreadsheet_id(&format!("docs.google.com/spreadsheets/d/{id}")).as_deref(), Some(id));
        assert_eq!(spreadsheet_id("https://example.com/sheet"), None);
    }

    #[test]
    fn titles_from_headers() {
        assert_eq!(
            title_from_disposition("attachment; filename=\"x.xlsx\"; filename*=UTF-8''Budsjett%20%C3%B8konomi.xlsx").as_deref(),
            Some("Budsjett økonomi")
        );
        assert_eq!(title_from_disposition("attachment; filename=\"Plan.xlsx\"").as_deref(), Some("Plan"));
    }

    /// Downloads Google's public sample sheet. Needs network, so it is ignored by default.
    #[tokio::test]
    #[ignore]
    async fn live_public_sheet() {
        let (bytes, title) = download("1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms").await.unwrap();
        let doc = crate::document::Document::google(title.clone(), link_for("x"), &bytes).unwrap();
        let layout = doc.layout(0).unwrap();
        println!("{title}: {} sheets, first has {} rows", doc.info().sheets.len(), layout.data_rows);
        assert!(layout.data_rows > 10);
    }
}
