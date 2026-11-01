import { invoke } from "@tauri-apps/api/core";

export interface SheetInfo {
  name: string;
  hidden: boolean;
  color: string | null;
}

export interface DocInfo {
  id: string;
  title: string;
  location: string;
  kind: string;
  canSave: boolean;
  /** Saving keeps only the first sheet (CSV). */
  singleSheet: boolean;
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  sheets: SheetInfo[];
  notice: Notice;
}

/** What Cells cannot do with the opened file. */
export interface Notice {
  unkept: string[];
  recalcChanged: number;
  recalcExamples: string[];
}

export interface SortKey {
  col: number;
  desc: boolean;
}

export interface Layout {
  rows: number;
  cols: number;
  dataRows: number;
  dataCols: number;
  frozenRows: number;
  frozenCols: number;
  colWidths: number[];
  rowHeights: [number, number][];
  defaultRow: number;
  /** [row, col, height, width] */
  merges: [number, number, number, number][];
  sort: SortKey[];
  filter: string;
  valueFilters: [number, string[]][];
  shown: number | null;
  gridLines: boolean;
  baseSize: number;
}

export interface BorderDto {
  style: "thin" | "medium" | "thick" | "double" | "dotted" | "dashed";
  color: string | null;
}

export interface StyleDto {
  b: boolean;
  i: boolean;
  u: boolean;
  s: boolean;
  size: number;
  color: string | null;
  fill: string | null;
  h: "" | "left" | "center" | "right";
  v: "top" | "center" | "bottom";
  wrap: boolean;
  fmt: string;
  top: BorderDto | null;
  right: BorderDto | null;
  bottom: BorderDto | null;
  left: BorderDto | null;
}

/** [shown text, style id, kind]; kind 0 empty, 1 number, 2 text, 3 boolean, 4 error. */
export type CellOut = [string, number, number];

export interface RowOut {
  pos: number;
  cells: (CellOut | null)[];
}

export interface CellsOut {
  rows: RowOut[];
  styles: Record<string, StyleDto>;
  labels: number[] | null;
}

export interface CellInfo {
  content: string;
  style: StyleDto;
  merged: boolean;
  /** Sheet row number (from 1). */
  row: number;
}

export interface Stats {
  cells: number;
  filled: number;
  numbers: number;
  sum: number;
  min: number | null;
  max: number | null;
}

export interface RecentItem {
  kind: "file" | "google";
  location: string;
  title: string;
  openedAt: number;
}

/** Display positions from 0, corners included. */
export interface Rect {
  r0: number;
  c0: number;
  r1: number;
  c1: number;
}

export interface FindOptions {
  query: string;
  matchCase: boolean;
  wholeCell: boolean;
}

export type Edit =
  | { op: "input"; pos: number; col: number; value: string }
  | { op: "clear"; rect: Rect; what: "contents" | "formatting" | "all" }
  | { op: "style"; rect: Rect; path: string; value: string }
  | { op: "decimals"; rect: Rect; pos: number; col: number; delta: number }
  | { op: "border"; rect: Rect; kind: string; style: string; color: string }
  | { op: "merge"; rect: Rect }
  | { op: "unmerge"; rect: Rect }
  | { op: "insertRows"; pos: number; count: number }
  | { op: "deleteRows"; pos: number; count: number }
  | { op: "moveRows"; pos: number; count: number; delta: number }
  | { op: "hideRows"; pos: number; count: number; hidden: boolean }
  | { op: "rowHeight"; pos: number; count: number; height: number }
  | { op: "insertCols"; col: number; count: number }
  | { op: "deleteCols"; col: number; count: number }
  | { op: "moveCols"; col: number; count: number; delta: number }
  | { op: "hideCols"; col: number; count: number; hidden: boolean }
  | { op: "colWidth"; col: number; count: number; width: number }
  | { op: "freeze"; rows: number; cols: number }
  | { op: "autofill"; rect: Rect; to: number; rows: boolean }
  | { op: "fillDown"; rect: Rect }
  | { op: "fillRight"; rect: Rect }
  | { op: "paste"; rect: Rect; text: string }
  | { op: "replace"; find: FindOptions; replacement: string; cell: [number, number] | null }
  | { op: "addSheet" }
  | { op: "renameSheet"; name: string }
  | { op: "duplicateSheet" }
  | { op: "deleteSheet" }
  | { op: "moveSheet"; to: number }
  | { op: "hideSheet" }
  | { op: "unhideSheet"; index: number }
  | { op: "sheetColor"; color: string };

export interface EditResult {
  doc: DocInfo;
  outcome: { sheet: number | null; select: Rect | null; count: number | null; clipUsed: boolean };
}

export interface AppError {
  code: string;
  message: string;
}

export function toAppError(e: unknown): AppError {
  if (e && typeof e === "object" && "code" in e && "message" in e) return e as AppError;
  return { code: "error", message: String(e) };
}

export const api = {
  openPath: (path: string) => invoke<DocInfo>("open_path", { path }),
  openGoogle: (link: string) => invoke<DocInfo>("open_google", { link }),
  newDoc: () => invoke<DocInfo>("new_doc"),
  closeDoc: (id: string) => invoke<void>("close_doc", { id }),
  layout: (id: string, sheet: number) => invoke<Layout>("layout", { id, sheet }),
  cells: (id: string, sheet: number, start: number, count: number, cols: number) =>
    invoke<CellsOut>("cells", { id, sheet, start, count, cols }),
  cell: (id: string, sheet: number, pos: number, col: number) => invoke<CellInfo>("cell", { id, sheet, pos, col }),
  stats: (id: string, sheet: number, rect: Rect) => invoke<Stats>("stats", { id, sheet, rect }),
  find: (id: string, sheet: number, find: FindOptions) => invoke<[number, number][]>("find", { id, sheet, find }),
  columnValues: (id: string, sheet: number, col: number) => invoke<[string, number][]>("column_values", { id, sheet, col }),
  setView: (id: string, sheet: number, sort: SortKey[], filter: string, values: [number, string[]][]) =>
    invoke<void>("set_view", { id, sheet, sort, filter, values }),
  edit: (id: string, sheet: number, edit: Edit) => invoke<EditResult>("edit", { id, sheet, edit }),
  copy: (id: string, sheet: number, rect: Rect, cut: boolean) => invoke<string>("copy", { id, sheet, rect, cut }),
  undo: (id: string) => invoke<DocInfo>("undo", { id }),
  redo: (id: string) => invoke<DocInfo>("redo", { id }),
  save: (id: string) => invoke<DocInfo>("save", { id }),
  saveAs: (id: string, path: string, sheet: number) => invoke<DocInfo>("save_as", { id, path, sheet }),
  recentList: () => invoke<RecentItem[]>("recent_list"),
  recentRemove: (location: string) => invoke<void>("recent_remove", { location }),
  takePendingOpens: () => invoke<string[]>("take_pending_opens"),
};

/** Column letters like Excel: 0 -> A, 25 -> Z, 26 -> AA. */
export function columnName(index: number): string {
  let name = "";
  let n = index + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

/** Column index from letters: A -> 0, AA -> 26. */
export function columnIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export const OPEN_EXTENSIONS = ["csv", "tsv", "txt", "xlsx", "xlsm", "xls", "xlsb", "ods", "gsheet"];

export const NUMBER_FORMATS: { label: string; fmt: string; example: string }[] = [
  { label: "Automatic", fmt: "general", example: "1234.5" },
  { label: "Number", fmt: "#,##0.00", example: "1,234.50" },
  { label: "Whole number", fmt: "#,##0", example: "1,235" },
  { label: "Percent", fmt: "0%", example: "12%" },
  { label: "Percent with decimals", fmt: "0.00%", example: "12.34%" },
  { label: "Currency (kr)", fmt: '#,##0.00 "kr"', example: "1,234.50 kr" },
  { label: "Currency ($)", fmt: "$#,##0.00", example: "$1,234.50" },
  { label: "Currency (€)", fmt: '#,##0.00 "€"', example: "1,234.50 €" },
  { label: "Scientific", fmt: "0.00E+00", example: "1.23E+03" },
  { label: "Date", fmt: "yyyy-mm-dd", example: "2026-11-02" },
  { label: "Date (day first)", fmt: "dd.mm.yyyy", example: "02.11.2026" },
  { label: "Date and time", fmt: "yyyy-mm-dd hh:mm", example: "2026-11-02 14:30" },
  { label: "Time", fmt: "hh:mm", example: "14:30" },
  { label: "Text", fmt: "@", example: "As typed" },
];
