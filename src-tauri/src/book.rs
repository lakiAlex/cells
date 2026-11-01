//! Moves data between files and the IronCalc model. CSV files and the formats
//! that are read as values only are imported cell by cell; CSV is exported from
//! the calculated cell values.

use std::sync::OnceLock;

use ironcalc_base::cell::CellValue;
use ironcalc_base::Model;

use crate::error::{AppError, AppResult};
use crate::formats::csv::CsvFormat;
use crate::formats::excel::{Value, ValueSheet};

/// Function names and error codes are always English.
pub const LANGUAGE: &str = "en";

pub fn err(e: impl std::fmt::Display) -> AppError {
    AppError::other(e.to_string())
}

/// The Mac's time zone, which TODAY() and NOW() use. Falls back to UTC.
pub fn timezone() -> &'static str {
    static TZ: OnceLock<&'static str> = OnceLock::new();
    TZ.get_or_init(|| {
        std::fs::read_link("/etc/localtime")
            .ok()
            .and_then(|target| {
                let target = target.to_string_lossy().into_owned();
                target.split_once("zoneinfo/").map(|(_, name)| name.to_string())
            })
            .filter(|name| ironcalc_base::get_all_timezones().iter().any(|tz| tz == name))
            .map(|name| &*Box::leak(name.into_boxed_str()))
            .unwrap_or("UTC")
    })
}

/// Number formatting follows the file: CSV files with decimal commas use a
/// locale that writes "9,90" (and takes ";" between function arguments).
pub fn locale_for(decimal_comma: bool) -> &'static str {
    if decimal_comma {
        "de"
    } else {
        "en"
    }
}

pub fn empty_model(locale: &'static str) -> AppResult<Model<'static>> {
    Model::new_empty("Cells", locale, timezone(), LANGUAGE).map_err(err)
}

/// Sheet names are at most 31 characters and cannot contain : \ / ? * [ ].
pub fn sheet_name(name: &str) -> String {
    let clean: String = name
        .chars()
        .map(|c| if matches!(c, ':' | '\\' | '/' | '?' | '*' | '[' | ']') { '_' } else { c })
        .take(31)
        .collect();
    let clean = clean.trim().trim_matches('\'').to_string();
    if clean.is_empty() {
        "Sheet1".to_string()
    } else {
        clean
    }
}

/// A CSV field that is safe to store as a number: the number writes back as
/// the same text. Leading zeros (postal codes), long digit strings (IDs) and
/// thousands separators stay text.
fn csv_number(text: &str, decimal_comma: bool) -> Option<(f64, usize)> {
    let separator = if decimal_comma { ',' } else { '.' };
    let body = text.strip_prefix('-').unwrap_or(text);
    let (int, frac) = match body.split_once(separator) {
        Some((int, frac)) => (int, Some(frac)),
        None => (body, None),
    };
    let digits = |s: &str| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit());
    if !digits(int) || (int.len() > 1 && int.starts_with('0')) || int.len() > 11 {
        return None;
    }
    let decimals = match frac {
        Some(frac) if !digits(frac) || int.len() + frac.len() > 15 => return None,
        Some(frac) => frac.len(),
        None => 0,
    };
    let value: f64 = format!("{int}.{}", frac.unwrap_or("0")).parse().ok()?;
    if value == 0.0 && text.starts_with('-') {
        return None;
    }
    Some((if text.starts_with('-') { -value } else { value }, decimals))
}

fn decimals_format(decimals: usize) -> String {
    format!("0.{}", "0".repeat(decimals))
}

fn set_format(model: &mut Model, sheet: u32, row: i32, col: i32, format: &str) -> AppResult<()> {
    let mut style = model.get_style_for_cell(sheet, row, col).map_err(err)?;
    style.num_fmt = format.to_string();
    model.set_cell_style(sheet, row, col, &style).map_err(err)
}

/// Sets column widths from the longest text in the first 1000 rows.
fn autosize(model: &mut Model, sheet: u32, lengths: &[usize]) -> AppResult<()> {
    for (c, &chars) in lengths.iter().enumerate() {
        let width = (chars as f64 * 7.5 + 22.0).clamp(64.0, 360.0);
        model.set_column_width(sheet, c as i32 + 1, width.round()).map_err(err)?;
    }
    Ok(())
}

fn note_length(lengths: &mut Vec<usize>, row: usize, col: usize, chars: usize) {
    if row >= 1000 {
        return;
    }
    if lengths.len() <= col {
        lengths.resize(col + 1, 0);
    }
    lengths[col] = lengths[col].max(chars);
}

pub fn from_csv(rows: &[Vec<String>], format: &CsvFormat, name: &str) -> AppResult<Model<'static>> {
    let mut model = empty_model(locale_for(format.decimal_comma))?;
    model.rename_sheet_by_index(0, &sheet_name(name)).map_err(err)?;
    let mut lengths = Vec::new();
    for (r, fields) in rows.iter().enumerate() {
        let row = r as i32 + 1;
        for (c, text) in fields.iter().enumerate().filter(|(_, t)| !t.is_empty()) {
            let col = c as i32 + 1;
            note_length(&mut lengths, r, c, text.chars().count());
            match csv_number(text, format.decimal_comma) {
                Some((number, decimals)) => {
                    model.update_cell_with_number(0, row, col, number).map_err(err)?;
                    // "9,90" keeps its zero.
                    if decimals > 0 && text.ends_with('0') {
                        set_format(&mut model, 0, row, col, &decimals_format(decimals))?;
                    }
                }
                None => model.update_cell_with_text(0, row, col, text).map_err(err)?,
            }
        }
    }
    autosize(&mut model, 0, &lengths)?;
    // The first line of a CSV file is almost always the header.
    if rows.len() > 1 {
        model.set_frozen_rows(0, 1).map_err(err)?;
    }
    Ok(model)
}

pub fn from_values(sheets: Vec<ValueSheet>) -> AppResult<Model<'static>> {
    let mut model = empty_model("en")?;
    for (index, sheet) in sheets.into_iter().enumerate() {
        let name = sheet_name(&sheet.name);
        let s = index as u32;
        if index == 0 {
            model.rename_sheet_by_index(0, &name).map_err(err)?;
        } else {
            model.add_sheet(&name).map_err(err)?;
        }
        let mut lengths = Vec::new();
        for (r, cells) in sheet.rows.into_iter().enumerate() {
            let row = r as i32 + 1;
            for (c, value) in cells.into_iter().enumerate() {
                let col = c as i32 + 1;
                let chars = match value {
                    Value::Empty => continue,
                    Value::Number(n) if !n.is_finite() => {
                        model.update_cell_with_text(s, row, col, "#NUM!").map_err(err)?;
                        5
                    }
                    Value::Number(n) => {
                        model.update_cell_with_number(s, row, col, n).map_err(err)?;
                        plain_number(n, false).len()
                    }
                    Value::Text(text) => {
                        model.update_cell_with_text(s, row, col, &text).map_err(err)?;
                        text.chars().count()
                    }
                    Value::Bool(b) => {
                        model.update_cell_with_bool(s, row, col, b).map_err(err)?;
                        5
                    }
                    Value::Date(serial, time) => {
                        model.update_cell_with_number(s, row, col, serial).map_err(err)?;
                        let format = if time { "yyyy-mm-dd hh:mm:ss" } else { "yyyy-mm-dd" };
                        set_format(&mut model, s, row, col, format)?;
                        format.len()
                    }
                };
                note_length(&mut lengths, r, c, chars);
            }
        }
        autosize(&mut model, s, &lengths)?;
    }
    model.evaluate();
    Ok(model)
}

/// Formulas whose result changed when Cells recalculated an opened file.
#[derive(Default)]
pub struct Recalc {
    pub changed: usize,
    /// A few of them, as "Sheet1!B3 =SUM(A1:A2) was 3, now #VALUE!".
    pub examples: Vec<String>,
}

const RANDOM_OR_TIME: [&str; 5] = ["RAND(", "RANDBETWEEN(", "RANDARRAY(", "NOW(", "TODAY("];

fn value_text(value: &CellValue) -> String {
    match value {
        CellValue::None => "empty".to_string(),
        CellValue::String(s) => s.clone(),
        CellValue::Number(n) => plain_number(*n, false),
        CellValue::Boolean(b) => if *b { "TRUE" } else { "FALSE" }.to_string(),
    }
}

fn column_letters(col: i32) -> String {
    let mut name = String::new();
    let mut n = col;
    while n > 0 {
        name.insert(0, (b'A' + ((n - 1) % 26) as u8) as char);
        n = (n - 1) / 26;
    }
    name
}

/// Calculates every formula, and when the file had stored results, counts
/// the formulas that now give something else. Cells does not support all of
/// Excel (table references, links to other files), and the user should know
/// before saving.
pub fn evaluate_and_compare(model: &mut Model, stored_results: bool) -> Recalc {
    let mut cells = Vec::new();
    if stored_results {
        for (index, ws) in model.workbook.worksheets.iter().enumerate() {
            for (row, col, cell) in ws.sheet_data.cells() {
                if cell.has_formula() && cells.len() < 500_000 {
                    cells.push((index as u32, row, col));
                }
            }
        }
    }
    let before: Vec<CellValue> =
        cells.iter().map(|&(s, r, c)| model.get_cell_value_by_index(s, r, c).unwrap_or(CellValue::None)).collect();
    model.evaluate();
    let mut recalc = Recalc::default();
    for (&(sheet, row, col), old) in cells.iter().zip(before) {
        let new = model.get_cell_value_by_index(sheet, row, col).unwrap_or(CellValue::None);
        let same = match (&old, &new) {
            (CellValue::Number(a), CellValue::Number(b)) => (a - b).abs() <= 1e-9 * a.abs().max(b.abs()).max(1.0),
            (CellValue::None, CellValue::String(s)) | (CellValue::String(s), CellValue::None) => s.is_empty(),
            _ => old == new,
        };
        if same {
            continue;
        }
        let formula = model.get_cell_formula(sheet, row, col).ok().flatten().unwrap_or_default();
        if RANDOM_OR_TIME.iter().any(|f| formula.to_uppercase().contains(f)) {
            continue;
        }
        recalc.changed += 1;
        if recalc.examples.len() < 3 {
            let name = &model.workbook.worksheets[sheet as usize].name;
            recalc.examples.push(format!(
                "{name}!{}{row} {formula}: was {}, now {}",
                column_letters(col),
                value_text(&old),
                value_text(&new)
            ));
        }
    }
    recalc
}

/// A number as plain text with up to 15 significant digits, so 0.1 + 0.2
/// is written as 0.3.
pub fn plain_number(n: f64, decimal_comma: bool) -> String {
    if n.fract() == 0.0 && n.abs() < 1e15 {
        return format!("{}", n as i64);
    }
    let rounded: f64 = format!("{n:.14e}").parse().unwrap_or(n);
    let text = format!("{rounded}");
    if decimal_comma {
        text.replace('.', ",")
    } else {
        text
    }
}

/// The text a cell writes to CSV: numbers with a number format are written
/// the way they are shown, others as plain numbers.
fn export_text(model: &Model, sheet: u32, row: i32, col: i32, decimal_comma: bool) -> AppResult<String> {
    Ok(match model.get_cell_value_by_index(sheet, row, col).map_err(err)? {
        CellValue::None => String::new(),
        CellValue::String(s) => s,
        CellValue::Boolean(b) => if b { "TRUE" } else { "FALSE" }.to_string(),
        CellValue::Number(n) => {
            let format = model.get_style_for_cell(sheet, row, col).map_err(err)?.num_fmt;
            if format.eq_ignore_ascii_case("general") {
                plain_number(n, decimal_comma)
            } else {
                model.get_formatted_cell_value(sheet, row, col).map_err(err)?
            }
        }
    })
}

/// The last row and column that hold a value, ignoring cells with only formatting.
pub fn value_extent(model: &Model, sheet: u32) -> AppResult<(i32, i32)> {
    let ws = model.workbook.worksheet(sheet).map_err(err)?;
    let (mut rows, mut cols) = (0, 0);
    for (row, col, _) in ws.sheet_data.cells() {
        if (row > rows || col > cols) && !ws.is_empty_cell(row, col).map_err(err)? {
            rows = rows.max(row);
            cols = cols.max(col);
        }
    }
    Ok((rows, cols))
}

/// The rows a CSV file gets. Every line has the same number of fields,
/// unless the file came with lines of different lengths.
pub fn csv_rows(model: &Model, sheet: u32, format: &CsvFormat) -> AppResult<Vec<Vec<String>>> {
    let (rows, cols) = value_extent(model, sheet)?;
    (1..=rows)
        .map(|row| {
            let mut fields = (1..=cols)
                .map(|col| export_text(model, sheet, row, col, format.decimal_comma))
                .collect::<AppResult<Vec<_>>>()?;
            if format.ragged {
                while fields.len() > 1 && fields.last().is_some_and(String::is_empty) {
                    fields.pop();
                }
            }
            Ok(fields)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::formats::csv;

    #[test]
    fn csv_numbers() {
        assert_eq!(csv_number("12", false), Some((12.0, 0)));
        assert_eq!(csv_number("-9,90", true), Some((-9.9, 2)));
        assert_eq!(csv_number("9,90", false), None);
        assert_eq!(csv_number("0150", false), None, "postal code");
        assert_eq!(csv_number("0.5", false), Some((0.5, 1)));
        assert_eq!(csv_number("7090123456789", false), None, "barcode");
        assert_eq!(csv_number("1 234", false), None);
        assert_eq!(csv_number("1e5", false), None);
        assert_eq!(csv_number("-0", false), None);
        assert_eq!(plain_number(0.1 + 0.2, false), "0.3");
        assert_eq!(plain_number(-1.25, true), "-1,25");
        assert_eq!(plain_number(42.0, false), "42");
    }

    /// Every field comes back as the same text, and numbers are numbers.
    #[test]
    fn csv_round_trip_through_model() {
        let text = "navn;pris;postnr;dato\r\nPære;9,90;0150;2024-01-15\r\nKake;12;7090123456789;\r\n";
        let format = CsvFormat { delimiter: b';', decimal_comma: true, ..CsvFormat::default() };
        let rows = csv::parse(text, b';').unwrap();
        assert!(csv::detect_decimal_comma(&rows, b';'));
        let mut model = from_csv(&rows, &format, "varer").unwrap();
        model.evaluate();
        assert_eq!(model.get_cell_value_by_index(0, 2, 2).unwrap(), CellValue::Number(9.9));
        assert_eq!(model.get_formatted_cell_value(0, 2, 2).unwrap(), "9,90");
        assert_eq!(model.get_frozen_rows_count(0).unwrap(), 1);
        let back = csv_rows(&model, 0, &format).unwrap();
        assert_eq!(back, rows);
    }
}
