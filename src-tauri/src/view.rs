//! Sort and filter. They change which rows are shown and in what order, not
//! the data: a view maps display positions to sheet rows. Frozen rows (the
//! header) stay on top and are not sorted or filtered.

use std::cmp::Ordering;
use std::collections::{BTreeMap, BTreeSet, HashMap};

use ironcalc_base::cell::CellValue;
use ironcalc_base::Model;
use serde::{Deserialize, Serialize};

use crate::error::AppResult;

/// Rows and columns here count from 1, as in IronCalc.
#[derive(Clone, Serialize, Deserialize)]
pub struct SortKey {
    pub col: i32,
    pub desc: bool,
}

#[derive(Default)]
pub struct View {
    pub sort: Vec<SortKey>,
    pub filter: String,
    /// Columns filtered by value: the shown values of each.
    pub values: BTreeMap<i32, BTreeSet<String>>,
    /// The data rows in display order, or None when every row is shown in order.
    pub rows: Option<Vec<i32>>,
    /// The blank rows below a sorted or filtered view start at this row.
    pub extra_from: i32,
}

/// Sort order: numbers, then text, then TRUE/FALSE. Empty cells always go last.
#[derive(PartialEq)]
enum Key {
    Number(f64),
    Text(String),
    Bool(bool),
    Empty,
}

impl Key {
    fn rank(&self) -> u8 {
        match self {
            Key::Number(_) => 0,
            Key::Text(_) => 1,
            Key::Bool(_) => 2,
            Key::Empty => 3,
        }
    }

    fn of(model: &Model, sheet: u32, row: i32, col: i32) -> Key {
        match model.get_cell_value_by_index(sheet, row, col) {
            Ok(CellValue::Number(n)) => Key::Number(n),
            Ok(CellValue::Boolean(b)) => Key::Bool(b),
            Ok(CellValue::String(s)) if s.trim().is_empty() => Key::Empty,
            // Numbers kept as text, like "1 234,50", still sort as numbers.
            Ok(CellValue::String(s)) => parse_number(&s).map(Key::Number).unwrap_or_else(|| Key::Text(s.to_lowercase())),
            _ => Key::Empty,
        }
    }

    fn cmp(&self, other: &Key, desc: bool) -> Ordering {
        let order = match (self, other) {
            (Key::Number(a), Key::Number(b)) => a.partial_cmp(b).unwrap_or(Ordering::Equal),
            (Key::Text(a), Key::Text(b)) => a.cmp(b),
            (Key::Bool(a), Key::Bool(b)) => a.cmp(b),
            _ => return self.rank().cmp(&other.rank()).then(Ordering::Equal),
        };
        if desc {
            order.reverse()
        } else {
            order
        }
    }
}

/// Parses text as a number: "1234.5", "-3", "1 234,5" and "1,5" all count.
/// Values with letters, or both separators in an unclear order, are not numbers.
pub fn parse_number(value: &str) -> Option<f64> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }
    if let Ok(n) = trimmed.parse::<f64>() {
        return n.is_finite().then_some(n);
    }
    let compact: String = trimmed.chars().filter(|c| !c.is_whitespace() && *c != '\u{a0}').collect();
    let normalized = match (compact.rfind(','), compact.rfind('.')) {
        (Some(_), None) if compact.matches(',').count() == 1 => compact.replace(',', "."),
        (Some(comma), Some(dot)) if comma > dot => compact.replace('.', "").replace(',', "."),
        (Some(comma), Some(dot)) if dot > comma => compact.replace(',', ""),
        _ => compact,
    };
    normalized.parse::<f64>().ok().filter(|n| n.is_finite())
}

pub fn shown_text(model: &Model, sheet: u32, row: i32, col: i32) -> String {
    model.get_formatted_cell_value(sheet, row, col).unwrap_or_default()
}

impl View {
    pub fn is_active(&self) -> bool {
        !self.sort.is_empty() || !self.filter.trim().is_empty() || !self.values.is_empty()
    }

    /// Recomputes the shown rows from the current data.
    pub fn rebuild(&mut self, model: &Model, sheet: u32, frozen: i32) -> AppResult<()> {
        if !self.is_active() {
            self.rows = None;
            return Ok(());
        }
        // Only cells with values count: a sheet can have formatting on every row.
        let (max_row, _) = crate::book::value_extent(model, sheet)?;
        let needle = self.filter.trim().to_lowercase();
        let mut rows: Vec<i32> =
            (frozen + 1..=max_row).filter(|&row| self.matches(model, sheet, row, &needle)).collect();
        if !self.sort.is_empty() {
            let keys: HashMap<i32, Vec<Key>> = rows
                .iter()
                .map(|&row| (row, self.sort.iter().map(|k| Key::of(model, sheet, row, k.col)).collect()))
                .collect();
            rows.sort_by(|a, b| {
                self.sort
                    .iter()
                    .enumerate()
                    .map(|(i, k)| keys[a][i].cmp(&keys[b][i], k.desc))
                    .find(|o| o.is_ne())
                    .unwrap_or(Ordering::Equal)
            });
        }
        self.extra_from = max_row.max(frozen) + 1;
        self.rows = Some(rows);
        Ok(())
    }

    fn matches(&self, model: &Model, sheet: u32, row: i32, needle: &str) -> bool {
        for (&col, shown) in &self.values {
            if !shown.contains(&shown_text(model, sheet, row, col)) {
                return false;
            }
        }
        if needle.is_empty() {
            return true;
        }
        let Ok(ws) = model.workbook.worksheet(sheet) else { return false };
        ws.sheet_data
            .columns_in_row(row)
            .into_iter()
            .any(|col| shown_text(model, sheet, row, col).to_lowercase().contains(needle))
    }

    /// The sheet row shown at a display position (from 0).
    pub fn row_at(&self, frozen: i32, pos: i32) -> i32 {
        match &self.rows {
            Some(rows) if pos >= frozen => {
                let i = (pos - frozen) as usize;
                rows.get(i).copied().unwrap_or_else(|| self.extra_from + (i - rows.len()) as i32)
            }
            _ => pos + 1,
        }
    }

    /// Like `row_at`, and a blank row below the view that gets data joins it,
    /// so it keeps its place when more rows are added.
    pub fn claim_row(&mut self, frozen: i32, pos: i32) -> i32 {
        let row = self.row_at(frozen, pos);
        if let Some(rows) = &mut self.rows {
            if pos >= frozen && (pos - frozen) as usize >= rows.len() {
                while rows.len() <= (pos - frozen) as usize {
                    rows.push(self.extra_from);
                    self.extra_from += 1;
                }
            }
        }
        row
    }

    /// Display position of each sheet row in the view (for row heights).
    pub fn positions(&self, frozen: i32) -> Option<HashMap<i32, i32>> {
        self.rows
            .as_ref()
            .map(|rows| rows.iter().enumerate().map(|(i, &row)| (row, frozen + i as i32)).collect())
    }
}

/// The distinct values shown in a column below the header, with how often
/// each occurs, in sort order. Empty cells are the empty string.
pub fn column_values(model: &Model, sheet: u32, col: i32, frozen: i32) -> AppResult<Vec<(String, usize)>> {
    let (max_row, _) = crate::book::value_extent(model, sheet)?;
    let mut counts: HashMap<String, (usize, i32)> = HashMap::new();
    for row in frozen + 1..=max_row {
        counts.entry(shown_text(model, sheet, row, col)).or_insert((0, row)).0 += 1;
    }
    let mut values: Vec<(Key, String, usize)> = counts
        .into_iter()
        .map(|(text, (count, row))| (Key::of(model, sheet, row, col), text, count))
        .collect();
    values.sort_by(|a, b| a.0.cmp(&b.0, false).then_with(|| a.1.cmp(&b.1)));
    Ok(values.into_iter().take(5000).map(|(_, text, count)| (text, count)).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_numbers() {
        assert_eq!(parse_number("1 234,5"), Some(1234.5));
        assert_eq!(parse_number("1.234,56"), Some(1234.56));
        assert_eq!(parse_number("1,234.56"), Some(1234.56));
        assert_eq!(parse_number("12 kr"), None);
    }

    #[test]
    fn sorts_and_filters_below_the_header() {
        let mut model = crate::book::empty_model("en").unwrap();
        for (row, (name, qty)) in [("item", "qty"), ("pear", "3"), ("apple", ""), ("fig", "10"), ("kiwi", "2")]
            .into_iter()
            .enumerate()
        {
            model.set_user_input(0, row as i32 + 1, 1, name.to_string()).unwrap();
            model.set_user_input(0, row as i32 + 1, 2, qty.to_string()).unwrap();
        }
        model.evaluate();
        let mut view = View { sort: vec![SortKey { col: 2, desc: true }], ..View::default() };
        view.rebuild(&model, 0, 1).unwrap();
        assert_eq!(view.rows, Some(vec![4, 2, 5, 3]), "10, 3, 2, then the empty cell");
        assert_eq!(view.row_at(1, 0), 1, "header stays on top");
        assert_eq!(view.row_at(1, 1), 4);
        assert_eq!(view.row_at(1, 5), 6, "first blank row below the data");

        view.sort.clear();
        view.filter = "p".into();
        view.rebuild(&model, 0, 1).unwrap();
        assert_eq!(view.rows, Some(vec![2, 3]), "pear and apple");
        assert_eq!(view.claim_row(1, 3), 6);
        assert_eq!(view.rows, Some(vec![2, 3, 6]));
        assert_eq!(view.row_at(1, 4), 7);

        let values = column_values(&model, 0, 2, 1).unwrap();
        assert_eq!(values.iter().map(|(v, _)| v.as_str()).collect::<Vec<_>>(), ["2", "3", "10", ""]);
    }
}
