//! CSV files: the separator, text encoding, byte order mark and line endings
//! are detected on open and kept when saving.

use std::path::Path;

use encoding_rs::{Encoding, UTF_16BE, UTF_16LE, UTF_8, WINDOWS_1252};

use crate::error::{AppError, AppResult};

#[derive(Clone, Copy)]
pub struct CsvFormat {
    pub delimiter: u8,
    pub encoding: &'static Encoding,
    pub bom: bool,
    pub crlf: bool,
    /// Numbers are written with a decimal comma, as in "9,90".
    pub decimal_comma: bool,
    /// The last line ends with a line break.
    pub final_newline: bool,
    /// Lines have different numbers of fields; saving keeps them short
    /// instead of filling every line to the same width.
    pub ragged: bool,
}

impl Default for CsvFormat {
    /// Comma separated UTF-8 with a byte order mark, which Excel opens correctly.
    fn default() -> Self {
        Self { delimiter: b',', encoding: UTF_8, bom: true, crlf: true, decimal_comma: false, final_newline: true, ragged: false }
    }
}

impl CsvFormat {
    pub fn label(&self) -> String {
        let separator = match self.delimiter {
            b',' => "comma",
            b';' => "semicolon",
            b'\t' => "tab",
            b'|' => "pipe",
            _ => "custom",
        };
        format!("CSV, {separator}, {}", self.encoding.name())
    }
}

/// Decodes file bytes: a byte order mark wins, then UTF-8 if valid, else Windows-1252.
pub fn decode(bytes: &[u8]) -> (String, &'static Encoding, bool) {
    if let Some((encoding, len)) = Encoding::for_bom(bytes) {
        let (text, _) = encoding.decode_without_bom_handling(&bytes[len..]);
        return (text.into_owned(), encoding, true);
    }
    match std::str::from_utf8(bytes) {
        Ok(text) => (text.to_string(), UTF_8, false),
        Err(_) => {
            let (text, _) = WINDOWS_1252.decode_without_bom_handling(bytes);
            (text.into_owned(), WINDOWS_1252, false)
        }
    }
}

fn encode(text: &str, format: &CsvFormat) -> Vec<u8> {
    // encoding_rs only writes UTF-8 for UTF-16 targets, so UTF-16 is done here.
    let utf16 = |big_endian: bool| -> Vec<u8> {
        let mut out = Vec::with_capacity(text.len() * 2 + 2);
        if format.bom {
            out.extend_from_slice(if big_endian { &[0xFE, 0xFF] } else { &[0xFF, 0xFE] });
        }
        for unit in text.encode_utf16() {
            out.extend_from_slice(&if big_endian { unit.to_be_bytes() } else { unit.to_le_bytes() });
        }
        out
    };
    if format.encoding == UTF_16LE {
        return utf16(false);
    }
    if format.encoding == UTF_16BE {
        return utf16(true);
    }
    let mut out = Vec::with_capacity(text.len() + 3);
    if format.bom && format.encoding == UTF_8 {
        out.extend_from_slice(&[0xEF, 0xBB, 0xBF]);
    }
    let (bytes, _, _) = format.encoding.encode(text);
    out.extend_from_slice(&bytes);
    out
}

/// Picks the separator that splits the first lines into the same number of
/// fields most consistently. Text inside quotes is ignored.
pub fn detect_delimiter(text: &str) -> u8 {
    let candidates = [b',', b';', b'\t', b'|'];
    let lines: Vec<&str> = text.lines().filter(|l| !l.trim().is_empty()).take(30).collect();
    let mut best = (b',', 0usize, 0usize);
    for &candidate in &candidates {
        let counts: Vec<usize> = lines
            .iter()
            .map(|line| {
                let mut in_quotes = false;
                line.bytes()
                    .filter(|&b| {
                        if b == b'"' {
                            in_quotes = !in_quotes;
                        }
                        b == candidate && !in_quotes
                    })
                    .count()
            })
            .collect();
        let Some(&mode) = counts.iter().filter(|&&c| c > 0).max_by_key(|&&c| counts.iter().filter(|&&x| x == c).count())
        else {
            continue;
        };
        let consistent = counts.iter().filter(|&&c| c == mode).count();
        if (consistent, mode) > (best.1, best.2) {
            best = (candidate, consistent, mode);
        }
    }
    best.0
}

/// A decimal comma is only possible when the separator is not a comma. It is
/// used when numbers like "9,90" are at least as common as numbers like "9.90".
pub fn detect_decimal_comma(rows: &[Vec<String>], delimiter: u8) -> bool {
    if delimiter == b',' {
        return false;
    }
    let decimal = |field: &str, separator: char| {
        let body = field.strip_prefix('-').unwrap_or(field);
        body.split_once(separator).is_some_and(|(int, frac)| {
            !int.is_empty() && !frac.is_empty() && int.bytes().all(|b| b.is_ascii_digit()) && frac.bytes().all(|b| b.is_ascii_digit())
        })
    };
    let (mut commas, mut dots) = (0, 0);
    for field in rows.iter().take(2000).flatten() {
        if decimal(field, ',') {
            commas += 1;
        } else if decimal(field, '.') {
            dots += 1;
        }
    }
    commas > 0 && commas >= dots
}

pub fn parse(text: &str, delimiter: u8) -> AppResult<Vec<Vec<String>>> {
    let mut reader = csv::ReaderBuilder::new()
        .delimiter(delimiter)
        .has_headers(false)
        .flexible(true)
        .from_reader(text.as_bytes());
    reader
        .records()
        .map(|record| {
            record
                .map(|r| r.iter().map(str::to_string).collect())
                .map_err(|e| AppError::other(format!("Could not read the CSV file: {e}")))
        })
        .collect()
}

pub fn read(path: &Path) -> AppResult<(Vec<Vec<String>>, CsvFormat)> {
    let bytes = std::fs::read(path)?;
    let (text, encoding, bom) = decode(&bytes);
    let is_tsv = path.extension().is_some_and(|e| e.eq_ignore_ascii_case("tsv"));
    let delimiter = if is_tsv { b'\t' } else { detect_delimiter(&text) };
    let crlf = text.contains("\r\n");
    let rows = parse(&text, delimiter)?;
    let decimal_comma = detect_decimal_comma(&rows, delimiter);
    let final_newline = text.is_empty() || text.ends_with('\n') || text.ends_with('\r');
    let ragged = rows.iter().any(|r| r.len() != rows[0].len());
    Ok((rows, CsvFormat { delimiter, encoding, bom, crlf, decimal_comma, final_newline, ragged }))
}

pub fn to_text(rows: &[Vec<String>], format: &CsvFormat) -> AppResult<String> {
    let mut writer = csv::WriterBuilder::new()
        .delimiter(format.delimiter)
        .flexible(true)
        .terminator(if format.crlf { csv::Terminator::CRLF } else { csv::Terminator::Any(b'\n') })
        .from_writer(Vec::new());
    for row in rows {
        writer.write_record(row).map_err(|e| AppError::other(e.to_string()))?;
    }
    let bytes = writer.into_inner().map_err(|e| AppError::other(e.to_string()))?;
    let mut text = String::from_utf8(bytes).map_err(|e| AppError::other(e.to_string()))?;
    if !format.final_newline {
        let trimmed = text.trim_end_matches(['\r', '\n']).len();
        text.truncate(trimmed);
    }
    Ok(text)
}

pub fn write(path: &Path, rows: &[Vec<String>], format: &CsvFormat) -> AppResult<()> {
    let text = to_text(rows, format)?;
    std::fs::write(path, encode(&text, format))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_delimiters() {
        assert_eq!(detect_delimiter("a,b,c\n1,2,3\n"), b',');
        assert_eq!(detect_delimiter("navn;pris;antall\nEple;12,50;3\nPære;9,90;1\n"), b';');
        assert_eq!(detect_delimiter("a\tb\n1\t2\n"), b'\t');
        // Commas inside quotes do not count.
        assert_eq!(detect_delimiter("\"a,b\";c\n\"d,e\";f\n"), b';');
        assert_eq!(detect_delimiter("single column\nvalue\n"), b',');
    }

    #[test]
    fn detects_decimal_comma() {
        let rows = |text: &str, d: u8| parse(text, d).unwrap();
        assert!(detect_decimal_comma(&rows("navn;pris\nEple;12,50\n", b';'), b';'));
        assert!(!detect_decimal_comma(&rows("navn;pris\nEple;12.50\n", b';'), b';'));
        assert!(!detect_decimal_comma(&rows("a,b\n\"1,5\",2\n", b','), b','));
        assert!(!detect_decimal_comma(&rows("navn;antall\nEple;3\n", b';'), b';'));
    }

    #[test]
    fn decodes_encodings() {
        let (text, enc, bom) = decode(&[0xEF, 0xBB, 0xBF, b'a', 0xC3, 0xB8]);
        assert_eq!((text.as_str(), enc, bom), ("aø", UTF_8, true));
        // "Pære" in Windows-1252 is not valid UTF-8.
        let (text, enc, bom) = decode(&[b'P', 0xE6, b'r', b'e']);
        assert_eq!((text.as_str(), enc, bom), ("Pære", WINDOWS_1252, false));
        let (text, enc, _) = decode(&[0xFF, 0xFE, b'h', 0, b'i', 0]);
        assert_eq!((text.as_str(), enc), ("hi", UTF_16LE));
    }

    #[test]
    fn round_trips_format() {
        let dir = std::env::temp_dir().join(format!("cells-csv-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        for (name, bytes) in [
            ("semi-1252.csv", b"navn;pris\r\nP\xe6re;9,90\r\nKake;12\r\n".to_vec()),
            ("utf8-bom.csv", b"\xef\xbb\xbfa,b\nx,\"multi\nline\"\n".to_vec()),
            ("utf16.csv", [0xFF, 0xFE, b'a', 0, b'\t', 0, b'b', 0, b'\r', 0, b'\n', 0].to_vec()),
        ] {
            let path = dir.join(name);
            std::fs::write(&path, &bytes).unwrap();
            let (rows, format) = read(&path).unwrap();
            write(&path, &rows, &format).unwrap();
            let (rows_again, _) = read(&path).unwrap();
            assert_eq!(rows, rows_again, "{name}");
            assert_eq!(std::fs::read(&path).unwrap(), bytes, "{name} changed on save");
        }
        let _ = std::fs::remove_dir_all(dir);
    }
}
