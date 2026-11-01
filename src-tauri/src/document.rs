//! An open spreadsheet: the IronCalc model, where it came from, the sort and
//! filter view of each sheet, and the undo history.

use std::collections::{BTreeSet, HashMap};
use std::fs::File;
use std::io::{BufWriter, Cursor, Write};
use std::panic::AssertUnwindSafe;
use std::path::{Path, PathBuf};

use ironcalc_base::cell::CellValue;
use ironcalc_base::expressions::types::Area;
use ironcalc_base::types::Color;
use ironcalc_base::{BorderArea, ClipboardData, Model, UserModel};
use serde::{Deserialize, Serialize};

use crate::book::{self, err, LANGUAGE};
use crate::error::{AppError, AppResult};
use crate::formats::csv::{self, CsvFormat};
use crate::formats::{carry, excel, replace_file, xlsx};
use crate::render::{self, StyleDto};
use crate::view::{self, SortKey, View};

const LAST_ROW: i32 = 1_048_576;
const LAST_COL: i32 = 16_384;

pub enum Source {
    Csv(CsvFormat),
    Xlsx,
    /// A format Cells reads but does not write. Saving goes through Save As.
    SaveAsOnly(&'static str),
    /// A new spreadsheet that has not been saved yet.
    New,
}

/// A rectangle of display positions, counted from 0, corners included.
#[derive(Deserialize, Serialize, Clone, Copy, Debug, PartialEq)]
pub struct Rect {
    pub r0: i32,
    pub c0: i32,
    pub r1: i32,
    pub c1: i32,
}

impl Rect {
    fn width(&self) -> i32 {
        self.c1 - self.c0 + 1
    }
    fn height(&self) -> i32 {
        self.r1 - self.r0 + 1
    }
}

/// Cells copied in this app, so a paste keeps formulas and formatting.
pub struct Clip {
    pub doc: String,
    pub text: String,
    pub cut: bool,
    sheet: u32,
    range: (i32, i32, i32, i32),
    data: ClipboardData,
}

#[derive(Deserialize)]
struct CopiedCells {
    csv: String,
    data: ClipboardData,
    sheet: u32,
    range: (i32, i32, i32, i32),
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SheetInfo {
    pub name: String,
    pub hidden: bool,
    pub color: Option<String>,
}

/// What the user should know about how Cells handles the opened file.
#[derive(Serialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Notice {
    /// Parts of the file Cells does not show and does not save.
    pub unkept: Vec<String>,
    /// Formulas that give a different result in Cells than stored in the file.
    pub recalc_changed: usize,
    pub recalc_examples: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocInfo {
    pub id: String,
    pub title: String,
    pub location: String,
    pub kind: String,
    pub can_save: bool,
    /// Saving keeps only one sheet.
    pub single_sheet: bool,
    pub dirty: bool,
    pub can_undo: bool,
    pub can_redo: bool,
    pub sheets: Vec<SheetInfo>,
    pub notice: Notice,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Layout {
    /// Display rows and columns, including blank ones to type into.
    pub rows: i32,
    pub cols: i32,
    /// Last row and column with data or formatting.
    pub data_rows: i32,
    pub data_cols: i32,
    pub frozen_rows: i32,
    pub frozen_cols: i32,
    /// Pixel width of each column; 0 is hidden.
    pub col_widths: Vec<f64>,
    /// Display positions whose height differs from `default_row`; 0 is hidden.
    pub row_heights: Vec<(i32, f64)>,
    pub default_row: f64,
    /// Merged cells as [row, col, height, width] in display positions.
    pub merges: Vec<[i32; 4]>,
    pub sort: Vec<SortKey>,
    pub filter: String,
    /// Columns filtered by value, with the values they show.
    pub value_filters: Vec<(i32, Vec<String>)>,
    /// Data rows shown by a filter, when one is set.
    pub shown: Option<i32>,
    pub grid_lines: bool,
    /// Font size of the default style, which the grid shows at its base size.
    pub base_size: i32,
}

/// A cell as [shown text, style id, value type] (see `render::kind`).
pub type CellOut = (String, i32, u8);

#[derive(Serialize)]
pub struct RowOut {
    pub pos: i32,
    pub cells: Vec<Option<CellOut>>,
}

#[derive(Serialize)]
pub struct CellsOut {
    pub rows: Vec<RowOut>,
    pub styles: HashMap<i32, StyleDto>,
    /// Sheet row number of each requested position, when sorted or filtered.
    pub labels: Option<Vec<i32>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CellInfo {
    /// What the editor shows: the formula, or the value as typed.
    pub content: String,
    pub style: StyleDto,
    pub merged: bool,
    /// Sheet row number, which differs from the position when sorted or filtered.
    pub row: i32,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    pub cells: i64,
    pub filled: i64,
    pub numbers: i64,
    pub sum: f64,
    pub min: Option<f64>,
    pub max: Option<f64>,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FindOptions {
    pub query: String,
    #[serde(default)]
    pub match_case: bool,
    #[serde(default)]
    pub whole_cell: bool,
}

#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Edit {
    Input { pos: i32, col: i32, value: String },
    Clear { rect: Rect, what: String },
    Style { rect: Rect, path: String, value: String },
    Decimals { rect: Rect, pos: i32, col: i32, delta: i32 },
    Border { rect: Rect, kind: String, style: String, color: String },
    Merge { rect: Rect },
    Unmerge { rect: Rect },
    InsertRows { pos: i32, count: i32 },
    DeleteRows { pos: i32, count: i32 },
    MoveRows { pos: i32, count: i32, delta: i32 },
    HideRows { pos: i32, count: i32, hidden: bool },
    RowHeight { pos: i32, count: i32, height: f64 },
    InsertCols { col: i32, count: i32 },
    DeleteCols { col: i32, count: i32 },
    MoveCols { col: i32, count: i32, delta: i32 },
    HideCols { col: i32, count: i32, hidden: bool },
    ColWidth { col: i32, count: i32, width: f64 },
    Freeze { rows: i32, cols: i32 },
    /// Fill handle: extends `rect` to row `to` (down or up) or column `to`.
    Autofill { rect: Rect, to: i32, rows: bool },
    FillDown { rect: Rect },
    FillRight { rect: Rect },
    Paste { rect: Rect, text: String },
    Replace { find: FindOptions, replacement: String, cell: Option<(i32, i32)> },
    AddSheet,
    RenameSheet { name: String },
    DuplicateSheet,
    DeleteSheet,
    MoveSheet { to: u32 },
    HideSheet,
    UnhideSheet { index: u32 },
    SheetColor { color: String },
}

/// What an edit changed besides the cells.
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct EditOutcome {
    /// The sheet to show afterwards, when it changed.
    pub sheet: Option<u32>,
    /// Cells to select afterwards (pasted or filled area).
    pub select: Option<Rect>,
    pub count: Option<usize>,
    /// The internal clipboard was used up by a cut and paste.
    pub clip_used: bool,
}

struct Step {
    id: u64,
    entries: usize,
}

pub struct Document {
    pub id: String,
    pub title: String,
    pub location: String,
    pub path: Option<PathBuf>,
    pub source: Source,
    pub model: UserModel<'static>,
    views: HashMap<u32, View>,
    undo: Vec<Step>,
    redo: Vec<Step>,
    next_step: u64,
    saved_step: u64,
    /// The first save of a session moves the original file to the Trash
    /// instead of overwriting it.
    pub original_in_trash: bool,
    pub notice: Notice,
    /// The Excel file as opened, for the parts IronCalc does not keep.
    original: Option<std::sync::Arc<Vec<u8>>>,
}

fn file_title(path: &Path) -> String {
    path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| "Untitled".into())
}

fn extension(path: &Path) -> String {
    path.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default()
}

fn needs_identity() -> AppError {
    AppError::new("view", "Clear the sort and filter first.")
}

fn write_xlsx(model: &Model, path: &Path, original: Option<&[u8]>) -> AppResult<()> {
    let buffer = ironcalc::export::save_xlsx_to_writer(model, Cursor::new(Vec::new()))
        .map_err(|e| AppError::other(format!("Could not save: {e}")))?;
    let mut bytes = xlsx::for_excel(buffer.into_inner())?;
    if let Some(original) = original {
        bytes = carry::carry_over(original, bytes)?;
    }
    let mut file = BufWriter::new(File::create(path)?);
    file.write_all(&bytes)?;
    file.flush()?;
    Ok(())
}

/// Reads an .xlsx file with IronCalc and calculates it. IronCalc's reader
/// can panic on files it does not expect; that is an error here.
fn load_xlsx(bytes: Vec<u8>, name: &str) -> AppResult<(Model<'static>, Notice)> {
    let facts = xlsx::inspect(&bytes)?;
    let prepared = xlsx::prepare(bytes)?;
    let loaded = std::panic::catch_unwind(AssertUnwindSafe(|| -> AppResult<(Model<'static>, book::Recalc)> {
        let workbook = ironcalc::import::load_from_xlsx_bytes(&prepared, name, "en", book::timezone())
            .map_err(|e| AppError::other(format!("Could not read the workbook: {e}")))?;
        let mut model = Model::from_workbook(workbook, LANGUAGE).map_err(err)?;
        let recalc = book::evaluate_and_compare(&mut model, facts.stored_results);
        Ok((model, recalc))
    }));
    let (model, recalc) = loaded.map_err(|_| AppError::other("Could not read the workbook"))??;
    let notice = Notice {
        unkept: facts.unkept.iter().map(|s| s.to_string()).collect(),
        recalc_changed: recalc.changed,
        recalc_examples: recalc.examples,
    };
    Ok((model, notice))
}

/// Changes the number of decimals in a number format, the way the toolbar's
/// decimal buttons do. `sample` is the active cell's value, for "General".
pub fn adjust_decimals(format: &str, delta: i32, sample: f64) -> String {
    if format.eq_ignore_ascii_case("general") {
        let current = book::plain_number(sample, false).split_once('.').map_or(0, |(_, f)| f.len() as i32);
        let n = (current + delta).max(0) as usize;
        return if n == 0 { "0".into() } else { format!("0.{}", "0".repeat(n)) };
    }
    if is_date_format(format) {
        return format.to_string();
    }
    format.split(';').map(|section| adjust_section(section, delta)).collect::<Vec<_>>().join(";")
}

fn adjust_section(section: &str, delta: i32) -> String {
    let chars: Vec<char> = section.chars().collect();
    let (mut in_quotes, mut last_digit, mut dot) = (false, None, None);
    for (i, &c) in chars.iter().enumerate() {
        match c {
            '"' => in_quotes = !in_quotes,
            _ if in_quotes => {}
            // The exponent of a scientific format has no decimals.
            'E' | 'e' => break,
            '0' | '#' | '?' => last_digit = Some(i),
            '.' if dot.is_none() => dot = Some(i),
            _ => {}
        }
    }
    let Some(last) = last_digit else {
        return section.to_string();
    };
    let tail: String = chars[last + 1..].iter().collect();
    match dot {
        Some(d) if d < last => {
            let n = ((last - d) as i32 + delta).max(0) as usize;
            let head: String = chars[..d].iter().collect();
            let decimals = if n > 0 { format!(".{}", "0".repeat(n)) } else { String::new() };
            format!("{head}{decimals}{tail}")
        }
        _ if delta > 0 => {
            let head: String = chars[..=last].iter().collect();
            format!("{head}.{}{tail}", "0".repeat(delta as usize))
        }
        _ => section.to_string(),
    }
}

pub fn is_date_format(format: &str) -> bool {
    let (mut in_quotes, mut in_brackets) = (false, false);
    format.chars().any(|c| {
        match c {
            '"' => in_quotes = !in_quotes,
            '[' if !in_quotes => in_brackets = true,
            ']' if !in_quotes => in_brackets = false,
            _ => return !in_quotes && !in_brackets && matches!(c.to_ascii_lowercase(), 'd' | 'm' | 'y' | 'h' | 's'),
        }
        false
    })
}

impl Document {
    fn new(model: Model<'static>, title: String, location: String, path: Option<PathBuf>, source: Source) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            title,
            location,
            path,
            source,
            model: UserModel::from_model(model),
            views: HashMap::new(),
            undo: Vec::new(),
            redo: Vec::new(),
            next_step: 0,
            saved_step: 0,
            original_in_trash: false,
            notice: Notice::default(),
            original: None,
        }
    }

    pub fn open_path(path: &Path) -> AppResult<Self> {
        std::panic::catch_unwind(|| Self::open_file(path))
            .unwrap_or_else(|_| Err(AppError::other("Cells could not read this file. It may be damaged.")))
    }

    fn open_file(path: &Path) -> AppResult<Self> {
        let ext = extension(path);
        let mut notice = Notice::default();
        let mut original = None;
        let read_only = |label| -> AppResult<(Model<'static>, Source)> {
            Ok((book::from_values(excel::read_values(path)?)?, Source::SaveAsOnly(label)))
        };
        let (model, source) = match ext.as_str() {
            "csv" | "tsv" | "txt" => {
                let (rows, format) = csv::read(path)?;
                (book::from_csv(&rows, &format, &file_title(path))?, Source::Csv(format))
            }
            "xlsx" | "xlsm" => match load_xlsx(std::fs::read(path)?, &file_title(path)) {
                Ok((model, file_notice)) => {
                    notice = file_notice;
                    original = Some(std::sync::Arc::new(std::fs::read(path)?));
                    // Saving would drop the macros, so it goes through Save As.
                    let source = if ext == "xlsx" { Source::Xlsx } else { Source::SaveAsOnly("Excel with macros") };
                    (model, source)
                }
                // A file IronCalc cannot read still opens, with values only.
                Err(_) => read_only("Excel, values only")?,
            },
            "xls" => read_only("Excel 97-2003")?,
            "xlsb" => read_only("Excel binary")?,
            "ods" => read_only("OpenDocument")?,
            other => {
                return Err(AppError::new("unsupported", format!("Cells cannot open .{other} files")));
            }
        };
        let location = path.to_string_lossy().into_owned();
        let mut doc = Self::new(model, file_title(path), location, Some(path.to_path_buf()), source);
        doc.notice = notice;
        doc.original = original;
        Ok(doc)
    }

    pub fn google(title: String, link: String, bytes: &[u8]) -> AppResult<Self> {
        let (model, notice) = load_xlsx(bytes.to_vec(), &title)?;
        let mut doc = Self::new(model, title, link, None, Source::SaveAsOnly("Google Sheets"));
        doc.notice = notice;
        doc.original = Some(std::sync::Arc::new(bytes.to_vec()));
        Ok(doc)
    }

    pub fn blank(number: usize) -> AppResult<Self> {
        let model = book::empty_model("en")?;
        let title = if number > 1 { format!("Untitled {number}") } else { "Untitled".into() };
        Ok(Self::new(model, title, String::new(), None, Source::New))
    }

    fn workbook_model(&self) -> &Model<'_> {
        self.model.get_model()
    }

    pub fn info(&self) -> DocInfo {
        let kind = match &self.source {
            Source::Csv(format) => format.label(),
            Source::Xlsx => "Excel".into(),
            Source::SaveAsOnly(label) => (*label).into(),
            Source::New => "New".into(),
        };
        let sheets = self
            .model
            .get_worksheets_properties()
            .into_iter()
            .map(|p| SheetInfo {
                name: p.name,
                hidden: p.state != "visible",
                color: Some(self.model.resolve_color(&p.color)).filter(|c| !c.is_empty()),
            })
            .collect();
        DocInfo {
            id: self.id.clone(),
            title: self.title.clone(),
            location: self.location.clone(),
            kind,
            can_save: matches!(self.source, Source::Csv(_) | Source::Xlsx),
            single_sheet: matches!(self.source, Source::Csv(_)),
            dirty: self.top_step() != self.saved_step,
            can_undo: !self.undo.is_empty(),
            can_redo: !self.redo.is_empty(),
            sheets,
            notice: self.notice.clone(),
        }
    }

    // ---- Undo history ----

    fn top_step(&self) -> u64 {
        self.undo.last().map_or(0, |s| s.id)
    }

    /// Records `entries` IronCalc history entries as one undo step.
    fn record(&mut self, entries: usize) {
        // IronCalc keeps every change for syncing other copies; Cells has none.
        let _ = self.model.flush_send_queue();
        if entries == 0 {
            return;
        }
        self.next_step += 1;
        self.undo.push(Step { id: self.next_step, entries });
        self.redo.clear();
    }

    /// Runs one model call as an undo step.
    fn change(&mut self, f: impl FnOnce(&mut UserModel<'static>) -> Result<(), String>) -> AppResult<()> {
        let result = f(&mut self.model);
        self.record(usize::from(result.is_ok()));
        result.map_err(err)
    }

    /// Runs several model calls as one undo step and recalculates once.
    /// The closure counts the calls that went through.
    fn change_many(
        &mut self,
        f: impl FnOnce(&mut UserModel<'static>, &mut usize) -> Result<(), String>,
    ) -> AppResult<()> {
        let mut entries = 0;
        self.model.pause_evaluation();
        let result = f(&mut self.model, &mut entries);
        self.model.resume_evaluation();
        self.model.evaluate();
        self.record(entries);
        result.map_err(err)
    }

    fn replay(&mut self, undo: bool) -> AppResult<()> {
        let Some(step) = (if undo { self.undo.pop() } else { self.redo.pop() }) else {
            return Ok(());
        };
        self.model.pause_evaluation();
        let mut result = Ok(());
        for _ in 0..step.entries {
            result = if undo { self.model.undo() } else { self.model.redo() };
            if result.is_err() {
                break;
            }
        }
        self.model.resume_evaluation();
        self.model.evaluate();
        let _ = self.model.flush_send_queue();
        if undo {
            self.redo.push(step);
        } else {
            self.undo.push(step);
        }
        self.rebuild_views();
        result.map_err(err)
    }

    pub fn undo(&mut self) -> AppResult<()> {
        self.replay(true)
    }

    pub fn redo(&mut self) -> AppResult<()> {
        self.replay(false)
    }

    // ---- Views ----

    fn sheet_id(&self, sheet: u32) -> AppResult<u32> {
        Ok(self.workbook_model().workbook.worksheet(sheet).map_err(err)?.sheet_id)
    }

    fn frozen(&self, sheet: u32) -> i32 {
        self.model.get_frozen_rows_count(sheet).unwrap_or(0)
    }

    fn view(&self, sheet: u32) -> Option<&View> {
        self.views.get(&self.sheet_id(sheet).ok()?)
    }

    fn row_at(&self, sheet: u32, pos: i32) -> i32 {
        match self.view(sheet) {
            Some(view) => view.row_at(self.frozen(sheet), pos),
            None => pos + 1,
        }
    }

    fn is_identity(&self, sheet: u32) -> bool {
        self.view(sheet).is_none_or(|v| v.rows.is_none())
    }

    fn require_identity(&self, sheet: u32) -> AppResult<()> {
        if self.is_identity(sheet) {
            Ok(())
        } else {
            Err(needs_identity())
        }
    }

    fn rebuild_views(&mut self) {
        let model = self.model.get_model();
        let count = model.workbook.worksheets.len() as u32;
        for sheet in 0..count {
            let id = model.workbook.worksheets[sheet as usize].sheet_id;
            if let Some(view) = self.views.get_mut(&id) {
                let frozen = self.model.get_frozen_rows_count(sheet).unwrap_or(0);
                let _ = view.rebuild(model, sheet, frozen);
            }
        }
    }

    pub fn set_view(
        &mut self,
        sheet: u32,
        sort: Vec<SortKey>,
        filter: String,
        values: Vec<(i32, Vec<String>)>,
    ) -> AppResult<()> {
        let id = self.sheet_id(sheet)?;
        let frozen = self.frozen(sheet);
        // The frontend counts columns from 0.
        let mut view = View {
            sort: sort.into_iter().map(|k| SortKey { col: k.col + 1, desc: k.desc }).collect(),
            filter,
            values: values.into_iter().map(|(col, v)| (col + 1, v.into_iter().collect::<BTreeSet<_>>())).collect(),
            ..View::default()
        };
        view.rebuild(self.model.get_model(), sheet, frozen)?;
        if view.is_active() {
            self.views.insert(id, view);
        } else {
            self.views.remove(&id);
        }
        Ok(())
    }

    pub fn column_values(&self, sheet: u32, col: i32) -> AppResult<Vec<(String, usize)>> {
        view::column_values(self.workbook_model(), sheet, col + 1, self.frozen(sheet))
    }

    /// Consecutive sheet rows of a range of display positions, as (first row, count).
    fn row_runs(&self, sheet: u32, r0: i32, r1: i32) -> Vec<(i32, i32)> {
        if self.is_identity(sheet) {
            return vec![(r0 + 1, r1 - r0 + 1)];
        }
        let mut runs: Vec<(i32, i32)> = Vec::new();
        for pos in r0..=r1 {
            let row = self.row_at(sheet, pos);
            match runs.last_mut() {
                Some((start, count)) if *start + *count == row => *count += 1,
                _ => runs.push((row, 1)),
            }
        }
        runs
    }

    fn areas(&self, sheet: u32, rect: Rect) -> Vec<Area> {
        self.row_runs(sheet, rect.r0, rect.r1)
            .into_iter()
            .map(|(row, height)| Area { sheet, row, column: rect.c0 + 1, width: rect.width(), height })
            .collect()
    }

    // ---- Reading ----

    pub fn layout(&self, sheet: u32) -> AppResult<Layout> {
        let model = self.workbook_model();
        let ws = model.workbook.worksheet(sheet).map_err(err)?;
        let (data_rows, data_cols) = if ws.sheet_data.is_empty() {
            (0, 0)
        } else {
            let d = ws.dimension();
            (d.max_row, d.max_column)
        };
        let frozen_rows = self.frozen(sheet);
        let frozen_cols = self.model.get_frozen_columns_count(sheet).unwrap_or(0);
        let view = self.view(sheet);
        let merges_identity = view.is_none_or(|v| v.rows.is_none());
        let mut far_row = data_rows.max(frozen_rows);
        let mut far_col = data_cols.max(frozen_cols);
        let mut merges = Vec::new();
        if merges_identity {
            for m in &ws.merged_cells {
                merges.push([m.row - 1, m.column - 1, m.height, m.width]);
                far_row = far_row.max(m.row + m.height - 1);
                far_col = far_col.max(m.column + m.width - 1);
            }
        }
        let rows = match view.and_then(|v| v.rows.as_ref()) {
            Some(shown) => frozen_rows + shown.len() as i32 + 50,
            None => (far_row + 100).max(200).min(LAST_ROW),
        };
        let cols = (far_col + 10).max(26).min(LAST_COL);
        let col_widths = (1..=cols).map(|c| ws.get_column_width(c).unwrap_or(90.0)).collect();
        let default_row = 25.0;
        let positions = view.and_then(|v| v.positions(frozen_rows));
        let mut row_heights = Vec::new();
        for r in &ws.rows {
            let height = r.height * ironcalc_base::ROW_HEIGHT_FACTOR;
            let size = if r.hidden {
                0.0
            } else if r.custom_height || height > default_row + 1.0 {
                height.round()
            } else {
                continue;
            };
            let pos = match &positions {
                Some(map) if r.r > frozen_rows => match map.get(&r.r) {
                    Some(&pos) => pos,
                    None => continue,
                },
                _ => r.r - 1,
            };
            if pos < rows {
                row_heights.push((pos, size));
            }
        }
        let base_size = model.get_style_for_cell(sheet, LAST_ROW, LAST_COL).map(|s| s.font.sz).unwrap_or(12);
        Ok(Layout {
            rows,
            cols,
            data_rows,
            data_cols,
            frozen_rows,
            frozen_cols,
            col_widths,
            row_heights,
            default_row,
            merges,
            sort: view.map(|v| v.sort.iter().map(|k| SortKey { col: k.col - 1, desc: k.desc }).collect()).unwrap_or_default(),
            filter: view.map(|v| v.filter.clone()).unwrap_or_default(),
            value_filters: view
                .map(|v| v.values.iter().map(|(c, shown)| (c - 1, shown.iter().cloned().collect())).collect())
                .unwrap_or_default(),
            shown: view.and_then(|v| v.rows.as_ref()).map(|r| r.len() as i32),
            grid_lines: self.model.get_show_grid_lines(sheet).unwrap_or(true),
            base_size,
        })
    }

    /// Cells of `count` display rows from `start`, for columns 0..`cols`.
    pub fn cells(&self, sheet: u32, start: i32, count: i32, cols: i32) -> AppResult<CellsOut> {
        let model = self.workbook_model();
        let ws = model.workbook.worksheet(sheet).map_err(err)?;
        let has_col_styles = ws.cols.iter().any(|c| c.style.is_some());
        let mut styles: HashMap<i32, StyleDto> = HashMap::new();
        let mut rows = Vec::new();
        for pos in start..start + count {
            let row = self.row_at(sheet, pos);
            let row_styled = ws.rows.iter().any(|r| r.r == row && r.custom_format);
            let data = ws.sheet_data.columns_in_row(row);
            if data.is_empty() && !row_styled && !has_col_styles {
                continue;
            }
            let mut cells: Vec<Option<CellOut>> = Vec::new();
            // Rows and columns with their own style need every column; other
            // rows only the cells they have.
            let columns: Vec<i32> = if row_styled || has_col_styles {
                (1..=cols).collect()
            } else {
                data.iter().copied().filter(|&c| c <= cols).collect()
            };
            for col in columns {
                let in_data = data.binary_search(&col).is_ok();
                let style = model.get_cell_style_index(sheet, row, col).unwrap_or(0);
                let text = if in_data { model.get_formatted_cell_value(sheet, row, col).unwrap_or_default() } else { String::new() };
                if text.is_empty() && style == 0 {
                    continue;
                }
                if let std::collections::hash_map::Entry::Vacant(e) = styles.entry(style) {
                    let s = model.get_style_for_cell(sheet, row, col).map_err(err)?;
                    e.insert(render::style_dto(&self.model, &s));
                }
                let kind = render::kind(&self.model, sheet, row, col, &text);
                let index = (col - 1) as usize;
                if cells.len() <= index {
                    cells.resize(index + 1, None);
                }
                cells[index] = Some((text, style, kind));
            }
            if !cells.is_empty() {
                rows.push(RowOut { pos, cells });
            }
        }
        let labels = (!self.is_identity(sheet)).then(|| (start..start + count).map(|pos| self.row_at(sheet, pos)).collect());
        Ok(CellsOut { rows, styles, labels })
    }

    pub fn cell(&self, sheet: u32, pos: i32, col: i32) -> AppResult<CellInfo> {
        let row = self.row_at(sheet, pos);
        let col = col + 1;
        let style = self.model.get_cell_style(sheet, row, col).map_err(err)?;
        let merged = self.workbook_model().workbook.worksheet(sheet).map_err(err)?.merged_cells.iter().any(|m| {
            row >= m.row && row < m.row + m.height && col >= m.column && col < m.column + m.width
        });
        Ok(CellInfo {
            content: self.model.get_cell_content(sheet, row, col).map_err(err)?,
            style: render::style_dto(&self.model, &style),
            merged,
            row,
        })
    }

    pub fn stats(&self, sheet: u32, rect: Rect) -> AppResult<Stats> {
        let model = self.workbook_model();
        let ws = model.workbook.worksheet(sheet).map_err(err)?;
        let mut stats = Stats { cells: rect.width() as i64 * rect.height() as i64, ..Stats::default() };
        if ws.sheet_data.is_empty() {
            return Ok(stats);
        }
        let d = ws.dimension();
        let last_pos = match self.view(sheet).and_then(|v| v.rows.as_ref()) {
            Some(rows) => self.frozen(sheet) + rows.len() as i32 - 1,
            None => d.max_row - 1,
        };
        for pos in rect.r0..=rect.r1.min(last_pos) {
            let row = self.row_at(sheet, pos);
            for col in ws.sheet_data.columns_in_row(row) {
                if col <= rect.c0 || col > rect.c1 + 1 {
                    continue;
                }
                match model.get_cell_value_by_index(sheet, row, col) {
                    Ok(CellValue::Number(n)) => {
                        stats.filled += 1;
                        stats.numbers += 1;
                        stats.sum += n;
                        stats.min = Some(stats.min.map_or(n, |m| m.min(n)));
                        stats.max = Some(stats.max.map_or(n, |m| m.max(n)));
                    }
                    Ok(CellValue::None) => {}
                    Ok(CellValue::String(s)) if s.is_empty() => {}
                    Ok(_) => stats.filled += 1,
                    Err(_) => {}
                }
            }
        }
        Ok(stats)
    }

    /// Cells whose shown text matches, in display order, as (position, column).
    pub fn find(&self, sheet: u32, find: &FindOptions) -> AppResult<Vec<(i32, i32)>> {
        let model = self.workbook_model();
        let ws = model.workbook.worksheet(sheet).map_err(err)?;
        if find.query.is_empty() || ws.sheet_data.is_empty() {
            return Ok(Vec::new());
        }
        let d = ws.dimension();
        let positions = match self.view(sheet).and_then(|v| v.rows.as_ref()) {
            Some(rows) => self.frozen(sheet) + rows.len() as i32,
            None => d.max_row,
        };
        let needle = if find.match_case { find.query.clone() } else { find.query.to_lowercase() };
        let mut found = Vec::new();
        for pos in 0..positions {
            let row = self.row_at(sheet, pos);
            for col in ws.sheet_data.columns_in_row(row) {
                let text = view::shown_text(model, sheet, row, col);
                let text = if find.match_case { text } else { text.to_lowercase() };
                let hit = if find.whole_cell { text == needle } else { text.contains(&needle) };
                if hit && !text.is_empty() {
                    found.push((pos, col - 1));
                    if found.len() >= 10_000 {
                        return Ok(found);
                    }
                }
            }
        }
        Ok(found)
    }

    /// Copies cells as tab separated text (what other apps paste) and, when
    /// the view is not sorted or filtered, with formulas and formatting.
    pub fn copy(&mut self, sheet: u32, rect: Rect, cut: bool) -> AppResult<(String, Option<Clip>)> {
        if !self.is_identity(sheet) {
            let model = self.workbook_model();
            let mut lines = Vec::new();
            for pos in rect.r0..=rect.r1 {
                let row = self.row_at(sheet, pos);
                let fields: Vec<String> =
                    (rect.c0 + 1..=rect.c1 + 1).map(|col| view::shown_text(model, sheet, row, col)).collect();
                lines.push(fields);
            }
            let mut writer = ::csv::WriterBuilder::new().delimiter(b'\t').from_writer(Vec::new());
            for line in lines {
                writer.write_record(line).map_err(err)?;
            }
            let text = String::from_utf8(writer.into_inner().map_err(err)?).map_err(err)?;
            return Ok((text.trim_end().to_string(), None));
        }
        self.model.set_selected_sheet(sheet).map_err(err)?;
        self.model.set_selected_cell(rect.r0 + 1, rect.c0 + 1).map_err(err)?;
        self.model.set_selected_range(rect.r0 + 1, rect.c0 + 1, rect.r1 + 1, rect.c1 + 1).map_err(err)?;
        let copied = self.model.copy_to_clipboard().map_err(err)?;
        let copied: CopiedCells = serde_json::from_value(serde_json::to_value(&copied).map_err(err)?).map_err(err)?;
        let clip = Clip {
            doc: self.id.clone(),
            text: copied.csv.clone(),
            cut,
            sheet: copied.sheet,
            range: copied.range,
            data: copied.data,
        };
        Ok((copied.csv, Some(clip)))
    }

    // ---- Editing ----

    pub fn edit(&mut self, sheet: u32, edit: Edit, clip: Option<&Clip>) -> AppResult<EditOutcome> {
        let mut outcome = EditOutcome::default();
        match edit {
            Edit::Input { pos, col, value } => {
                let frozen = self.frozen(sheet);
                let id = self.sheet_id(sheet)?;
                let row = match self.views.get_mut(&id) {
                    Some(view) => view.claim_row(frozen, pos),
                    None => pos + 1,
                };
                self.change(|m| m.set_user_input(sheet, row, col + 1, &value))?;
            }
            Edit::Clear { rect, what } => {
                let areas = self.areas(sheet, rect);
                self.change_many(|m, n| {
                    for area in &areas {
                        match what.as_str() {
                            "formatting" => m.range_clear_formatting(area)?,
                            "all" => m.range_clear_all(area)?,
                            _ => m.range_clear_contents(area)?,
                        }
                        *n += 1;
                    }
                    Ok(())
                })?;
            }
            Edit::Style { rect, path, value } => {
                let areas = self.areas(sheet, rect);
                self.change_many(|m, n| {
                    for area in &areas {
                        m.update_range_style(area, &path, &value)?;
                        *n += 1;
                    }
                    Ok(())
                })?;
            }
            Edit::Decimals { rect, pos, col, delta } => {
                let row = self.row_at(sheet, pos);
                let format = self.model.get_cell_style(sheet, row, col + 1).map_err(err)?.num_fmt;
                let sample = match self.workbook_model().get_cell_value_by_index(sheet, row, col + 1) {
                    Ok(CellValue::Number(n)) => n,
                    _ => 0.0,
                };
                let format = adjust_decimals(&format, delta, sample);
                return self.edit(sheet, Edit::Style { rect, path: "num_fmt".into(), value: format }, clip);
            }
            Edit::Border { rect, kind, style, color } => {
                let border: BorderArea = serde_json::from_value(serde_json::json!({
                    "item": { "style": style, "color": if color.is_empty() { serde_json::Value::Null } else { color.into() } },
                    "type": kind,
                }))
                .map_err(|e| AppError::other(format!("Unknown border: {e}")))?;
                let areas = self.areas(sheet, rect);
                self.change_many(|m, n| {
                    for area in &areas {
                        m.set_area_with_border(area, &border)?;
                        *n += 1;
                    }
                    Ok(())
                })?;
            }
            Edit::Merge { rect } => {
                self.require_identity(sheet)?;
                let area = self.areas(sheet, rect).remove(0);
                self.change(|m| m.merge_cells(&area))?;
            }
            Edit::Unmerge { rect } => {
                self.require_identity(sheet)?;
                let area = self.areas(sheet, rect).remove(0);
                self.change(|m| m.unmerge_cells(&area))?;
            }
            Edit::InsertRows { pos, count } => {
                self.require_identity(sheet)?;
                self.change(|m| m.insert_rows(sheet, pos + 1, count))?;
            }
            Edit::DeleteRows { pos, count } => {
                self.require_identity(sheet)?;
                self.change(|m| m.delete_rows(sheet, pos + 1, count))?;
            }
            Edit::MoveRows { pos, count, delta } => {
                self.require_identity(sheet)?;
                if pos + delta < 0 {
                    return Ok(outcome);
                }
                self.change(|m| m.move_rows_action(sheet, pos + 1, count, delta))?;
                outcome.select = Some(Rect { r0: pos + delta, c0: 0, r1: pos + delta + count - 1, c1: 0 });
            }
            Edit::HideRows { pos, count, hidden } => {
                let runs = self.row_runs(sheet, pos, pos + count - 1);
                self.change_many(|m, n| {
                    for (row, height) in &runs {
                        m.set_rows_hidden(sheet, *row, row + height - 1, hidden)?;
                        *n += 1;
                    }
                    Ok(())
                })?;
            }
            Edit::RowHeight { pos, count, height } => {
                let runs = self.row_runs(sheet, pos, pos + count - 1);
                self.change_many(|m, n| {
                    for (row, rows) in &runs {
                        m.set_rows_height(sheet, *row, row + rows - 1, height)?;
                        *n += 1;
                    }
                    Ok(())
                })?;
            }
            Edit::InsertCols { col, count } => {
                self.change(|m| m.insert_columns(sheet, col + 1, count))?;
                self.reset_view(sheet)?;
            }
            Edit::DeleteCols { col, count } => {
                self.change(|m| m.delete_columns(sheet, col + 1, count))?;
                self.reset_view(sheet)?;
            }
            Edit::MoveCols { col, count, delta } => {
                if col + delta < 0 {
                    return Ok(outcome);
                }
                self.change(|m| m.move_columns_action(sheet, col + 1, count, delta))?;
                self.reset_view(sheet)?;
                outcome.select = Some(Rect { r0: 0, c0: col + delta, r1: 0, c1: col + delta + count - 1 });
            }
            Edit::HideCols { col, count, hidden } => {
                self.change(|m| m.set_columns_hidden(sheet, col + 1, col + count, hidden))?;
            }
            Edit::ColWidth { col, count, width } => {
                self.change(|m| m.set_columns_width(sheet, col + 1, col + count, width.clamp(8.0, 2000.0)))?;
            }
            Edit::Freeze { rows, cols } => {
                let (old_rows, old_cols) = (self.frozen(sheet), self.model.get_frozen_columns_count(sheet).unwrap_or(0));
                self.change_many(|m, n| {
                    if rows != old_rows {
                        m.set_frozen_rows_count(sheet, rows)?;
                        *n += 1;
                    }
                    if cols != old_cols {
                        m.set_frozen_columns_count(sheet, cols)?;
                        *n += 1;
                    }
                    Ok(())
                })?;
                self.rebuild_views();
            }
            Edit::Autofill { rect, to, rows } => {
                self.require_identity(sheet)?;
                let area = self.areas(sheet, rect).remove(0);
                if rows {
                    self.change(|m| m.auto_fill_rows(&area, to + 1))?;
                    outcome.select = Some(Rect { r0: rect.r0.min(to), r1: rect.r1.max(to), ..rect });
                } else {
                    self.change(|m| m.auto_fill_columns(&area, to + 1))?;
                    outcome.select = Some(Rect { c0: rect.c0.min(to), c1: rect.c1.max(to), ..rect });
                }
            }
            Edit::FillDown { rect } => {
                self.require_identity(sheet)?;
                if rect.r1 > rect.r0 {
                    let area = Area { sheet, row: rect.r0 + 1, column: rect.c0 + 1, width: rect.width(), height: 1 };
                    self.change(|m| m.auto_fill_rows(&area, rect.r1 + 1))?;
                }
            }
            Edit::FillRight { rect } => {
                self.require_identity(sheet)?;
                if rect.c1 > rect.c0 {
                    let area = Area { sheet, row: rect.r0 + 1, column: rect.c0 + 1, width: 1, height: rect.height() };
                    self.change(|m| m.auto_fill_columns(&area, rect.c1 + 1))?;
                }
            }
            Edit::Paste { rect, text } => return self.paste(sheet, rect, &text, clip),
            Edit::Replace { find, replacement, cell } => {
                let targets = match cell {
                    Some(cell) => vec![cell],
                    None => self.find(sheet, &find)?,
                };
                let mut writes = Vec::new();
                for (pos, col) in targets {
                    let row = self.row_at(sheet, pos);
                    let shown = view::shown_text(self.workbook_model(), sheet, row, col + 1);
                    // Formulas are left alone; their result is not what was typed.
                    let content = self.model.get_cell_content(sheet, row, col + 1).map_err(err)?;
                    if content.starts_with('=') {
                        continue;
                    }
                    let replaced = replace_text(&shown, &find, &replacement);
                    if replaced != shown {
                        writes.push((row, col + 1, replaced));
                    }
                }
                outcome.count = Some(writes.len());
                self.change_many(|m, n| {
                    for (row, col, value) in &writes {
                        m.set_user_input(sheet, *row, *col, value)?;
                        *n += 1;
                    }
                    Ok(())
                })?;
            }
            Edit::AddSheet => {
                self.change(|m| m.new_sheet())?;
                outcome.sheet = Some(self.model.get_selected_sheet());
            }
            Edit::RenameSheet { name } => {
                let name = book::sheet_name(&name);
                self.change(|m| m.rename_sheet(sheet, &name))?;
            }
            Edit::DuplicateSheet => {
                self.change(|m| m.duplicate_sheet(sheet))?;
                outcome.sheet = Some(self.model.get_selected_sheet());
            }
            Edit::DeleteSheet => {
                let visible = self.info().sheets.iter().filter(|s| !s.hidden).count();
                if visible <= 1 {
                    return Err(AppError::other("A spreadsheet needs at least one visible sheet."));
                }
                self.change(|m| m.delete_sheet(sheet))?;
                outcome.sheet = Some(self.visible_sheet_near(sheet));
            }
            Edit::MoveSheet { to } => {
                self.change(|m| m.move_sheet(sheet, to))?;
                outcome.sheet = Some(to);
            }
            Edit::HideSheet => {
                let visible = self.info().sheets.iter().filter(|s| !s.hidden).count();
                if visible <= 1 {
                    return Err(AppError::other("A spreadsheet needs at least one visible sheet."));
                }
                self.change(|m| m.hide_sheet(sheet))?;
                outcome.sheet = Some(self.visible_sheet_near(sheet));
            }
            Edit::UnhideSheet { index } => {
                self.change(|m| m.unhide_sheet(index))?;
                outcome.sheet = Some(index);
            }
            Edit::SheetColor { color } => {
                let color = Color::from_param(&color).map_err(err)?;
                self.change(|m| m.set_sheet_color(sheet, &color))?;
            }
        }
        // Edits keep sorted rows where they are; the view is only redone on request.
        Ok(outcome)
    }

    fn reset_view(&mut self, sheet: u32) -> AppResult<()> {
        let id = self.sheet_id(sheet)?;
        self.views.remove(&id);
        Ok(())
    }

    fn visible_sheet_near(&self, sheet: u32) -> u32 {
        let sheets = self.info().sheets;
        let visible: Vec<u32> = (0..sheets.len() as u32).filter(|&i| !sheets[i as usize].hidden).collect();
        visible.iter().copied().find(|&i| i >= sheet).or(visible.last().copied()).unwrap_or(0)
    }

    fn paste(&mut self, sheet: u32, rect: Rect, text: &str, clip: Option<&Clip>) -> AppResult<EditOutcome> {
        let mut outcome = EditOutcome::default();
        let normalized = text.replace("\r\n", "\n");
        let own = clip.filter(|c| c.doc == self.id && c.text == normalized.trim_end() && self.is_identity(sheet));
        if let Some(clip) = own {
            self.model.set_selected_sheet(sheet).map_err(err)?;
            self.model.set_selected_cell(rect.r0 + 1, rect.c0 + 1).map_err(err)?;
            let (r0, c0, r1, c1) = clip.range;
            self.change(|m| m.paste_from_clipboard(clip.sheet, clip.range, &clip.data, clip.cut))?;
            outcome.select = Some(Rect { r0: rect.r0, c0: rect.c0, r1: rect.r0 + r1 - r0, c1: rect.c0 + c1 - c0 });
            outcome.clip_used = clip.cut;
            return Ok(outcome);
        }

        let mut reader =
            ::csv::ReaderBuilder::new().delimiter(b'\t').has_headers(false).flexible(true).from_reader(normalized.as_bytes());
        let mut records: Vec<Vec<String>> = Vec::new();
        for record in reader.records() {
            records.push(record.map_err(err)?.iter().map(str::to_string).collect());
        }
        if records.is_empty() {
            return Ok(outcome);
        }
        // One value pasted on a selection fills it.
        if records.len() == 1 && records[0].len() == 1 && (rect.width() > 1 || rect.height() > 1) {
            let value = records[0][0].clone();
            records = vec![vec![value; rect.width() as usize]; rect.height() as usize];
        }
        let height = records.len() as i32;
        let width = records.iter().map(Vec::len).max().unwrap_or(1) as i32;
        let line = |fields: &[String]| -> AppResult<String> {
            let mut writer = ::csv::WriterBuilder::new().delimiter(b'\t').from_writer(Vec::new());
            writer.write_record(fields).map_err(err)?;
            String::from_utf8(writer.into_inner().map_err(err)?).map_err(err)
        };
        let frozen = self.frozen(sheet);
        let id = self.sheet_id(sheet)?;
        let mut writes = Vec::new();
        if self.is_identity(sheet) {
            let all: Vec<String> = records.iter().map(|r| line(r)).collect::<AppResult<_>>()?;
            writes.push((Area { sheet, row: rect.r0 + 1, column: rect.c0 + 1, width, height }, all.concat()));
        } else {
            for (i, record) in records.iter().enumerate() {
                let row = self.views.get_mut(&id).map_or(rect.r0 + i as i32 + 1, |v| v.claim_row(frozen, rect.r0 + i as i32));
                writes.push((Area { sheet, row, column: rect.c0 + 1, width, height: 1 }, line(record)?));
            }
        }
        self.change_many(|m, n| {
            m.set_selected_sheet(sheet)?;
            for (area, text) in &writes {
                // IronCalc selects what it pasted, starting from the selected cell.
                m.set_selected_cell(area.row, area.column)?;
                m.paste_csv_string(area, text)?;
                *n += 1;
            }
            Ok(())
        })?;
        outcome.select = Some(Rect { r0: rect.r0, c0: rect.c0, r1: rect.r0 + height - 1, c1: rect.c0 + width - 1 });
        Ok(outcome)
    }

    // ---- Saving ----

    fn decimal_comma(&self) -> bool {
        match &self.source {
            Source::Csv(format) => format.decimal_comma,
            _ => self.model.get_locale() != "en",
        }
    }

    pub fn save(&mut self) -> AppResult<()> {
        let path = self.path.clone().ok_or_else(|| AppError::new("save_as", "Use Save As to save this spreadsheet"))?;
        let keep_original = !self.original_in_trash;
        match &self.source {
            Source::Csv(format) => {
                let format = *format;
                let rows = book::csv_rows(self.workbook_model(), 0, &format)?;
                replace_file(&path, keep_original, |tmp| csv::write(tmp, &rows, &format))?;
            }
            Source::Xlsx => replace_file(&path, keep_original, |tmp| write_xlsx(self.workbook_model(), tmp, self.original.as_deref().map(Vec::as_slice)))?,
            Source::SaveAsOnly(label) => {
                return Err(AppError::new("save_as", format!("{label} files cannot be saved in place. Use Save As.")));
            }
            Source::New => return Err(AppError::new("save_as", "Use Save As to save this spreadsheet")),
        }
        self.original_in_trash = true;
        self.saved_step = self.top_step();
        self.notice = Notice::default();
        Ok(())
    }

    /// Saves to a new file. `.xlsx` keeps every sheet with formulas and
    /// formatting. `.csv` and `.tsv` hold the values of one sheet; the
    /// document then shows that file as it is on disk.
    pub fn save_as(&mut self, target: &Path, sheet: u32) -> AppResult<()> {
        match extension(target).as_str() {
            ext @ ("csv" | "tsv") => {
                let mut format = match &self.source {
                    Source::Csv(format) => *format,
                    _ => CsvFormat { decimal_comma: self.decimal_comma(), ..CsvFormat::default() },
                };
                if ext == "tsv" {
                    format.delimiter = b'\t';
                } else if format.delimiter == b'\t' || (format.decimal_comma && format.delimiter == b',') {
                    format.delimiter = if format.decimal_comma { b';' } else { b',' };
                }
                let rows = book::csv_rows(self.workbook_model(), sheet, &format)?;
                replace_file(target, true, |tmp| csv::write(tmp, &rows, &format))?;
                let id = std::mem::take(&mut self.id);
                *self = Document::open_path(target)?;
                self.id = id;
            }
            "xlsx" => {
                replace_file(target, true, |tmp| write_xlsx(self.workbook_model(), tmp, self.original.as_deref().map(Vec::as_slice)))?;
                self.source = Source::Xlsx;
                self.saved_step = self.top_step();
                self.notice = Notice::default();
            }
            other => return Err(AppError::other(format!("Cells can save as .xlsx, .csv or .tsv, not .{other}"))),
        }
        self.path = Some(target.to_path_buf());
        self.location = target.to_string_lossy().into_owned();
        self.title = file_title(target);
        self.original_in_trash = true;
        Ok(())
    }
}

/// Replaces every match of the search in `text`, ignoring case unless asked.
fn replace_text(text: &str, find: &FindOptions, replacement: &str) -> String {
    if find.whole_cell {
        let same = if find.match_case { text == find.query } else { text.to_lowercase() == find.query.to_lowercase() };
        return if same { replacement.to_string() } else { text.to_string() };
    }
    if find.match_case {
        return text.replace(&find.query, replacement);
    }
    let lower = text.to_lowercase();
    let needle = find.query.to_lowercase();
    // Lowercasing can change byte lengths; fall back to an exact replace then.
    if lower.len() != text.len() || needle.len() != find.query.len() {
        return text.replace(&find.query, replacement);
    }
    let mut out = String::new();
    let mut last = 0;
    for (i, _) in lower.match_indices(&needle) {
        out.push_str(&text[last..i]);
        out.push_str(replacement);
        last = i + needle.len();
    }
    out.push_str(&text[last..]);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(r0: i32, c0: i32, r1: i32, c1: i32) -> Rect {
        Rect { r0, c0, r1, c1 }
    }

    fn input(doc: &mut Document, pos: i32, col: i32, value: &str) {
        doc.edit(0, Edit::Input { pos, col, value: value.into() }, None).unwrap();
    }

    fn shown(doc: &Document, row: i32, col: i32) -> String {
        doc.model.get_formatted_cell_value(0, row, col).unwrap()
    }

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("cells-doc-{name}-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn decimals() {
        assert_eq!(adjust_decimals("general", 1, 1.5), "0.00");
        assert_eq!(adjust_decimals("general", -1, 1.5), "0");
        assert_eq!(adjust_decimals("0.00", -1, 0.0), "0.0");
        assert_eq!(adjust_decimals("0.0", -1, 0.0), "0");
        assert_eq!(adjust_decimals("#,##0%", 1, 0.0), "#,##0.0%");
        assert_eq!(adjust_decimals("#,##0.00 \"kr\"", 1, 0.0), "#,##0.000 \"kr\"");
        assert_eq!(adjust_decimals("0.00E+00", 1, 0.0), "0.000E+00");
        assert_eq!(adjust_decimals("yyyy-mm-dd", 1, 0.0), "yyyy-mm-dd");
        assert!(!is_date_format("[Red]#,##0"));
    }

    #[test]
    fn formulas_styles_undo_and_xlsx_round_trip() {
        let mut doc = Document::blank(1).unwrap();
        input(&mut doc, 0, 0, "2");
        input(&mut doc, 1, 0, "3");
        input(&mut doc, 2, 0, "=SUM(A1:A2)*2");
        assert_eq!(shown(&doc, 3, 1), "10");
        assert!(doc.info().dirty);

        doc.edit(0, Edit::Style { rect: rect(0, 0, 1, 0), path: "font.b".into(), value: "true".into() }, None).unwrap();
        doc.edit(0, Edit::Decimals { rect: rect(2, 0, 2, 0), pos: 2, col: 0, delta: 2 }, None).unwrap();
        assert_eq!(shown(&doc, 3, 1), "10.00");
        doc.edit(0, Edit::InsertRows { pos: 0, count: 1 }, None).unwrap();
        assert_eq!(doc.model.get_cell_content(0, 4, 1).unwrap(), "=SUM(A2:A3)*2", "references move");

        doc.undo().unwrap();
        assert_eq!(doc.model.get_cell_content(0, 3, 1).unwrap(), "=SUM(A1:A2)*2");
        doc.redo().unwrap();
        doc.undo().unwrap();

        // Replace across cells is one undo step.
        let find = FindOptions { query: "2".into(), match_case: false, whole_cell: true };
        let out = doc.edit(0, Edit::Replace { find, replacement: "5".into(), cell: None }, None).unwrap();
        assert_eq!(out.count, Some(1));
        assert_eq!(shown(&doc, 3, 1), "16.00");
        doc.undo().unwrap();
        assert_eq!(shown(&doc, 3, 1), "10.00");

        let dir = temp_dir("xlsx");
        let path = dir.join("book.xlsx");
        let _ = std::fs::remove_file(&path);
        doc.save_as(&path, 0).unwrap();
        assert!(!doc.info().dirty);
        let again = Document::open_path(&path).unwrap();
        assert_eq!(again.model.get_cell_content(0, 3, 1).unwrap(), "=SUM(A1:A2)*2");
        assert!(again.model.get_cell_style(0, 1, 1).unwrap().font.b);
        assert_eq!(again.model.get_formatted_cell_value(0, 3, 1).unwrap(), "10.00");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn csv_edit_and_save_in_place() {
        let dir = temp_dir("csv");
        let path = dir.join("list.csv");
        std::fs::write(&path, "a;b\n1,5;2\n").unwrap();
        let mut doc = Document::open_path(&path).unwrap();
        // Overwrite in place: a test should not put files in the real Trash.
        doc.original_in_trash = true;
        assert_eq!(doc.info().kind, "CSV, semicolon, UTF-8");
        assert_eq!(shown(&doc, 2, 1), "1,5");
        input(&mut doc, 1, 1, "=A2*2");
        assert_eq!(shown(&doc, 2, 2), "3");
        doc.save().unwrap();
        assert!(!doc.info().dirty);
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "a;b\n1,5;3\n");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn sorted_view_edits_and_paste() {
        let mut doc = Document::blank(1).unwrap();
        for (i, v) in ["name", "b", "c", "a"].iter().enumerate() {
            input(&mut doc, i as i32, 0, v);
        }
        doc.edit(0, Edit::Freeze { rows: 1, cols: 0 }, None).unwrap();
        doc.set_view(0, vec![SortKey { col: 0, desc: false }], String::new(), Vec::new()).unwrap();
        assert_eq!(doc.row_at(0, 1), 4, "a first");
        // Pasting two lines into the sorted view writes rows 4 and 2.
        doc.edit(0, Edit::Paste { rect: rect(1, 1, 1, 1), text: "x\ny\n".into() }, None).unwrap();
        assert_eq!(shown(&doc, 4, 2), "x");
        assert_eq!(shown(&doc, 2, 2), "y");
        doc.undo().unwrap();
        assert_eq!(shown(&doc, 2, 2), "", "both rows undone together");
        assert!(doc.edit(0, Edit::InsertRows { pos: 1, count: 1 }, None).is_err());

        let (text, clip) = doc.copy(0, rect(1, 0, 2, 0), false).unwrap();
        assert_eq!(text, "a\nb");
        assert!(clip.is_none());
    }

    #[test]
    fn copy_paste_keeps_formulas() {
        let mut doc = Document::blank(1).unwrap();
        input(&mut doc, 0, 0, "4");
        input(&mut doc, 0, 1, "=A1+1");
        let (text, clip) = doc.copy(0, rect(0, 0, 0, 1), false).unwrap();
        assert_eq!(text, "4\t5");
        let clip = clip.unwrap();
        doc.edit(0, Edit::Paste { rect: rect(2, 0, 2, 0), text: text.clone() }, Some(&clip)).unwrap();
        assert_eq!(doc.model.get_cell_content(0, 3, 2).unwrap(), "=A3+1");
        doc.edit(0, Edit::Autofill { rect: rect(0, 0, 0, 1), to: 4, rows: true }, None).unwrap();
        assert_eq!(doc.model.get_cell_content(0, 5, 2).unwrap(), "=A5+1");
        // Text from another app is pasted as values.
        doc.edit(0, Edit::Paste { rect: rect(0, 3, 1, 4), text: "7".into() }, None).unwrap();
        assert_eq!(shown(&doc, 2, 5), "7");
    }
}

#[cfg(test)]
mod probe {
    /// Opens the files in CELLS_PROBE (colon separated) and prints what the grid gets.
    #[test]
    #[ignore]
    fn probe_files() {
        for path in std::env::var("CELLS_PROBE").unwrap().split(':') {
            let t = std::time::Instant::now();
            let doc = super::Document::open_path(std::path::Path::new(path)).unwrap();
            let opened = t.elapsed();
            let info = doc.info();
            println!("{path}: {} ({:?}), sheets {:?}", info.kind, opened, info.sheets.iter().map(|s| &s.name).collect::<Vec<_>>());
            for sheet in 0..info.sheets.len() as u32 {
                let t = std::time::Instant::now();
                let layout = doc.layout(sheet).unwrap();
                let cells = doc.cells(sheet, 0, 100, layout.cols).unwrap();
                println!(
                    "  sheet {sheet}: data {}x{}, frozen {}/{}, merges {}, custom rows {}, styles {}, {:?}",
                    layout.data_rows, layout.data_cols, layout.frozen_rows, layout.frozen_cols, layout.merges.len(),
                    layout.row_heights.len(), cells.styles.len(), t.elapsed()
                );
                let all = doc.cells(sheet, 0, layout.rows, layout.cols).unwrap();
                let errors: Vec<String> = all.rows.iter().flat_map(|r| r.cells.iter().flatten().filter(|c| c.2 == 4).map(|c| c.0.clone())).collect();
                println!("    errors: {}", errors.len());
                for row in cells.rows.iter().take(6) {
                    let texts: Vec<String> = row.cells.iter().take(6).map(|c| c.as_ref().map(|c| c.0.clone()).unwrap_or_default()).collect();
                    println!("    {}: {:?}", row.pos, texts);
                }
            }
        }
    }
}

#[cfg(test)]
mod probe_speed {
    use super::*;

    #[test]
    #[ignore]
    fn probe_edit_speed() {
        let path = std::env::var("CELLS_BIG").unwrap();
        let mut doc = Document::open_path(Path::new(&path)).unwrap();
        let t = std::time::Instant::now();
        doc.edit(0, Edit::Input { pos: 5, col: 3, value: "=C6*2".into() }, None).unwrap();
        println!("edit with formula: {:?}", t.elapsed());
        let t = std::time::Instant::now();
        doc.edit(0, Edit::Input { pos: 6, col: 3, value: "7".into() }, None).unwrap();
        println!("plain edit: {:?}", t.elapsed());
        let t = std::time::Instant::now();
        doc.set_view(0, vec![SortKey { col: 2, desc: true }], String::new(), Vec::new()).unwrap();
        println!("sort by price: {:?}", t.elapsed());
        let t = std::time::Instant::now();
        doc.set_view(0, Vec::new(), "item 4".into(), Vec::new()).unwrap();
        println!("filter: {:?}, shown {:?}", t.elapsed(), doc.layout(0).unwrap().shown);
        let t = std::time::Instant::now();
        let stats = doc.stats(0, Rect { r0: 0, c0: 0, r1: 300_000, c1: 4 }).unwrap();
        println!("stats all: {:?} sum {}", t.elapsed(), stats.sum);
        let t = std::time::Instant::now();
        doc.undo().unwrap();
        println!("undo: {:?}", t.elapsed());
        let t = std::time::Instant::now();
        let rows = book::csv_rows(doc.workbook_model(), 0, &CsvFormat { decimal_comma: true, ..CsvFormat::default() }).unwrap();
        println!("csv export rows {}: {:?}", rows.len(), t.elapsed());
    }
}
