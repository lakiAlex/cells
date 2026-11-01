//! Spreadsheet formats that IronCalc cannot read (.xls, .xlsb and .ods).
//! calamine reads their values and the last calculated value of formulas.

use std::path::Path;

use calamine::{open_workbook_auto, Data, Reader};

use crate::error::{AppError, AppResult};

pub enum Value {
    Empty,
    Number(f64),
    Text(String),
    Bool(bool),
    /// An Excel date serial number, and whether it has a time of day.
    Date(f64, bool),
}

pub struct ValueSheet {
    pub name: String,
    pub rows: Vec<Vec<Value>>,
}

fn value(data: &Data) -> Value {
    match data {
        Data::Empty => Value::Empty,
        Data::String(s) => Value::Text(s.clone()),
        Data::Int(n) => Value::Number(*n as f64),
        Data::Float(f) => Value::Number(*f),
        Data::Bool(b) => Value::Bool(*b),
        Data::DateTime(dt) if dt.is_duration() => Value::Number(dt.as_f64()),
        Data::DateTime(dt) => Value::Date(dt.as_f64(), dt.as_f64().fract() != 0.0),
        Data::DateTimeIso(s) | Data::DurationIso(s) => Value::Text(s.clone()),
        Data::Error(e) => Value::Text(e.to_string()),
    }
}

pub fn read_values(path: &Path) -> AppResult<Vec<ValueSheet>> {
    let mut workbook = open_workbook_auto(path).map_err(|e| {
        let text = e.to_string();
        if text.contains("password protected") {
            AppError::new("encrypted", "This file is protected with a password. Cells cannot open encrypted files.")
        } else {
            AppError::other(format!("Could not open the file: {text}"))
        }
    })?;
    let mut sheets = Vec::new();
    for name in workbook.sheet_names() {
        let range = workbook
            .worksheet_range(&name)
            .map_err(|e| AppError::other(format!("Could not read sheet {name}: {e}")))?;
        // A range starts at its first used cell, which is not always A1.
        let (top, left) = range.start().map(|(r, c)| (r as usize, c as usize)).unwrap_or((0, 0));
        let mut rows: Vec<Vec<Value>> = (0..top).map(|_| Vec::new()).collect();
        for cells in range.rows() {
            let mut row: Vec<Value> = (0..left).map(|_| Value::Empty).collect();
            row.extend(cells.iter().map(value));
            rows.push(row);
        }
        sheets.push(ValueSheet { name, rows });
    }
    if sheets.is_empty() {
        return Err(AppError::other("The workbook has no sheets"));
    }
    Ok(sheets)
}
