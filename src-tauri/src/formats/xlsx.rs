//! Excel files go through IronCalc. This module covers what it does not:
//! it lists the parts of a file IronCalc drops on save, fixes text IronCalc
//! reads wrong, and makes the files it writes readable by Excel.

use std::io::{Cursor, Read, Write};
use std::sync::LazyLock;

use regex::{Captures, Regex};
use zip::write::SimpleFileOptions;
use zip::{ZipArchive, ZipWriter};

use crate::error::{AppError, AppResult};

fn zip_error(e: impl std::fmt::Display) -> AppError {
    AppError::other(format!("Could not read the Excel file: {e}"))
}

/// What a file holds that Cells does not show and does not save.
pub struct Facts {
    /// Plain names, like "charts" or "data validation".
    pub unkept: Vec<&'static str>,
    /// Every formula has a stored result. Files written by scripts often
    /// have none, so there is nothing to compare Cells' results with.
    pub stored_results: bool,
}

static FORMULA_WITHOUT_RESULT: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"</f>(</c>|<v\s*/>|<v></v>)").unwrap());

pub fn inspect(bytes: &[u8]) -> AppResult<Facts> {
    let mut archive = ZipArchive::new(Cursor::new(bytes)).map_err(zip_error)?;
    let all: Vec<String> = archive.file_names().filter_map(|n| n.ok()).map(|n| n.to_string()).collect();
    let names: Vec<String> = all.iter().map(|n| n.to_lowercase()).collect();
    let has = |prefix: &str| names.iter().any(|n| n.starts_with(prefix));
    // Sheet-level parts (filters, pictures, charts, comments, tables, data
    // validation) are carried over on save, see carry.rs. These are not.
    let mut unkept = Vec::new();
    if has("xl/pivottables/") || has("xl/pivotcache/") {
        unkept.push("pivot tables");
    }
    if has("xl/slicers/") || has("xl/slicercaches/") {
        unkept.push("slicers");
    }
    if has("xl/externallinks/") {
        unkept.push("links to other workbooks");
    }
    if has("xl/vbaproject.bin") {
        unkept.push("macros");
    }
    let mut stored_results = true;
    let mut sparklines = false;
    let sheets: Vec<&String> =
        all.iter().filter(|n| n.to_lowercase().starts_with("xl/worksheets/") && n.ends_with(".xml")).collect();
    for name in sheets {
        let mut xml = String::new();
        if archive.by_name(name).map_err(zip_error)?.read_to_string(&mut xml).is_err() {
            continue;
        }
        sparklines |= xml.contains("sparklineGroups");
        stored_results &= !FORMULA_WITHOUT_RESULT.is_match(&xml);
    }
    if sparklines {
        unkept.push("sparklines");
    }
    Ok(Facts { unkept, stored_results })
}

static TEXT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(<t(?:\s[^>]*)?>)([^<]*)(</t>)").unwrap());
static ESCAPE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"_x([0-9A-Fa-f]{4})_").unwrap());
static PHONETIC: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?s)<rPh\b[^>]*>.*?</rPh>").unwrap());

/// Text in Excel files can hold characters written as `_x000D_` (a carriage
/// return); `_x005F_` stands for the underscore of a literal "_x...".
fn decode_escapes(text: &str) -> String {
    ESCAPE
        .replace_all(text, |c: &Captures| {
            let code = u32::from_str_radix(&c[1], 16).unwrap_or(0);
            match char::from_u32(code) {
                Some('\t') => "&#9;".to_string(),
                Some('\n') => "&#10;".to_string(),
                Some('\r') => "&#13;".to_string(),
                Some('&') => "&amp;".to_string(),
                Some('<') => "&lt;".to_string(),
                Some('>') => "&gt;".to_string(),
                // Other control characters cannot be written in XML.
                Some(ch) if (ch as u32) < 0x20 => String::new(),
                Some(ch) => ch.to_string(),
                None => String::new(),
            }
        })
        .into_owned()
}

fn fix_text(xml: &str) -> String {
    // Japanese files store the reading of words next to the text; it is not
    // part of the value.
    let xml = PHONETIC.replace_all(xml, "");
    if !xml.contains("_x") {
        return xml.into_owned();
    }
    TEXT.replace_all(&xml, |c: &Captures| format!("{}{}{}", &c[1], decode_escapes(&c[2]), &c[3])).into_owned()
}

/// Rewrites the parts of a zip archive that `fix` changes. Returns None when
/// nothing changed.
fn rewrite(bytes: &[u8], fix: impl Fn(&str, &str) -> Option<String>) -> AppResult<Option<Vec<u8>>> {
    let mut archive = ZipArchive::new(Cursor::new(bytes)).map_err(zip_error)?;
    let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
    let mut changed = false;
    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(zip_error)?;
        let name = file.name().map_err(zip_error)?.to_string();
        let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        if file.is_dir() {
            writer.add_directory(name, options).map_err(zip_error)?;
            continue;
        }
        let mut data = Vec::new();
        file.read_to_end(&mut data).map_err(zip_error)?;
        if name.ends_with(".xml") {
            if let Ok(text) = std::str::from_utf8(&data) {
                if let Some(fixed) = fix(&name, text) {
                    if fixed != text {
                        changed = true;
                        data = fixed.into_bytes();
                    }
                }
            }
        }
        writer.start_file(name, options).map_err(zip_error)?;
        writer.write_all(&data).map_err(zip_error)?;
    }
    if !changed {
        return Ok(None);
    }
    Ok(Some(writer.finish().map_err(zip_error)?.into_inner()))
}

const DEFAULT_STYLE_BLOCKS: [(&str, &str); 6] = [
    ("fonts", r#"<fonts count="1"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts>"#),
    ("fills", r#"<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>"#),
    ("borders", r#"<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>"#),
    ("cellStyleXfs", r#"<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>"#),
    ("cellXfs", r#"<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>"#),
    ("cellStyles", r#"<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>"#),
];

const STYLES_XML: &str =
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"></styleSheet>"#;

/// Fills in the style lists IronCalc needs; some writers leave them out.
fn complete_styles(xml: &str) -> String {
    let mut missing = String::new();
    for (tag, block) in DEFAULT_STYLE_BLOCKS {
        let present = Regex::new(&format!(r"<(\w+:)?{tag}[\s>]")).unwrap();
        let empty = Regex::new(&format!(r"<(\w+:)?{tag}(\s[^>]*)?/>")).unwrap();
        if !present.is_match(xml) || empty.is_match(xml) {
            missing.push_str(block);
        }
    }
    if missing.is_empty() {
        return xml.to_string();
    }
    let xml = Regex::new(&format!(r"<(\w+:)?({})(\s[^>]*)?/>", DEFAULT_STYLE_BLOCKS.map(|b| b.0).join("|")))
        .unwrap()
        .replace_all(xml, "");
    match Regex::new(r"<(\w+:)?styleSheet[^>]*>").unwrap().find(&xml) {
        Some(m) => format!("{}{missing}{}", &xml[..m.end()], &xml[m.end()..]),
        None => xml.into_owned(),
    }
}

static ROW_TAG: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"<(\w+:)?(row|c)((?:\s[^>]*?)?)(/?)>").unwrap());
static R_ATTR: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"\br="([A-Z]*)(\d+)""#).unwrap());

fn column_letters(col: u32) -> String {
    let mut name = String::new();
    let mut n = col;
    while n > 0 {
        name.insert(0, (b'A' + ((n - 1) % 26) as u8) as char);
        n = (n - 1) / 26;
    }
    name
}

fn column_number(letters: &str) -> u32 {
    letters.bytes().fold(0, |n, b| n * 26 + (b - b'A' + 1) as u32)
}

/// Adds the row and cell addresses some writers leave out (they are optional
/// in the format, IronCalc needs them).
fn add_addresses(xml: &str) -> String {
    let (mut row, mut col) = (0u32, 0u32);
    let mut added = false;
    let out = ROW_TAG.replace_all(xml, |c: &Captures| {
        let (prefix, tag, attrs, slash) = (c.get(1).map_or("", |m| m.as_str()), &c[2], &c[3], &c[4]);
        if tag == "row" {
            col = 0;
            match R_ATTR.captures(attrs) {
                Some(r) => row = r[2].parse().unwrap_or(row + 1),
                None => {
                    row += 1;
                    added = true;
                    return format!("<{prefix}row r=\"{row}\"{attrs}{slash}>");
                }
            }
            return c[0].to_string();
        }
        match R_ATTR.captures(attrs) {
            Some(r) => {
                col = column_number(&r[1]);
                c[0].to_string()
            }
            None => {
                col += 1;
                added = true;
                format!("<{prefix}c r=\"{}{row}\"{attrs}{slash}>", column_letters(col))
            }
        }
    });
    if added {
        out.into_owned()
    } else {
        xml.to_string()
    }
}

/// "Strict" Excel files use other namespace names for the same things.
fn transitional(xml: &str) -> String {
    if !xml.contains("purl.oclc.org/ooxml") {
        return xml.to_string();
    }
    xml.replace("http://purl.oclc.org/ooxml/spreadsheetml/main", "http://schemas.openxmlformats.org/spreadsheetml/2006/main")
        .replace(
            "http://purl.oclc.org/ooxml/officeDocument/relationships",
            "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
        )
        .replace("http://purl.oclc.org/ooxml/drawingml/main", "http://schemas.openxmlformats.org/drawingml/2006/main")
}

static TARGET: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"Target="([^"]+)""#).unwrap());

/// The file as IronCalc should read it: part names and namespaces the way it
/// looks for them, missing style lists and addresses filled in, and text
/// fixed. The file on disk is not changed.
pub fn prepare(bytes: Vec<u8>) -> AppResult<Vec<u8>> {
    let mut archive = ZipArchive::new(Cursor::new(&bytes)).map_err(zip_error)?;
    let mut parts: Vec<(String, Vec<u8>)> = Vec::new();
    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(zip_error)?;
        if file.is_dir() {
            continue;
        }
        // Some writers use Windows path separators.
        let name = file.name().map_err(zip_error)?.replace('\\', "/");
        let mut data = Vec::new();
        file.read_to_end(&mut data).map_err(zip_error)?;
        parts.push((name, data));
    }

    // Part names are case sensitive in the archive; IronCalc asks for these.
    let mut wanted: Vec<String> = ["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/sharedStrings.xml"]
        .map(String::from)
        .to_vec();
    let rels = parts.iter().find(|(n, _)| n.eq_ignore_ascii_case("xl/_rels/workbook.xml.rels"));
    if let Some(text) = rels.and_then(|(_, d)| std::str::from_utf8(d).ok()) {
        for t in TARGET.captures_iter(text) {
            let target = t[1].trim_start_matches('/');
            wanted.push(if t[1].starts_with('/') || target.starts_with("xl/") { target.to_string() } else { format!("xl/{target}") });
        }
    }
    for (name, _) in parts.iter_mut() {
        if let Some(w) = wanted.iter().find(|w| w.eq_ignore_ascii_case(name) && *w != name) {
            *name = w.clone();
        }
    }

    if !parts.iter().any(|(n, _)| n == "xl/styles.xml") {
        parts.push(("xl/styles.xml".into(), STYLES_XML.as_bytes().to_vec()));
    }
    for (name, data) in parts.iter_mut() {
        if !(name.ends_with(".xml") || name.ends_with(".rels")) {
            continue;
        }
        let Ok(text) = std::str::from_utf8(data) else { continue };
        let mut text = transitional(text);
        if name == "xl/styles.xml" {
            text = complete_styles(&text);
        } else if name == "xl/sharedStrings.xml" {
            text = fix_text(&text);
        } else if name.starts_with("xl/worksheets/") {
            text = add_addresses(&fix_text(&text));
        }
        *data = text.into_bytes();
    }

    let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    for (name, data) in parts {
        writer.start_file(name, options).map_err(zip_error)?;
        writer.write_all(&data).map_err(zip_error)?;
    }
    Ok(writer.finish().map_err(zip_error)?.into_inner())
}

const EXCEL_ERRORS: [&str; 8] = ["#NULL!", "#DIV/0!", "#VALUE!", "#REF!", "#NAME?", "#NUM!", "#N/A", "#GETTING_DATA"];

static ERROR_FORMULA: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"<c ([^>]*?)\s?t="e"([^>]*)>(<f[^>]*/>|<f[^>]*>[^<]*</f>)<v>[^<]*</v></c>"#).unwrap());
static ERROR_VALUE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"(<c [^>]*t="e"[^>]*><v>)([^<]*)(</v></c>)"#).unwrap());
static CALC_PR: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"<calcPr(\s[^>]*?)?\s*/>").unwrap());

fn fix_sheet(xml: &str) -> String {
    // A formula whose result is an error is saved without the result: Excel
    // calculates it again, and IronCalc has error codes Excel does not know
    // (#ERROR!, #N/IMPL!, #CIRC!).
    let xml = ERROR_FORMULA.replace_all(xml, "<c $1$2>$3</c>");
    ERROR_VALUE
        .replace_all(&xml, |c: &Captures| {
            let value = if EXCEL_ERRORS.contains(&&c[2]) { &c[2] } else { "#VALUE!" };
            format!("{}{}{}", &c[1], value, &c[3])
        })
        .into_owned()
}

/// Makes a workbook written by IronCalc open cleanly in Excel: Excel
/// recalculates on open, and no cell holds an error code it does not know.
pub fn for_excel(bytes: Vec<u8>) -> AppResult<Vec<u8>> {
    let fixed = rewrite(&bytes, |name, xml| {
        if name.starts_with("xl/worksheets/") {
            Some(fix_sheet(xml))
        } else if name == "xl/workbook.xml" {
            (!xml.contains("fullCalcOnLoad")).then(|| CALC_PR.replace(xml, r#"<calcPr$1 fullCalcOnLoad="1"/>"#).into_owned())
        } else {
            None
        }
    })?;
    Ok(fixed.unwrap_or(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escapes() {
        assert_eq!(decode_escapes("ABC_x000D_\nDEF"), "ABC&#13;\nDEF");
        assert_eq!(decode_escapes("_x005F_x0000_"), "_x0000_");
        assert_eq!(decode_escapes("a_x0000_b"), "ab");
        assert_eq!(fix_text("<si><t>x</t><rPh sb=\"0\" eb=\"1\"><t>エックス</t></rPh></si>"), "<si><t>x</t></si>");
    }

    #[test]
    fn repairs() {
        let styles = complete_styles(STYLES_XML);
        for (tag, _) in DEFAULT_STYLE_BLOCKS {
            assert!(styles.contains(&format!("<{tag} ")), "{tag}");
        }
        assert_eq!(
            add_addresses(r#"<sheetData><row><c t="s"><v>0</v></c><c><v>2</v></c></row><row r="5"><c r="C5"/><c/></row></sheetData>"#),
            r#"<sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><v>2</v></c></row><row r="5"><c r="C5"/><c r="D5"/></row></sheetData>"#
        );
        assert!(transitional(r#"xmlns="http://purl.oclc.org/ooxml/spreadsheetml/main""#).contains("schemas.openxmlformats.org"));
    }

    #[test]
    fn excel_errors() {
        let xml = r#"<row><c r="A1" t="e"><f>SUM([Col])</f><v>#ERROR!</v></c><c r="B1" s="2" t="e"><v>#CALC!</v></c><c r="C1" t="e"><v>#N/A</v></c></row>"#;
        assert_eq!(
            fix_sheet(xml),
            r#"<row><c r="A1"><f>SUM([Col])</f></c><c r="B1" s="2" t="e"><v>#VALUE!</v></c><c r="C1" t="e"><v>#N/A</v></c></row>"#
        );
        assert_eq!(CALC_PR.replace("<calcPr/>", r#"<calcPr$1 fullCalcOnLoad="1"/>"#), r#"<calcPr fullCalcOnLoad="1"/>"#);
    }
}
