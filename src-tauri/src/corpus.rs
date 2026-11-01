//! Checks one spreadsheet file end to end, for testing against a collection of
//! real files. Run through scripts that call the test binary once per file:
//! `CELLS_FILE=path <test binary> --ignored --exact corpus::check_file --nocapture`
//! It prints one JSON line starting with "RESULT ".

use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::{Path, PathBuf};
use std::time::Instant;

use calamine::{open_workbook_auto, Data, Reader};
use ironcalc_base::cell::CellValue;
use ironcalc_base::Model;
use serde_json::{json, Value};

use crate::document::{Document, Edit, FindOptions, Rect, Source};
use crate::formats::csv;
use crate::view::SortKey;

const MAX_COMPARE: usize = 200_000;

fn panic_text(p: Box<dyn std::any::Any + Send>) -> String {
    p.downcast_ref::<String>().cloned().or_else(|| p.downcast_ref::<&str>().map(|s| s.to_string())).unwrap_or_default()
}

fn same_number(a: f64, b: f64) -> bool {
    (a - b).abs() <= 1e-9 * a.abs().max(b.abs()).max(1.0)
}

/// Compares the values calamine reads from the file (Excel's stored results)
/// with the values in the model after IronCalc recalculated them.
fn compare_stored(path: &Path, model: &Model) -> Value {
    let Ok(mut book) = open_workbook_auto(path) else { return json!({"skipped": "calamine cannot open"}) };
    let mut compared = 0usize;
    let mut mismatches = 0usize;
    let mut formula_mismatches = 0usize;
    let mut examples = Vec::new();
    for name in book.sheet_names() {
        let Ok(range) = book.worksheet_range(&name) else { continue };
        let Some(sheet) = model.workbook.worksheets.iter().position(|w| w.name == name) else {
            mismatches += 1;
            examples.push(json!({"sheet": name, "problem": "sheet missing"}));
            continue;
        };
        let sheet = sheet as u32;
        let (top, left) = range.start().unwrap_or((0, 0));
        for (r, c, data) in range.used_cells() {
            if compared >= MAX_COMPARE {
                break;
            }
            let row = (top as usize + r) as i32 + 1;
            let col = (left as usize + c) as i32 + 1;
            let ours = model.get_cell_value_by_index(sheet, row, col).unwrap_or(CellValue::None);
            let shown = model.get_formatted_cell_value(sheet, row, col).unwrap_or_default();
            compared += 1;
            let ok = match (data, &ours) {
                (Data::Empty, _) => true,
                (Data::String(s), CellValue::String(o)) => s == o,
                (Data::String(s), CellValue::None) => s.is_empty(),
                (Data::Float(f), CellValue::Number(n)) => same_number(*f, *n),
                (Data::Int(i), CellValue::Number(n)) => same_number(*i as f64, *n),
                (Data::Bool(b), CellValue::Boolean(o)) => b == o,
                (Data::DateTime(d), CellValue::Number(n)) => same_number(d.as_f64(), *n),
                (Data::DateTimeIso(_), _) | (Data::DurationIso(_), _) => true,
                (Data::Error(e), _) => shown == e.to_string() || matches!(&ours, CellValue::String(s) if *s == e.to_string()),
                _ => false,
            };
            if !ok {
                mismatches += 1;
                let content = model.get_cell_value_by_index(sheet, row, col).ok();
                let formula = model
                    .workbook
                    .worksheet(sheet)
                    .ok()
                    .and_then(|w| w.cell(row, col).map(|c| c.has_formula()))
                    .unwrap_or(false);
                if formula {
                    formula_mismatches += 1;
                }
                if examples.len() < 8 {
                    let text = model.get_localized_cell_content(sheet, row, col).unwrap_or_default();
                    examples.push(json!({
                        "cell": format!("{name}!{}{row}", col_name(col)),
                        "file": format!("{data:?}"),
                        "cells": format!("{content:?}"),
                        "shown": shown,
                        "formula": text,
                    }));
                }
            }
        }
    }
    json!({"compared": compared, "mismatches": mismatches, "formula_mismatches": formula_mismatches, "examples": examples})
}

fn col_name(col: i32) -> String {
    let mut name = String::new();
    let mut n = col;
    while n > 0 {
        let rem = ((n - 1) % 26) as u8;
        name.insert(0, (b'A' + rem) as char);
        n = (n - 1) / 26;
    }
    name
}

/// Saves as .xlsx, opens the result and compares values, formats and layout.
fn round_trip(doc: &mut Document, dir: &Path) -> Value {
    let target = dir.join("roundtrip.xlsx");
    let _ = std::fs::remove_file(&target);
    let before = doc.model.get_model().to_bytes();
    let saved = catch_unwind(AssertUnwindSafe(|| doc.save_as(&target, 0)));
    match saved {
        Err(p) => return json!({"panic": panic_text(p)}),
        Ok(Err(e)) => return json!({"error": e.message}),
        Ok(Ok(())) => {}
    }
    let original = Model::from_bytes(&before, "en").unwrap();
    let reopened = catch_unwind(|| ironcalc::import::load_from_xlsx(&target.to_string_lossy(), "en", "UTC", "en"));
    let reopened = match reopened {
        Err(p) => return json!({"reopen_panic": panic_text(p)}),
        Ok(Err(e)) => return json!({"reopen_error": e.to_string()}),
        Ok(Ok(m)) => m,
    };
    let calamine_ok = open_workbook_auto(&target).map(|mut b| b.sheet_names().iter().all(|n| b.worksheet_range(n).is_ok())).unwrap_or(false);
    let mut values = 0usize;
    let mut styles = 0usize;
    let mut examples = Vec::new();
    for (index, ws) in original.workbook.worksheets.iter().enumerate() {
        let sheet = index as u32;
        let Some(other) = reopened.workbook.worksheets.get(index) else {
            examples.push(json!({"sheet": ws.name, "problem": "sheet missing after save"}));
            values += 1;
            continue;
        };
        if other.name != ws.name || other.merged_cells.len() != ws.merged_cells.len() || other.frozen_rows != ws.frozen_rows {
            examples.push(json!({"sheet": ws.name, "problem": "name, merges or frozen rows changed"}));
            styles += 1;
        }
        for (row, col, _) in ws.sheet_data.cells().take(MAX_COMPARE) {
            let a = original.get_cell_value_by_index(sheet, row, col).ok();
            let b = reopened.get_cell_value_by_index(sheet, row, col).ok();
            let same = match (&a, &b) {
                (Some(CellValue::Number(x)), Some(CellValue::Number(y))) => same_number(*x, *y),
                _ => a == b,
            };
            if !same {
                values += 1;
                if examples.len() < 6 {
                    examples.push(json!({"cell": format!("{}!{}{row}", ws.name, col_name(col)), "before": format!("{a:?}"), "after": format!("{b:?}")}));
                }
            }
            let sa = original.get_style_for_cell(sheet, row, col).ok();
            let sb = reopened.get_style_for_cell(sheet, row, col).ok();
            if let (Some(sa), Some(sb)) = (sa, sb) {
                if sa.num_fmt != sb.num_fmt || sa.font.b != sb.font.b || sa.font.i != sb.font.i || sa.fill.color != sb.fill.color {
                    styles += 1;
                    if examples.len() < 6 {
                        examples.push(json!({"cell": format!("{}!{}{row}", ws.name, col_name(col)), "style_before": format!("{} b{} {:?}", sa.num_fmt, sa.font.b, sa.fill.color), "style_after": format!("{} b{} {:?}", sb.num_fmt, sb.font.b, sb.fill.color)}));
                    }
                }
            }
        }
    }
    json!({"value_changes": values, "style_changes": styles, "calamine_reads_it": calamine_ok, "examples": examples})
}

/// Runs the editing operations on the first sheet and reports panics and errors.
fn edit_smoke(doc: &mut Document) -> Value {
    let rect = |r0, c0, r1, c1| Rect { r0, c0, r1, c1 };
    let edits: Vec<(&str, Edit)> = vec![
        ("input", Edit::Input { pos: 0, col: 0, value: "=SUM(B1:B10)".into() }),
        ("style", Edit::Style { rect: rect(0, 0, 5, 3), path: "font.b".into(), value: "true".into() }),
        ("fill", Edit::Style { rect: rect(0, 0, 5, 3), path: "fill.color".into(), value: "#FFF2CC".into() }),
        ("decimals", Edit::Decimals { rect: rect(0, 0, 5, 3), pos: 1, col: 1, delta: 1 }),
        ("border", Edit::Border { rect: rect(0, 0, 3, 3), kind: "All".into(), style: "thin".into(), color: String::new() }),
        ("insert rows", Edit::InsertRows { pos: 1, count: 2 }),
        ("delete rows", Edit::DeleteRows { pos: 1, count: 2 }),
        ("insert cols", Edit::InsertCols { col: 1, count: 1 }),
        ("move rows", Edit::MoveRows { pos: 2, count: 1, delta: 1 }),
        ("hide cols", Edit::HideCols { col: 2, count: 1, hidden: true }),
        ("col width", Edit::ColWidth { col: 0, count: 2, width: 140.0 }),
        ("merge", Edit::Merge { rect: rect(20, 0, 21, 1) }),
        ("unmerge", Edit::Unmerge { rect: rect(20, 0, 21, 1) }),
        ("autofill", Edit::Autofill { rect: rect(1, 0, 2, 1), to: 6, rows: true }),
        ("fill down", Edit::FillDown { rect: rect(1, 0, 4, 2) }),
        ("paste text", Edit::Paste { rect: rect(30, 0, 30, 0), text: "a\tb\n1\t2".into() }),
        ("freeze", Edit::Freeze { rows: 1, cols: 1 }),
        ("clear", Edit::Clear { rect: rect(30, 0, 31, 1), what: "all".into() }),
        ("add sheet", Edit::AddSheet),
        ("duplicate sheet", Edit::DuplicateSheet),
        ("replace", Edit::Replace { find: FindOptions { query: "a".into(), match_case: false, whole_cell: false }, replacement: "a".into(), cell: None }),
    ];
    let mut problems = Vec::new();
    for (name, edit) in edits {
        eprintln!("OP {name}");
        match catch_unwind(AssertUnwindSafe(|| doc.edit(0, edit, None))) {
            Err(p) => problems.push(json!({"op": name, "panic": panic_text(p)})),
            Ok(Err(e)) => problems.push(json!({"op": name, "error": e.message})),
            Ok(Ok(_)) => {}
        }
    }
    let other: Vec<(&str, Box<dyn Fn(&mut Document) -> Result<(), String>>)> = vec![
        ("copy", Box::new(|d: &mut Document| d.copy(0, rect(0, 0, 3, 3), false).map(|_| ()).map_err(|e| e.message))),
        ("sort", Box::new(|d: &mut Document| d.set_view(0, vec![SortKey { col: 0, desc: true }], String::new(), Vec::new()).map_err(|e| e.message))),
        ("filter", Box::new(|d: &mut Document| d.set_view(0, Vec::new(), "e".into(), Vec::new()).map_err(|e| e.message))),
        ("layout in view", Box::new(|d: &mut Document| d.layout(0).map(|_| ()).map_err(|e| e.message))),
        ("cells in view", Box::new(|d: &mut Document| d.cells(0, 0, 200, 30).map(|_| ()).map_err(|e| e.message))),
        ("clear view", Box::new(|d: &mut Document| d.set_view(0, Vec::new(), String::new(), Vec::new()).map_err(|e| e.message))),
        ("column values", Box::new(|d: &mut Document| d.column_values(0, 0).map(|_| ()).map_err(|e| e.message))),
        ("stats", Box::new(|d: &mut Document| d.stats(0, rect(0, 0, 1000, 20)).map(|_| ()).map_err(|e| e.message))),
        ("undo all", Box::new(|d: &mut Document| {
            for _ in 0..40 {
                d.undo().map_err(|e| e.message)?;
            }
            Ok(())
        })),
        ("redo all", Box::new(|d: &mut Document| {
            for _ in 0..40 {
                d.redo().map_err(|e| e.message)?;
            }
            Ok(())
        })),
    ];
    for (name, f) in other {
        eprintln!("OP {name}");
        match catch_unwind(AssertUnwindSafe(|| f(doc))) {
            Err(p) => problems.push(json!({"op": name, "panic": panic_text(p)})),
            Ok(Err(e)) => problems.push(json!({"op": name, "error": e})),
            Ok(Ok(())) => {}
        }
    }
    json!(problems)
}

/// Opening a CSV file and saving it without edits must give the same bytes.
fn csv_round_trip(path: &Path, dir: &Path) -> Value {
    let copy = dir.join(path.file_name().unwrap());
    if std::fs::copy(path, &copy).is_err() {
        return json!({"error": "copy failed"});
    }
    let original = std::fs::read(path).unwrap_or_default();
    let result = catch_unwind(|| {
        let mut doc = Document::open_path(&copy)?;
        doc.original_in_trash = true;
        doc.save()
    });
    match result {
        Err(p) => json!({"panic": panic_text(p)}),
        Ok(Err(e)) => json!({"error": e.message}),
        Ok(Ok(())) => {
            let saved = std::fs::read(&copy).unwrap_or_default();
            if saved == original {
                json!({"identical": true})
            } else {
                // Same fields with different quoting or line endings is less serious.
                let fields = |bytes: &[u8]| {
                    let (text, _, _) = csv::decode(bytes);
                    let delimiter = csv::detect_delimiter(&text);
                    csv::parse(&text, delimiter).ok()
                };
                let first = std::str::from_utf8(&original).ok().map(|s| s.chars().take(160).collect::<String>());
                let after = std::str::from_utf8(&saved).ok().map(|s| s.chars().take(160).collect::<String>());
                json!({"identical": false, "same_fields": fields(&original) == fields(&saved), "before": first, "after": after})
            }
        }
    }
}

#[test]
#[ignore]
fn check_file() {
    let path = PathBuf::from(std::env::var("CELLS_FILE").expect("CELLS_FILE"));
    let dir = std::env::temp_dir().join(format!("cells-corpus-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let ext = path.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    let mut out = json!({"file": path.to_string_lossy()});

    if ext == "xlsx" || ext == "xlsm" {
        let direct = catch_unwind(|| ironcalc::import::load_from_xlsx(&path.to_string_lossy(), "en", "UTC", "en").map(|_| ()));
        out["ironcalc_load"] = match direct {
            Err(p) => json!({"panic": panic_text(p)}),
            Ok(Err(e)) => json!({"error": e.to_string()}),
            Ok(Ok(())) => json!("ok"),
        };
    }

    let t = Instant::now();
    let opened = catch_unwind(|| Document::open_path(&path));
    out["open_ms"] = json!(t.elapsed().as_millis());
    let mut doc = match opened {
        Err(p) => {
            out["open"] = json!({"panic": panic_text(p)});
            println!("RESULT {out}");
            return;
        }
        Ok(Err(e)) => {
            out["open"] = json!({"error": e.message});
            println!("RESULT {out}");
            return;
        }
        Ok(Ok(doc)) => doc,
    };
    out["open"] = json!("ok");
    out["kind"] = json!(doc.info().kind);

    // What the grid asks for: the layout and every cell of every sheet.
    let mut render = Vec::new();
    for sheet in 0..doc.info().sheets.len() as u32 {
        let r = catch_unwind(AssertUnwindSafe(|| -> Result<(), String> {
            let layout = doc.layout(sheet).map_err(|e| e.message)?;
            // The grid asks for about the visible columns, in blocks of 100 rows.
            let cols = layout.cols.min(120);
            for start in (0..layout.rows.min(5000)).step_by(100) {
                doc.cells(sheet, start, 100, cols).map_err(|e| e.message)?;
            }
            doc.cell(sheet, 0, 0).map_err(|e| e.message)?;
            Ok(())
        }));
        match r {
            Err(p) => render.push(json!({"sheet": sheet, "panic": panic_text(p)})),
            Ok(Err(e)) => render.push(json!({"sheet": sheet, "error": e})),
            Ok(Ok(())) => {}
        }
    }
    out["render"] = json!(render);

    if matches!(doc.source, Source::Csv(_)) {
        out["csv_round_trip"] = csv_round_trip(&path, &dir);
    } else if !matches!(ext.as_str(), "csv" | "tsv" | "txt") {
        let values_only = doc.info().kind.contains("values only") || matches!(ext.as_str(), "xls" | "xlsb" | "ods");
        if !values_only {
            let model = Model::from_bytes(&doc.model.get_model().to_bytes(), "en").unwrap();
            out["stored_values"] = catch_unwind(AssertUnwindSafe(|| compare_stored(&path, &model)))
                .unwrap_or_else(|p| json!({"panic": panic_text(p)}));
        }
    }

    out["save_xlsx"] = round_trip(&mut doc, &dir);
    let mut fresh = Document::open_path(&path).unwrap();
    out["edits"] = edit_smoke(&mut fresh);
    let _ = std::fs::remove_dir_all(&dir);
    println!("RESULT {out}");
}

/// Times each step of opening a file, to find slow or memory-hungry ones.
#[test]
#[ignore]
fn time_steps() {
    let path = std::env::var("CELLS_FILE").unwrap();
    let t = Instant::now();
    let mut model = ironcalc::import::load_from_xlsx(&path, "en", "UTC", "en").unwrap();
    println!("STEP load {:?}", t.elapsed());
    for (i, ws) in model.workbook.worksheets.iter().enumerate() {
        let d = ws.dimension();
        println!("STEP sheet {i} {} dimension {}x{} cells {}", ws.name, d.max_row, d.max_column, ws.sheet_data.cells().count());
    }
    let t = Instant::now();
    model.evaluate();
    println!("STEP evaluate {:?}", t.elapsed());
}

/// How long 300 formulas over whole columns take to calculate, per function.
#[test]
#[ignore]
fn whole_column_speed() {
    let formulas = [
        "=SUM(A:A)",
        "=SUMIF(A:A,\">5\",B:B)",
        "=COUNTIF(A:A,5)",
        "=COUNTIFS(A:A,5,B:B,\">1\")",
        "=MATCH(5,A:A,0)",
        "=VLOOKUP(5,A:B,2,FALSE)",
        "=XLOOKUP(5,A:A,B:B)",
        "=INDEX(B:B,MATCH(5,A:A,0))",
        "=MAX(A:A)",
        "=AVERAGE(A:A)",
        "=SUMPRODUCT((A1:A300>5)*B1:B300)",
    ];
    for f in formulas {
        let mut model = crate::book::empty_model("en").unwrap();
        for r in 1..=300 {
            model.set_user_input(0, r, 1, r.to_string()).unwrap();
            model.set_user_input(0, r, 2, (r * 2).to_string()).unwrap();
            model.set_user_input(0, r, 4, f.to_string()).unwrap();
        }
        let t = Instant::now();
        model.evaluate();
        println!("SPEED {:>12?} {f} -> {:?}", t.elapsed(), model.get_formatted_cell_value(0, 1, 4).unwrap());
    }
}

/// Saves CELLS_FILE as CELLS_OUT and reports what calamine says about the result.
#[test]
#[ignore]
fn resave() {
    let path = PathBuf::from(std::env::var("CELLS_FILE").unwrap());
    let out = PathBuf::from(std::env::var("CELLS_OUT").unwrap());
    let _ = std::fs::remove_file(&out);
    let mut doc = Document::open_path(&path).unwrap();
    doc.save_as(&out, 0).unwrap();
    let mut book = open_workbook_auto(&out).unwrap();
    for name in book.sheet_names() {
        println!("SHEET {name}: {:?}", book.worksheet_range(&name).err().map(|e| e.to_string()));
    }
    let names = |p: &Path| -> Vec<String> {
        let mut z = zip::ZipArchive::new(std::fs::File::open(p).unwrap()).unwrap();
        (0..z.len()).map(|i| z.by_index(i).unwrap().name().unwrap().to_string()).collect()
    };
    let saved = names(&out);
    let lost: Vec<String> = names(&path)
        .into_iter()
        .filter(|n| !saved.contains(n) && !n.ends_with('/') && !n.contains("calcChain") && !n.starts_with("docProps/"))
        .collect();
    println!("LOST {lost:?}");
    let reopened = Document::open_path(&out).map(|d| d.info().sheets.len());
    println!("REOPEN {reopened:?}");
}

/// Inserts two rows at row 2 of CELLS_FILE, for finding hangs.
#[test]
#[ignore]
fn insert_rows_once() {
    let path = PathBuf::from(std::env::var("CELLS_FILE").unwrap());
    let mut doc = Document::open_path(&path).unwrap();
    let t = Instant::now();
    let r = doc.edit(0, Edit::InsertRows { pos: 1, count: 2 }, None).map(|_| ());
    println!("INSERT {:?} {:?}", r.err().map(|e| e.message), t.elapsed());
}

/// Evaluates the formula in CELLS_FORMULA, for finding hangs in functions.
#[test]
#[ignore]
fn one_formula() {
    let formula = std::env::var("CELLS_FORMULA").unwrap();
    let mut model = crate::book::empty_model("en").unwrap();
    model.set_user_input(0, 1, 1, formula.clone()).unwrap();
    let t = Instant::now();
    model.evaluate();
    println!("FORMULA {formula} = {:?} in {:?}", model.get_formatted_cell_value(0, 1, 1).unwrap(), t.elapsed());
}

/// Bold on whole columns and on the whole sheet must use column styles, not
/// a style per cell.
#[test]
fn whole_column_style_is_fast() {
    let mut doc = Document::blank(1).unwrap();
    let t = Instant::now();
    let all = Rect { r0: 0, c0: 0, r1: 1_048_575, c1: 16_383 };
    doc.edit(0, Edit::Style { rect: all, path: "font.b".into(), value: "true".into() }, None).unwrap();
    let cols = Rect { r0: 0, c0: 1, r1: 1_048_575, c1: 2 };
    doc.edit(0, Edit::Style { rect: cols, path: "fill.color".into(), value: "#FFF2CC".into() }, None).unwrap();
    doc.edit(0, Edit::Clear { rect: cols, what: "formatting".into() }, None).unwrap();
    assert!(t.elapsed().as_secs() < 3, "took {:?}", t.elapsed());
    assert!(doc.model.get_cell_style(0, 500_000, 1).unwrap().font.b);
}
