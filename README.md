<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/title-dark.png">
  <img src="docs/title-light.png" width="128" height="44" alt="Cells">
</picture>

Cells opens CSV files, Excel workbooks and Google Sheets in a light, quick spreadsheet editor for macOS. Edit with more than 300 Excel functions, cell formatting, sorting, filtering and multiple sheets. Free and open source.

![Cells opening a bachelor party budget from the recent list, selecting cells and a column with its sum in the status bar, then light mode](docs/demo.gif)

It is built with [Tauri 2](https://tauri.app): a Rust backend with the [IronCalc](https://www.ironcalc.com) spreadsheet engine, and a React frontend for the interface. The app is about 14 MB, 7 MB as a download.

## Why Cells

- **Light and quick.** A real macOS app built in Rust, about 14 MB, that opens spreadsheets instantly. No Electron and no bundled browser.
- **Free and open source.** No account, no subscription and no telemetry. MIT licensed.
- **Opens what you already have.** CSV and TSV, Excel (`.xlsx`, `.xlsm`, `.xls`, `.xlsb`), OpenDocument (`.ods`) and Google Sheets links.
- **Real formulas.** More than 300 Excel functions, calculated as you type, using the IronCalc engine.
- **Keeps your files intact.** Filters, pictures, charts, comments and tables are kept when you save an Excel file.

## Features

**Opening files**

- CSV, TSV and text files, Excel `.xlsx` and `.xlsm`, Excel 97-2003 `.xls`, Excel binary `.xlsb` and OpenDocument `.ods`.
- Google Sheets: paste a share link ("Anyone with the link can view"), or open a `.gsheet` file from Google Drive for desktop. All tabs are downloaded.
- Open from Finder (Open With, double-click), by dropping a file on the window, or from the recent list in the sidebar.
- `.xls`, `.xlsb` and `.ods` open with their values; Save As writes them as `.xlsx` or CSV.

**Formulas**

- More than 300 Excel functions, calculated as you type.
- References follow when rows and columns are inserted, deleted or moved.
- While typing a formula, click or drag over cells to insert their reference.
- The formula bar shows the formula of the selected cell. Type a cell address like `B12` in the address box to go there.

**Formatting**

- Bold, italic, underline, strikethrough, font size, text color and fill color.
- Horizontal and vertical alignment, wrapped text, borders (all, outside, inside, single sides; thin, medium, thick, dashed, dotted, double).
- Number formats: number, whole number, percent, currency (kr, $, €), scientific, dates, date and time, time and text, with buttons for more or fewer decimals.
- Merge and unmerge cells, clear formatting.

**Rows, columns and sheets**

- Insert, delete, move, hide and show rows and columns. Drag to resize; double-click a column edge to fit its contents.
- Freeze rows and columns. The Header row checkbox keeps the first row in place when scrolling, sorting and filtering.
- Add, rename, duplicate, delete, reorder and hide sheets.

**Editing**

- Fill handle: drag the corner of a selection to continue numbers, dates and formulas. Fill down (⌘D) and fill right (⌘R).
- Copy, cut and paste. Within Cells, pasting keeps formulas and formatting; text from other apps is pasted as values, and one value pasted on a selection fills it.
- Find and replace, with match case and whole cell.
- Sort by one or more columns, filter rows by text or by column values. Sorting and filtering change what is shown, not the order in the file.
- Undo and redo for every change.
- The status bar shows count, sum, average, minimum and maximum of the selection.

**Saving**

- CSV keeps its separator, text encoding (UTF-8 with or without byte order mark, UTF-16, Windows-1252), line endings and decimal commas. Postal codes like `0150` and long numbers like barcodes stay text. An unchanged file saves back byte for byte.
- Excel files keep what the engine does not model: filters, pictures, charts, comments, data validation lists, tables, sheet protection and print settings are copied from the original file when saving.
- A notice says when a file has parts Cells does not keep (pivot tables, slicers, links to other workbooks, macros), and when formulas give a different result in Cells than the one stored in the file.
- The first save of a session moves the original file to the Trash instead of overwriting it.

**Look**

- Light and dark mode, and accent colors: Neutral (white in dark mode, black in light mode) and the macOS system colors.

## Keyboard shortcuts

| Keys | Action |
| --- | --- |
| ⌘N, ⌘O | New spreadsheet, open file |
| ⌘S, ⇧⌘S | Save, Save As |
| ⌘Z, ⇧⌘Z | Undo, redo |
| ⌘C, ⌘X, ⌘V | Copy, cut, paste |
| ⌘B, ⌘I, ⌘U, ⇧⌘X | Bold, italic, underline, strikethrough |
| ⌘D, ⌘R | Fill down, fill right |
| ⌘F | Find and replace |
| ⌘A | Select all |
| Return or F2 | Edit the cell |
| ⌥Return | Line break inside a cell |
| ⌘ and an arrow key | Jump to the edge of the data |
| Delete | Clear the selected cells |

## Install

Download `Cells_<version>_aarch64.dmg` from [Releases](../../releases), open it, and drag `Cells` into the Applications folder. The build is for Apple Silicon Macs and needs macOS 11 or later. A `.app.zip` is attached too.

The app is not signed with an Apple Developer certificate or notarized, so the first time you open it macOS says it cannot be verified. Either right-click the app and choose Open, then confirm once, or run:

```sh
xattr -dr com.apple.quarantine /Applications/Cells.app
```

## Build from source

Requirements: [Rust](https://rustup.rs) (stable), Node.js 20 or later, and [pnpm](https://pnpm.io).

```sh
pnpm install
pnpm tauri dev                  # run in development mode
pnpm tauri build                # build Cells.app and the .dmg in src-tauri/target/release/bundle/
```

## Tests

```sh
cd src-tauri
cargo test
```

`scripts/corpus/` checks Cells against about 2,300 real spreadsheet and CSV files from the test collections of calamine, XlsxWriter, Apache POI, IronCalc and csv-spectrum: opening, rendering, calculated values against the values stored in the files, saving, and the editing commands. Its README has the steps.

## Spreadsheet engine

Formulas, formatting and `.xlsx` reading and writing use IronCalc 0.9.1. A copy is in `src-tauri/vendor/ironcalc_base` with fixes for problems the file check found: functions over whole columns (`VLOOKUP(x, A:B, 2)`, `MATCH`, `MAX`) took seconds per recalculation, the Student's t functions hung with very large inputs, and `BETA.INV` crashed with some inputs. [`vendor/PATCHES.md`](src-tauri/vendor/PATCHES.md) lists every change.

IronCalc does not support everything Excel does. Some table references (`[Column]` inside a table's total row), links to other workbooks and references across several sheets (`Sheet1:Sheet3!A1`) give an error in Cells. When an opened file has formulas like these, the notice above the grid says how many give a different result than the one stored in the file.

## Project layout

| Path | Contents |
| --- | --- |
| `src-tauri/src/document.rs` | An open spreadsheet: loading, editing commands, undo, saving |
| `src-tauri/src/view.rs` | Sort and filter |
| `src-tauri/src/book.rs` | CSV and value-only formats into the engine and back, recalculation check |
| `src-tauri/src/formats/` | CSV, `.xls`/`.xlsb`/`.ods` reading, `.xlsx` repair and cleanup, keeping parts on save (`carry.rs`) |
| `src-tauri/src/google.rs` | Google Sheets download |
| `src-tauri/src/corpus.rs` | Checks for the file collection |
| `src-tauri/vendor/` | Patched IronCalc engine |
| `src/components/Grid.tsx` | The grid: drawing, selection, editing, fill handle, frozen panes |
| `src/components/` | Toolbar, dialogs, sheet tabs, find bar, filters |
| `src-tauri/icons/` | App icon. `build-icon.sh` rebuilds the macOS 26 icon. |

## Data

- Recent files: `~/Library/Application Support/com.laki.cells/recent.json`
- Light or dark mode and the accent color are stored by the app's web view.

## Third-party software

| Component | Used for | License |
| --- | --- | --- |
| [IronCalc](https://github.com/ironcalc/IronCalc) | Spreadsheet engine, `.xlsx` reading and writing | MIT or Apache-2.0 |
| [calamine](https://github.com/tafia/calamine) | Reading `.xls`, `.xlsb` and `.ods` | MIT |
| [csv](https://github.com/BurntSushi/rust-csv) | Reading and writing CSV | MIT or Unlicense |
| [encoding_rs](https://github.com/hsivonen/encoding_rs) | Text encodings | MIT or Apache-2.0, and BSD-3-Clause |
| [Tauri](https://tauri.app) | App framework | MIT or Apache-2.0 |
| [React](https://react.dev) | Interface | MIT |
| [Lucide](https://lucide.dev) | Icons | ISC |

[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) has more detail.

## FAQ

**Is Cells free?** Yes. It is free and open source under the MIT license, with no account, subscription or telemetry.

**Can it open Excel files?** Yes, `.xlsx`, `.xlsm`, `.xls` and `.xlsb`, with formulas, formatting and more than 300 Excel functions.

**Can it open CSV and Google Sheets?** Yes. It opens CSV and TSV files, and Google Sheets from a share link or a `.gsheet` file.

**Does it work offline?** Yes, apart from downloading a Google Sheet, which needs a connection.

**Does it work on Apple Silicon and Intel Macs?** The prebuilt download is for Apple Silicon (M1 and later), macOS 11 or later. On an Intel Mac you can build it from source.

**Is it an Excel or Google Sheets alternative?** It is a lightweight, native spreadsheet editor for macOS that opens those files directly, for quick viewing and editing without a heavy office suite or a browser tab.

## License

Cells is released under the [MIT License](LICENSE).
