//! Keeps the parts of an Excel file that IronCalc does not model (filters,
//! pictures, charts, comments, data validation, tables, print settings) when
//! Cells saves it. They are copied from the original file into the file
//! IronCalc wrote, sheet by sheet (matched by sheet id), with the files they
//! refer to.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::io::{Cursor, Read, Write};
use std::sync::LazyLock;

use regex::Regex;
use zip::write::SimpleFileOptions;
use zip::{ZipArchive, ZipWriter};

use crate::error::{AppError, AppResult};

/// Top-level elements of a worksheet in the order the format requires.
const ORDER: [&str; 39] = [
    "sheetPr", "dimension", "sheetViews", "sheetFormatPr", "cols", "sheetData", "sheetCalcPr", "sheetProtection",
    "protectedRanges", "scenarios", "autoFilter", "sortState", "dataConsolidate", "customSheetViews", "mergeCells",
    "phoneticPr", "conditionalFormatting", "dataValidations", "hyperlinks", "printOptions", "pageMargins",
    "pageSetup", "headerFooter", "rowBreaks", "colBreaks", "customProperties", "cellWatches", "ignoredErrors",
    "smartTags", "drawing", "legacyDrawing", "legacyDrawingHF", "drawingHF", "picture", "oleObjects", "controls",
    "webPublishItems", "tableParts", "extLst",
];

/// The elements copied from the original sheet when the saved one lacks them.
const CARRIED: [&str; 17] = [
    "sheetProtection", "protectedRanges", "autoFilter", "sortState", "dataValidations", "printOptions",
    "pageMargins", "pageSetup", "headerFooter", "rowBreaks", "colBreaks", "ignoredErrors", "drawing",
    "legacyDrawing", "legacyDrawingHF", "picture", "tableParts",
];

static TAG: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"<!\[CDATA\[.*?\]\]>|<!--.*?-->|<\?.*?\?>|<(/?)([\w:.-]+)[^>]*?(/?)>").unwrap());
static ATTR: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"([\w:.-]+)="([^"]*)""#).unwrap());
static REL_ID: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"(\b[\w]+:id)="([^"]+)""#).unwrap());
static NAMESPACE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"\sxmlns:([\w]+)="([^"]+)""#).unwrap());
static RELATIONSHIP: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"<Relationship\s[^>]*?/?>").unwrap());

fn zip_error(e: impl std::fmt::Display) -> AppError {
    AppError::other(format!("Could not save the Excel file: {e}"))
}

fn local(name: &str) -> &str {
    name.rsplit(':').next().unwrap_or(name)
}

fn attrs(tag: &str) -> HashMap<String, String> {
    ATTR.captures_iter(tag).map(|c| (c[1].to_string(), c[2].to_string())).collect()
}

/// A top-level element inside the root of an XML part.
struct Child {
    name: String,
    start: usize,
    end: usize,
}

/// The children of the root element, and where the root's closing tag starts.
fn children(xml: &str) -> (Vec<Child>, usize, usize) {
    let mut depth = 0;
    let mut out = Vec::new();
    let (mut root_open_end, mut root_close) = (0, xml.len());
    let mut current: Option<(String, usize)> = None;
    for m in TAG.captures_iter(xml) {
        let whole = m.get(0).unwrap();
        let Some(name) = m.get(2) else { continue };
        let closing = !m[1].is_empty();
        let empty = !m[3].is_empty();
        if closing {
            depth -= 1;
            if depth == 1 {
                if let Some((n, s)) = current.take() {
                    out.push(Child { name: n, start: s, end: whole.end() });
                }
            } else if depth == 0 {
                root_close = whole.start();
            }
        } else {
            if depth == 0 {
                root_open_end = whole.end();
            } else if depth == 1 {
                if empty {
                    out.push(Child { name: local(name.as_str()).to_string(), start: whole.start(), end: whole.end() });
                    continue;
                }
                current = Some((local(name.as_str()).to_string(), whole.start()));
            }
            if !empty {
                depth += 1;
            }
        }
    }
    (out, root_open_end, root_close)
}

struct Package {
    parts: BTreeMap<String, Vec<u8>>,
}

impl Package {
    fn read(bytes: &[u8]) -> AppResult<Self> {
        let mut archive = ZipArchive::new(Cursor::new(bytes)).map_err(zip_error)?;
        let mut parts = BTreeMap::new();
        for i in 0..archive.len() {
            let mut file = archive.by_index(i).map_err(zip_error)?;
            if file.is_dir() {
                continue;
            }
            let name = file.name().map_err(zip_error)?.replace('\\', "/");
            let mut data = Vec::new();
            file.read_to_end(&mut data).map_err(zip_error)?;
            parts.insert(name, data);
        }
        Ok(Self { parts })
    }

    fn text(&self, name: &str) -> Option<String> {
        self.parts.get(name).and_then(|d| String::from_utf8(d.clone()).ok())
    }

    fn write(self) -> AppResult<Vec<u8>> {
        let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
        let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        // [Content_Types].xml goes first, as Excel writes it.
        let mut names: Vec<&String> = self.parts.keys().collect();
        names.sort_by_key(|n| *n != "[Content_Types].xml");
        for name in names {
            writer.start_file(name.as_str(), options).map_err(zip_error)?;
            writer.write_all(&self.parts[name]).map_err(zip_error)?;
        }
        Ok(writer.finish().map_err(zip_error)?.into_inner())
    }

    /// Relationships of a part: id -> (type, target path, external).
    fn rels(&self, part: &str) -> Vec<(String, String, String, bool)> {
        let Some(xml) = self.text(&rels_path(part)) else { return Vec::new() };
        RELATIONSHIP
            .find_iter(&xml)
            .map(|m| {
                let a = attrs(m.as_str());
                let external = a.get("TargetMode").is_some_and(|t| t == "External");
                let target = a.get("Target").cloned().unwrap_or_default();
                let target = if external { target } else { resolve(part, &target) };
                (a.get("Id").cloned().unwrap_or_default(), a.get("Type").cloned().unwrap_or_default(), target, external)
            })
            .collect()
    }

    /// Sheet id -> worksheet part path.
    fn sheets(&self) -> HashMap<String, String> {
        let Some(workbook) = self.text("xl/workbook.xml") else { return HashMap::new() };
        let rels: HashMap<String, String> =
            self.rels("xl/workbook.xml").into_iter().map(|(id, _, target, _)| (id, target)).collect();
        let sheet = Regex::new(r"<(\w+:)?sheet\s[^>]*>").unwrap();
        sheet
            .find_iter(&workbook)
            .filter_map(|m| {
                let a = attrs(m.as_str());
                let id = a.iter().find(|(k, _)| k.ends_with(":id")).map(|(_, v)| v.clone())?;
                Some((a.get("sheetId")?.clone(), rels.get(&id)?.clone()))
            })
            .collect()
    }
}

fn rels_path(part: &str) -> String {
    match part.rsplit_once('/') {
        Some((dir, file)) => format!("{dir}/_rels/{file}.rels"),
        None => format!("_rels/{part}.rels"),
    }
}

/// A relationship target relative to the part that refers to it.
fn resolve(part: &str, target: &str) -> String {
    if let Some(absolute) = target.strip_prefix('/') {
        return absolute.to_string();
    }
    let mut path: Vec<&str> = part.split('/').collect();
    path.pop();
    for piece in target.split('/') {
        match piece {
            ".." => {
                path.pop();
            }
            "." | "" => {}
            p => path.push(p),
        }
    }
    path.join("/")
}

/// The path of `target` relative to the folder of `part`.
fn relative(part: &str, target: &str) -> String {
    let from: Vec<&str> = part.split('/').collect();
    let from = &from[..from.len() - 1];
    let to: Vec<&str> = target.split('/').collect();
    let common = from.iter().zip(&to).take_while(|(a, b)| a == b).count();
    let mut out: Vec<&str> = vec![".."; from.len() - common];
    out.extend(&to[common..]);
    out.join("/")
}

/// Copies `part` and everything it refers to from `source` into `target`.
fn copy_part(source: &Package, target: &mut Package, part: &str, copied: &mut HashSet<String>) {
    if !copied.insert(part.to_string()) || target.parts.contains_key(part) {
        return;
    }
    let Some(data) = source.parts.get(part) else { return };
    target.parts.insert(part.to_string(), data.clone());
    let rels = rels_path(part);
    if let Some(data) = source.parts.get(&rels) {
        target.parts.insert(rels, data.clone());
        for (_, _, linked, external) in source.rels(part) {
            if !external {
                copy_part(source, target, &linked, copied);
            }
        }
    }
}

fn add_content_types(source: &Package, target: &mut Package, copied: &HashSet<String>) {
    let (Some(from), Some(mut to)) = (source.text("[Content_Types].xml"), target.text("[Content_Types].xml")) else {
        return;
    };
    let override_re = Regex::new(r"<Override\s[^>]*?/?>").unwrap();
    let default_re = Regex::new(r"<Default\s[^>]*?/?>").unwrap();
    let overrides: HashMap<String, String> = override_re
        .find_iter(&from)
        .filter_map(|m| attrs(m.as_str()).get("PartName").map(|p| (p.trim_start_matches('/').to_string(), m.as_str().to_string())))
        .collect();
    let defaults: HashMap<String, String> = default_re
        .find_iter(&from)
        .filter_map(|m| attrs(m.as_str()).get("Extension").map(|e| (e.to_lowercase(), m.as_str().to_string())))
        .collect();
    let mut add = String::new();
    let mut parts: Vec<&String> = copied.iter().collect();
    parts.sort();
    for part in parts {
        if let Some(entry) = overrides.get(part.as_str()) {
            if !to.contains(&format!("PartName=\"/{part}\"")) {
                add.push_str(entry);
            }
        } else if let Some(ext) = part.rsplit('.').next().map(str::to_lowercase) {
            if let Some(entry) = defaults.get(&ext) {
                let has_default = default_re
                    .find_iter(&to)
                    .any(|m| attrs(m.as_str()).get("Extension").is_some_and(|e| e.eq_ignore_ascii_case(&ext)));
                if !has_default && !add.contains(entry.as_str()) {
                    add.push_str(entry);
                }
            }
        }
    }
    // Defaults must come before overrides; putting all of them first works for both.
    if let Some(pos) = to.find("<Default").or_else(|| to.find("<Override")) {
        to.insert_str(pos, &add);
    } else if let Some(pos) = to.rfind("</Types>") {
        to.insert_str(pos, &add);
    }
    target.parts.insert("[Content_Types].xml".into(), to.into_bytes());
}

/// Puts the parts of the original file that IronCalc dropped back into the
/// file it wrote.
pub fn carry_over(original: &[u8], saved: Vec<u8>) -> AppResult<Vec<u8>> {
    let source = Package::read(original)?;
    let mut target = Package::read(&saved)?;
    let old_sheets = source.sheets();
    let new_sheets = target.sheets();
    let mut copied = HashSet::new();
    let mut changed = false;

    for (sheet_id, new_part) in &new_sheets {
        let Some(old_part) = old_sheets.get(sheet_id) else { continue };
        let (Some(old_xml), Some(new_xml)) = (source.text(old_part), target.text(new_part)) else { continue };
        let (old_children, old_root_end, _) = children(&old_xml);
        let (new_children, new_root_end, new_root_close) = children(&new_xml);
        let present: HashSet<&str> = new_children.iter().map(|c| c.name.as_str()).collect();
        let carried: Vec<&Child> = old_children
            .iter()
            .filter(|c| CARRIED.contains(&c.name.as_str()) && !present.contains(c.name.as_str()))
            .collect();
        // Comments are linked from the sheet without an element pointing at them.
        let comment_rels: Vec<(String, String, String, bool)> = source
            .rels(old_part)
            .into_iter()
            .filter(|(_, ty, _, _)| ty.ends_with("/comments"))
            .collect();
        if carried.is_empty() && comment_rels.is_empty() {
            continue;
        }

        // Relationship ids of the carried elements get new, unused ids.
        let old_rels: HashMap<String, (String, String, bool)> =
            source.rels(old_part).into_iter().map(|(id, ty, t, ext)| (id, (ty, t, ext))).collect();
        let mut new_rels_xml = target.text(&rels_path(new_part)).unwrap_or_else(|| {
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>"#.to_string()
        });
        let mut added_rels = String::new();
        let mut inserts: Vec<(usize, String)> = Vec::new();
        for (n, child) in carried.iter().enumerate() {
            let mut text = old_xml[child.start..child.end].to_string();
            for cap in REL_ID.captures_iter(&old_xml[child.start..child.end]) {
                let (attr, id) = (&cap[1], &cap[2]);
                let Some((ty, target_path, external)) = old_rels.get(id) else { continue };
                let new_id = format!("rIdCells{}{n}", id.trim_start_matches("rId"));
                let target_attr = if *external { target_path.clone() } else { relative(new_part, target_path) };
                let mode = if *external { r#" TargetMode="External""# } else { "" };
                added_rels.push_str(&format!(r#"<Relationship Id="{new_id}" Type="{ty}" Target="{target_attr}"{mode}/>"#));
                text = text.replace(&format!(r#"{attr}="{id}""#), &format!(r#"{attr}="{new_id}""#));
                if !external {
                    copy_part(&source, &mut target, target_path, &mut copied);
                }
            }
            let rank = ORDER.iter().position(|o| *o == child.name).unwrap_or(ORDER.len());
            let position = new_children
                .iter()
                .find(|c| ORDER.iter().position(|o| *o == c.name).unwrap_or(ORDER.len()) > rank)
                .map_or(new_root_close, |c| c.start);
            inserts.push((position, text));
        }

        let new_targets = target.rels(new_part);
        for (n, (_, ty, target_path, _)) in comment_rels.iter().enumerate() {
            if new_targets.iter().any(|(_, _, t, _)| t == target_path) {
                continue;
            }
            let target_attr = relative(new_part, target_path);
            added_rels.push_str(&format!(r#"<Relationship Id="rIdCellsComments{n}" Type="{ty}" Target="{target_attr}"/>"#));
            copy_part(&source, &mut target, target_path, &mut copied);
        }

        // Namespace prefixes the carried elements use must be declared on the root.
        let new_root = &new_xml[..new_root_end];
        let mut declarations = String::new();
        for cap in NAMESPACE.captures_iter(&old_xml[..old_root_end]) {
            let prefix = &cap[1];
            let used = carried.iter().any(|c| old_xml[c.start..c.end].contains(&format!("{prefix}:")));
            if used && !new_root.contains(&format!("xmlns:{prefix}=")) {
                declarations.push_str(&format!(r#" xmlns:{prefix}="{}""#, &cap[2]));
            }
        }

        let mut xml = new_xml.clone();
        inserts.sort_by_key(|(p, _)| *p);
        for (position, text) in inserts.iter().rev() {
            xml.insert_str(*position, text);
        }
        if !declarations.is_empty() {
            let close = xml[..new_root_end].rfind('>').unwrap_or(new_root_end - 1);
            let close = if xml[..close].ends_with('/') { close - 1 } else { close };
            xml.insert_str(close, &declarations);
        }
        target.parts.insert(new_part.clone(), xml.into_bytes());
        if !added_rels.is_empty() {
            let pos = new_rels_xml.rfind("</Relationships>").unwrap_or(new_rels_xml.len());
            new_rels_xml.insert_str(pos, &added_rels);
            let rels = rels_path(new_part);
            if !target.parts.contains_key(&rels) {
                copied.insert(rels.clone());
            }
            target.parts.insert(rels, new_rels_xml.into_bytes());
        }
        changed = true;
    }
    if !changed {
        return Ok(saved);
    }
    add_content_types(&source, &mut target, &copied);
    target.write()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paths() {
        assert_eq!(resolve("xl/worksheets/sheet1.xml", "../drawings/drawing1.xml"), "xl/drawings/drawing1.xml");
        assert_eq!(resolve("xl/workbook.xml", "worksheets/sheet1.xml"), "xl/worksheets/sheet1.xml");
        assert_eq!(resolve("xl/workbook.xml", "/xl/worksheets/sheet1.xml"), "xl/worksheets/sheet1.xml");
        assert_eq!(relative("xl/worksheets/sheet2.xml", "xl/drawings/drawing1.xml"), "../drawings/drawing1.xml");
        assert_eq!(rels_path("xl/worksheets/sheet1.xml"), "xl/worksheets/_rels/sheet1.xml.rels");
    }

    #[test]
    fn finds_children() {
        let xml = r#"<?xml version="1.0"?><worksheet xmlns="m"><sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData><autoFilter ref="A1:B2"/><pageMargins left="1"/></worksheet>"#;
        let (kids, _, close) = children(xml);
        let names: Vec<&str> = kids.iter().map(|c| c.name.as_str()).collect();
        assert_eq!(names, ["sheetData", "autoFilter", "pageMargins"]);
        assert_eq!(&xml[kids[1].start..kids[1].end], r#"<autoFilter ref="A1:B2"/>"#);
        assert_eq!(&xml[close..], "</worksheet>");
    }
}
