import { ArrowDown, ArrowUp, ChevronDown, Filter } from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { api, columnName, type BorderDto, type CellOut, type Layout, type Rect, type RowOut, type StyleDto } from "../api";

export interface Cell {
  r: number;
  c: number;
}

/** The anchor is the active cell; the focus is the corner that moves when extending. */
export interface Selection {
  anchor: Cell;
  focus: Cell;
}

export function selectionRect(sel: Selection): Rect {
  return {
    r0: Math.min(sel.anchor.r, sel.focus.r),
    r1: Math.max(sel.anchor.r, sel.focus.r),
    c0: Math.min(sel.anchor.c, sel.focus.c),
    c1: Math.max(sel.anchor.c, sel.focus.c),
  };
}

const HEAD_H = 24;
const BLOCK = 100;
const OVERSCAN = 300;
const MIN_COL = 16;
const MIN_ROW = 8;
const KEY = 16384;
const FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif';
const BORDER_WIDTH: Record<BorderDto["style"], number> = { thin: 1, medium: 2, thick: 3, double: 3, dotted: 1, dashed: 1 };

type Layer = "main" | "top" | "left" | "corner";

interface Editing {
  cell: Cell;
  value: string;
  /** "enter" started by typing: arrow keys finish the edit. "edit" moves the caret. */
  mode: "enter" | "edit";
  original: string;
  /** A cell reference inserted by clicking, replaced by the next click or drag. */
  ref: { start: number; end: number } | null;
}

type Drag =
  | { kind: "cells" }
  | { kind: "cols"; start: number }
  | { kind: "rows"; start: number }
  | { kind: "ref"; anchor: Cell }
  | { kind: "fill"; rect: Rect }
  | { kind: "colResize"; col: number; startX: number; startWidth: number }
  | { kind: "rowResize"; pos: number; startY: number; startHeight: number };

interface GridProps {
  docId: string;
  sheet: number;
  layout: Layout;
  /** Changes whenever cell data may have changed on the Rust side. */
  version: number;
  theme: "dark" | "light";
  selection: Selection;
  /** The active cell's formula or typed value, for editing. */
  active: { cell: Cell; content: string } | null;
  /** Range shown with a dashed outline after copying. */
  copied: Rect | null;
  /** The fill handle is only offered without sort and filter. */
  canFill: boolean;
  /** Scrolls a cell into view when the token changes. */
  revealRequest: { cell: Cell; token: number } | null;
  onSelection: (sel: Selection) => void;
  onInput: (pos: number, col: number, value: string) => void;
  onCopy: (cut: boolean) => void;
  onPaste: () => void;
  onClear: () => void;
  onEscape: () => void;
  onAutofill: (rect: Rect, to: number, rows: boolean) => void;
  onColWidth: (col: number, count: number, width: number) => void;
  onRowHeight: (pos: number, count: number, height: number) => void;
  onColumnMenu: (e: ReactMouseEvent, col: number) => void;
  onRowMenu: (e: ReactMouseEvent, pos: number) => void;
  onCellMenu: (e: ReactMouseEvent) => void;
}

/** Largest index i with offsets[i] <= value, between 0 and offsets.length - 2. */
function indexAt(offsets: Float64Array, value: number): number {
  let lo = 0;
  let hi = offsets.length - 2;
  if (hi < 0) return 0;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (offsets[mid] <= value) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

const measure = document.createElement("canvas").getContext("2d");
const widths = new Map<string, number>();

function textWidth(text: string, font: string): number {
  const key = `${font}|${text}`;
  let width = widths.get(key);
  if (width === undefined) {
    if (widths.size > 20000) widths.clear();
    if (measure) {
      measure.font = font;
      width = measure.measureText(text).width;
    } else width = text.length * 7;
    widths.set(key, width);
  }
  return width;
}

function rgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function luminance(hex: string): number {
  const c = rgb(hex);
  return c ? 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] : 0.5;
}

/** Text color on the dark background: grays become the theme's text color, dark colors are lightened. */
function darkModeText(hex: string): string | undefined {
  const c = rgb(hex);
  if (!c) return hex;
  const chroma = Math.max(...c) - Math.min(...c);
  const lum = luminance(hex);
  if (chroma < 0.15 && lum < 0.5) return undefined;
  if (lum < 0.3) return `color-mix(in srgb, ${hex} 55%, white)`;
  return hex;
}

/** Text and fill colors, adjusted so files made for white paper stay readable in dark mode. */
function cellColors(st: StyleDto | undefined, dark: boolean): { color?: string; background?: string } {
  let fill = st?.fill ?? null;
  if (fill && dark && fill.toUpperCase() === "#FFFFFF") fill = null;
  let color = st?.color ?? null;
  if (!fill) {
    if (color && dark) return { color: darkModeText(color) };
    if (color && luminance(color) > 0.85) color = null;
    return { color: color ?? undefined };
  }
  if (!color) color = luminance(fill) > 0.55 ? "#1d1d1f" : "#f5f5f7";
  return { color, background: fill };
}

function borderShadows(st: StyleDto, dark: boolean): string | undefined {
  const color = (b: BorderDto) => (!b.color || (dark && luminance(b.color) < 0.35) ? "var(--cell-border)" : b.color);
  const out: string[] = [];
  if (st.top) out.push(`inset 0 ${BORDER_WIDTH[st.top.style]}px 0 ${color(st.top)}`);
  if (st.bottom) out.push(`inset 0 -${BORDER_WIDTH[st.bottom.style]}px 0 ${color(st.bottom)}`);
  if (st.left) out.push(`inset ${BORDER_WIDTH[st.left.style]}px 0 0 ${color(st.left)}`);
  if (st.right) out.push(`inset -${BORDER_WIDTH[st.right.style]}px 0 0 ${color(st.right)}`);
  return out.length ? out.join(", ") : undefined;
}

export function Grid(props: GridProps) {
  const { layout, selection, docId, sheet, version } = props;
  const dark = props.theme === "dark";
  const scrollRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const cache = useRef(new Map<number, RowOut>());
  const labels = useRef(new Map<number, number>());
  const styles = useRef(new Map<number, StyleDto>());
  // Per block of rows: the data version and how many columns were fetched.
  const loaded = useRef(new Map<number, { version: number; cols: number }>());
  const loading = useRef(new Map<number, { version: number; cols: number }>());
  const drag = useRef<Drag | null>(null);
  const [, setTick] = useState(0);
  const [viewport, setViewport] = useState({ top: 0, left: 0, width: 1000, height: 700 });
  const [colOverride, setColOverride] = useState<{ col: number; width: number } | null>(null);
  const [rowOverride, setRowOverride] = useState<{ pos: number; height: number } | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [fillTarget, setFillTarget] = useState<Rect | null>(null);
  const [refRange, setRefRange] = useState<Rect | null>(null);

  const rows = layout.rows;
  const cols = layout.cols;
  const f = Math.min(layout.frozenRows, rows);
  const fc = Math.min(layout.frozenCols, cols);
  const rowNumW = Math.round(Math.max(40, String(rows).length * 7.5 + 18));
  const baseSize = layout.baseSize || 12;

  // A resize in progress is shown before it is saved; the next layout replaces it.
  useEffect(() => setColOverride(null), [layout.colWidths]);
  useEffect(() => setRowOverride(null), [layout.rowHeights]);

  const colLeft = useMemo(() => {
    const out = new Float64Array(cols + 1);
    out[0] = rowNumW;
    for (let c = 0; c < cols; c++) out[c + 1] = out[c] + (colOverride?.col === c ? colOverride.width : (layout.colWidths[c] ?? 90));
    return out;
  }, [layout.colWidths, cols, rowNumW, colOverride]);

  const rowTops = useMemo(() => {
    const heights = new Map(layout.rowHeights);
    if (rowOverride) heights.set(rowOverride.pos, rowOverride.height);
    const out = new Float64Array(rows + 1);
    for (let p = 0; p < rows; p++) out[p + 1] = out[p] + (heights.get(p) ?? layout.defaultRow);
    return out;
  }, [layout.rowHeights, layout.defaultRow, rows, rowOverride]);

  const merges = useMemo(() => {
    const anchors = new Map<number, [number, number]>();
    const covered = new Map<number, number>();
    for (const [r, c, h, w] of layout.merges) {
      const anchor = r * KEY + c;
      anchors.set(anchor, [h, w]);
      for (let i = r; i < r + h; i++) for (let j = c; j < c + w; j++) if (i * KEY + j !== anchor) covered.set(i * KEY + j, anchor);
    }
    return { anchors, covered };
  }, [layout.merges]);

  const frozenH = rowTops[f];
  const frozenW = colLeft[fc] - rowNumW;
  const totalW = colLeft[cols];
  const totalH = rowTops[rows];
  const rowH = (p: number) => rowTops[p + 1] - rowTops[p];
  const colW = (c: number) => colLeft[c + 1] - colLeft[c];
  const label = (p: number) => labels.current.get(p) ?? p + 1;

  const firstRow = Math.max(f, indexAt(rowTops, viewport.top + frozenH - OVERSCAN));
  const lastRow = Math.min(rows - 1, indexAt(rowTops, viewport.top + viewport.height - HEAD_H + OVERSCAN));
  const firstCol = Math.max(fc, indexAt(colLeft, viewport.left + rowNumW + frozenW - OVERSCAN));
  const lastCol = Math.min(cols - 1, indexAt(colLeft, viewport.left + viewport.width + OVERSCAN));

  // ---- Data ----

  // Columns are fetched up to a little past the visible ones: a sheet can
  // have styles on all 16,384 columns.
  const neededCols = Math.min(cols, lastCol + 1 + 40);

  useEffect(() => {
    const blocks = new Set<number>();
    for (let b = Math.floor(firstRow / BLOCK); b <= Math.floor(lastRow / BLOCK); b++) blocks.add(b);
    if (f > 0) for (let b = 0; b <= Math.floor((f - 1) / BLOCK); b++) blocks.add(b);
    for (const b of blocks) {
      if (b * BLOCK >= rows) continue;
      const have = loaded.current.get(b);
      if (have && have.version >= version && have.cols >= neededCols) continue;
      const busy = loading.current.get(b);
      if (busy && busy.version >= version && busy.cols >= neededCols) continue;
      const v = version;
      const fetchCols = Math.min(cols, neededCols + 60);
      loading.current.set(b, { version: v, cols: fetchCols });
      api
        .cells(docId, sheet, b * BLOCK, BLOCK, fetchCols)
        .then((out) => {
          const current = loaded.current.get(b);
          if (current && (current.version > v || (current.version === v && current.cols >= fetchCols))) return;
          loaded.current.set(b, { version: v, cols: fetchCols });
          for (let p = b * BLOCK; p < (b + 1) * BLOCK; p++) {
            cache.current.delete(p);
            labels.current.delete(p);
          }
          for (const row of out.rows) cache.current.set(row.pos, row);
          out.labels?.forEach((n, i) => labels.current.set(b * BLOCK + i, n));
          for (const [id, st] of Object.entries(out.styles)) styles.current.set(Number(id), st);
          setTick((t) => t + 1);
        })
        .catch(() => loading.current.delete(b));
    }
  }, [firstRow, lastRow, f, version, rows, cols, neededCols, docId, sheet]);

  // ---- Viewport ----

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setViewport({ top: el.scrollTop, left: el.scrollLeft, width: el.clientWidth, height: el.clientHeight });
    const observer = new ResizeObserver(update);
    observer.observe(el);
    update();
    return () => observer.disconnect();
  }, []);

  const reveal = (cell: Cell) => {
    const el = scrollRef.current;
    if (!el) return;
    if (cell.r >= f && cell.r < rows) {
      const viewH = el.clientHeight - HEAD_H - frozenH;
      const top = rowTops[cell.r] - frozenH;
      const bottom = rowTops[cell.r + 1] - frozenH;
      if (top < el.scrollTop) el.scrollTop = top;
      else if (bottom > el.scrollTop + viewH) el.scrollTop = bottom - viewH;
    }
    if (cell.c >= fc && cell.c < cols) {
      const viewW = el.clientWidth - rowNumW - frozenW;
      const left = colLeft[cell.c] - rowNumW - frozenW;
      const right = colLeft[cell.c + 1] - rowNumW - frozenW;
      if (left < el.scrollLeft) el.scrollLeft = left;
      else if (right > el.scrollLeft + viewW) el.scrollLeft = Math.min(left, right - viewW);
    }
  };

  useEffect(() => {
    if (props.revealRequest) reveal(props.revealRequest.cell);
  }, [props.revealRequest?.token]);

  /** The cell under the pointer; -1 for the row or column headers. */
  const hitTest = (clientX: number, clientY: number, clamp: boolean): Cell => {
    const el = scrollRef.current!;
    const box = el.getBoundingClientRect();
    let vx = clientX - box.left;
    let vy = clientY - box.top;
    if (clamp) {
      vx = Math.max(rowNumW, Math.min(el.clientWidth - 1, vx));
      vy = Math.max(HEAD_H, Math.min(el.clientHeight - 1, vy));
    }
    let c = -1;
    let r = -1;
    if (vx >= rowNumW) c = indexAt(colLeft, vx < rowNumW + frozenW ? vx : vx + el.scrollLeft);
    if (vy >= HEAD_H) {
      const y = vy - HEAD_H;
      r = indexAt(rowTops, y < frozenH ? y : y + el.scrollTop);
    }
    return { r, c };
  };

  // ---- Selection ----

  const rect = selectionRect(selection);
  const active = selection.anchor;

  const mergeAt = (cell: Cell): Rect | null => {
    const key = cell.r * KEY + cell.c;
    const anchor = merges.anchors.has(key) ? key : merges.covered.get(key);
    if (anchor === undefined) return null;
    const [h, w] = merges.anchors.get(anchor)!;
    const r = Math.floor(anchor / KEY);
    const c = anchor % KEY;
    return { r0: r, c0: c, r1: r + h - 1, c1: c + w - 1 };
  };

  const clampCell = (cell: Cell): Cell => ({
    r: Math.max(0, Math.min(rows - 1, cell.r)),
    c: Math.max(0, Math.min(cols - 1, cell.c)),
  });

  const selectCell = (cell: Cell, extend: boolean) => {
    const next = clampCell(cell);
    if (extend) props.onSelection({ anchor: selection.anchor, focus: next });
    else {
      const m = mergeAt(next);
      props.onSelection(m ? { anchor: { r: m.r0, c: m.c0 }, focus: { r: m.r1, c: m.c1 } } : { anchor: next, focus: next });
    }
    reveal(next);
  };

  /** Moves the active cell (or the focus when extending), stepping over merged and hidden cells. */
  const move = (from: Cell, dr: number, dc: number, extend: boolean) => {
    const target = { r: from.r + dr, c: from.c + dc };
    const m = extend ? null : mergeAt(from);
    if (m && dr > 0) target.r = m.r1 + 1;
    if (m && dc > 0) target.c = m.c1 + 1;
    while (dr !== 0 && target.r > 0 && target.r < rows - 1 && rowH(target.r) === 0) target.r += Math.sign(dr);
    while (dc !== 0 && target.c > 0 && target.c < cols - 1 && colW(target.c) === 0) target.c += Math.sign(dc);
    selectCell(target, extend);
  };

  // ---- Editing ----

  const shownText = (cell: Cell) => cache.current.get(cell.r)?.cells[cell.c]?.[0] ?? "";

  const startEdit = (cell: Cell, typed: string | null) => {
    const m = mergeAt(cell);
    const at = m ? { r: m.r0, c: m.c0 } : cell;
    const known = props.active && props.active.cell.r === at.r && props.active.cell.c === at.c;
    const original = known ? props.active!.content : shownText(at);
    setEditing({ cell: at, value: typed ?? original, mode: typed === null ? "edit" : "enter", original, ref: null });
    setRefRange(null);
  };

  const commitEdit = (dr: number, dc: number) => {
    if (!editing) return;
    const { cell, value, original } = editing;
    setEditing(null);
    setRefRange(null);
    if (value !== original) props.onInput(cell.r, cell.c, value);
    if (dr || dc) move(cell, dr, dc, false);
    scrollRef.current?.focus({ preventScroll: true });
  };

  const cancelEdit = () => {
    setEditing(null);
    setRefRange(null);
    scrollRef.current?.focus({ preventScroll: true });
  };

  /** While typing a formula, a click after an operator inserts a reference. */
  const refInsertable = (ed: Editing): boolean => {
    if (!ed.value.startsWith("=")) return false;
    const caret = editorRef.current?.selectionStart ?? ed.value.length;
    if (ed.ref && caret === ed.ref.end) return true;
    return /[=+\-*/^(,;:<>&]$/.test(ed.value.slice(0, caret).trimEnd());
  };

  const insertRef = (anchor: Cell, focus: Cell) => {
    const r = selectionRect({ anchor, focus });
    const first = `${columnName(r.c0)}${label(r.r0)}`;
    const text = r.r0 === r.r1 && r.c0 === r.c1 ? first : `${first}:${columnName(r.c1)}${label(r.r1)}`;
    setRefRange(r);
    setEditing((ed) => {
      if (!ed) return ed;
      const caret = editorRef.current?.selectionStart ?? ed.value.length;
      const replace = ed.ref && (caret === ed.ref.end || drag.current?.kind === "ref");
      const start = replace ? ed.ref!.start : caret;
      const end = replace ? ed.ref!.end : caret;
      const value = ed.value.slice(0, start) + text + ed.value.slice(end);
      requestAnimationFrame(() => {
        const el = editorRef.current;
        el?.focus();
        el?.setSelectionRange(start + text.length, start + text.length);
      });
      return { ...ed, value, ref: { start, end: start + text.length } };
    });
  };

  const onEditorKey = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    e.stopPropagation();
    if (!editing) return;
    if (e.key === "Enter" && e.altKey) {
      // Option+Return adds a line break inside the cell.
      e.preventDefault();
      const el = e.currentTarget;
      const value = el.value.slice(0, el.selectionStart) + "\n" + el.value.slice(el.selectionEnd);
      const caret = el.selectionStart + 1;
      setEditing({ ...editing, value, ref: null });
      requestAnimationFrame(() => editorRef.current?.setSelectionRange(caret, caret));
    } else if (e.key === "Enter") {
      e.preventDefault();
      commitEdit(e.shiftKey ? -1 : 1, 0);
    } else if (e.key === "Tab") {
      e.preventDefault();
      commitEdit(0, e.shiftKey ? -1 : 1);
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelEdit();
    } else if (editing.mode === "enter" && !editing.value.startsWith("=") && e.key.startsWith("Arrow")) {
      e.preventDefault();
      const d: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
      commitEdit(...d[e.key]);
    }
  };

  // ---- Keyboard ----

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (editing || e.target !== scrollRef.current) return;
    const meta = e.metaKey || e.ctrlKey;
    const page = Math.max(1, Math.floor((viewport.height - HEAD_H - frozenH) / layout.defaultRow) - 1);
    const steps: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
      PageUp: [-page, 0],
      PageDown: [page, 0],
    };
    const step = steps[e.key];
    if (step) {
      e.preventDefault();
      const from = e.shiftKey ? selection.focus : active;
      if (meta) {
        // Cmd+arrow jumps to the edge of the data, then to the edge of the sheet.
        const lastR = from.r < layout.dataRows - 1 ? layout.dataRows - 1 : rows - 1;
        const lastC = from.c < layout.dataCols - 1 ? layout.dataCols - 1 : cols - 1;
        const target = {
          r: step[0] < 0 ? 0 : step[0] > 0 ? lastR : from.r,
          c: step[1] < 0 ? 0 : step[1] > 0 ? lastC : from.c,
        };
        selectCell(target, e.shiftKey);
      } else move(from, step[0], step[1], e.shiftKey);
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      move(active, 0, e.shiftKey ? -1 : 1, false);
    } else if (e.key === "Home") {
      e.preventDefault();
      selectCell({ r: meta ? 0 : active.r, c: 0 }, e.shiftKey);
    } else if (e.key === "Enter" || e.key === "F2") {
      e.preventDefault();
      startEdit(active, null);
    } else if (e.key === "Escape") {
      props.onSelection({ anchor: active, focus: active });
      props.onEscape();
    } else if (e.key === "Backspace" || e.key === "Delete") {
      e.preventDefault();
      props.onClear();
    } else if (meta && e.key.toLowerCase() === "a") {
      e.preventDefault();
      props.onSelection({ anchor: { r: 0, c: 0 }, focus: { r: rows - 1, c: cols - 1 } });
    } else if (meta && e.key.toLowerCase() === "c") {
      e.preventDefault();
      props.onCopy(false);
    } else if (meta && e.key.toLowerCase() === "x") {
      e.preventDefault();
      props.onCopy(true);
    } else if (meta && e.key.toLowerCase() === "v") {
      e.preventDefault();
      props.onPaste();
    } else if (e.key.length === 1 && !meta) {
      // Typing replaces the cell. Option is allowed: it types @, [ and $ on many keyboards.
      e.preventDefault();
      startEdit(active, e.key);
    }
  };

  // ---- Mouse ----

  const fullCols = rect.r0 === 0 && rect.r1 === rows - 1;
  const fullRows = rect.c0 === 0 && rect.c1 === cols - 1;

  const onMouseDown = (e: ReactMouseEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest(".cell-editor, .col-resize, .row-resize, .fill-handle, .col-menu")) return;
    const hit = hitTest(e.clientX, e.clientY, false);
    e.preventDefault();
    if (editing) {
      if (hit.r >= 0 && hit.c >= 0 && refInsertable(editing)) {
        drag.current = { kind: "ref", anchor: hit };
        insertRef(hit, hit);
        return;
      }
      commitEdit(0, 0);
    }
    scrollRef.current?.focus({ preventScroll: true });
    if (hit.r < 0 && hit.c < 0) {
      props.onSelection({ anchor: { r: 0, c: 0 }, focus: { r: rows - 1, c: cols - 1 } });
    } else if (hit.r < 0) {
      const start = e.shiftKey && fullCols ? selection.anchor.c : hit.c;
      props.onSelection({ anchor: { r: 0, c: start }, focus: { r: rows - 1, c: hit.c } });
      drag.current = { kind: "cols", start };
    } else if (hit.c < 0) {
      const start = e.shiftKey && fullRows ? selection.anchor.r : hit.r;
      props.onSelection({ anchor: { r: start, c: 0 }, focus: { r: hit.r, c: cols - 1 } });
      drag.current = { kind: "rows", start };
    } else {
      if (e.shiftKey) props.onSelection({ anchor: selection.anchor, focus: hit });
      else selectCell(hit, false);
      drag.current = { kind: "cells" };
    }
  };

  const onDoubleClick = (e: ReactMouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest(".cell-editor, .col-resize, .row-resize, .fill-handle, .col-menu")) return;
    const hit = hitTest(e.clientX, e.clientY, false);
    if (hit.r >= 0 && hit.c >= 0) startEdit(hit, null);
  };

  const onContextMenu = (e: ReactMouseEvent) => {
    e.preventDefault();
    if (editing) commitEdit(0, 0);
    const hit = hitTest(e.clientX, e.clientY, false);
    if (hit.r < 0 && hit.c < 0) return;
    if (hit.r < 0) {
      if (!(fullCols && hit.c >= rect.c0 && hit.c <= rect.c1))
        props.onSelection({ anchor: { r: 0, c: hit.c }, focus: { r: rows - 1, c: hit.c } });
      props.onColumnMenu(e, hit.c);
    } else if (hit.c < 0) {
      if (!(fullRows && hit.r >= rect.r0 && hit.r <= rect.r1))
        props.onSelection({ anchor: { r: hit.r, c: 0 }, focus: { r: hit.r, c: cols - 1 } });
      props.onRowMenu(e, hit.r);
    } else {
      if (!(hit.r >= rect.r0 && hit.r <= rect.r1 && hit.c >= rect.c0 && hit.c <= rect.c1)) selectCell(hit, false);
      props.onCellMenu(e);
    }
  };

  const autoFitColumn = (col: number) => {
    let width = textWidth(columnName(col), `11px ${FONT_FAMILY}`) + 24;
    for (const row of cache.current.values()) {
      const cell = row.cells[col];
      if (!cell || !cell[0]) continue;
      const st = styles.current.get(cell[1]);
      const px = st && st.size !== baseSize ? (13 * st.size) / baseSize : 13;
      const longest = cell[0].split("\n").reduce((a, b) => (b.length > a.length ? b : a), "");
      width = Math.max(width, textWidth(longest, `${st?.i ? "italic " : ""}${st?.b ? "600 " : ""}${px}px ${FONT_FAMILY}`) + 16);
    }
    const count = fullCols && col >= rect.c0 && col <= rect.c1 ? rect.c1 - rect.c0 + 1 : 1;
    props.onColWidth(count > 1 ? rect.c0 : col, count, Math.min(600, Math.ceil(width)));
  };

  // Drags continue outside the grid, so they are tracked on the window.
  const latest = useRef({ hitTest, props, rows, cols, insertRef, rect, fullCols, fullRows, fillTarget });
  latest.current = { hitTest, props, rows, cols, insertRef, rect, fullCols, fullRows, fillTarget };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = drag.current;
      if (!d) return;
      const g = latest.current;
      if (d.kind === "colResize") {
        setColOverride({ col: d.col, width: Math.max(MIN_COL, Math.round(d.startWidth + e.clientX - d.startX)) });
        return;
      }
      if (d.kind === "rowResize") {
        setRowOverride({ pos: d.pos, height: Math.max(MIN_ROW, Math.round(d.startHeight + e.clientY - d.startY)) });
        return;
      }
      const el = scrollRef.current;
      if (el) {
        const box = el.getBoundingClientRect();
        if (e.clientY > box.bottom - 12) el.scrollTop += 24;
        else if (e.clientY < box.top + HEAD_H + 12) el.scrollTop -= 24;
        if (e.clientX > box.right - 12) el.scrollLeft += 24;
        else if (e.clientX < box.left + 40) el.scrollLeft -= 24;
      }
      const hit = g.hitTest(e.clientX, e.clientY, true);
      const sel = g.props.selection;
      if (d.kind === "cells") {
        if (hit.r !== sel.focus.r || hit.c !== sel.focus.c) g.props.onSelection({ anchor: sel.anchor, focus: hit });
      } else if (d.kind === "cols") {
        g.props.onSelection({ anchor: { r: 0, c: d.start }, focus: { r: g.rows - 1, c: hit.c } });
      } else if (d.kind === "rows") {
        g.props.onSelection({ anchor: { r: d.start, c: 0 }, focus: { r: hit.r, c: g.cols - 1 } });
      } else if (d.kind === "ref") {
        g.insertRef(d.anchor, hit);
      } else if (d.kind === "fill") {
        const r = d.rect;
        const dv = hit.r > r.r1 ? hit.r - r.r1 : hit.r < r.r0 ? r.r0 - hit.r : 0;
        const dh = hit.c > r.c1 ? hit.c - r.c1 : hit.c < r.c0 ? r.c0 - hit.c : 0;
        if (dv === 0 && dh === 0) setFillTarget(null);
        else if (dv >= dh) setFillTarget({ ...r, r0: Math.min(r.r0, hit.r), r1: Math.max(r.r1, hit.r) });
        else setFillTarget({ ...r, c0: Math.min(r.c0, hit.c), c1: Math.max(r.c1, hit.c) });
      }
    };
    const onUp = () => {
      const d = drag.current;
      drag.current = null;
      if (!d) return;
      const g = latest.current;
      document.body.classList.remove("col-resizing", "row-resizing");
      if (d.kind === "fill") {
        const t = g.fillTarget;
        setFillTarget(null);
        if (!t) return;
        const r = d.rect;
        if (t.r0 !== r.r0 || t.r1 !== r.r1) g.props.onAutofill(r, t.r0 < r.r0 ? t.r0 : t.r1, true);
        else if (t.c0 !== r.c0 || t.c1 !== r.c1) g.props.onAutofill(r, t.c0 < r.c0 ? t.c0 : t.c1, false);
      } else if (d.kind === "colResize") {
        setColOverride((o) => {
          if (o && o.width !== d.startWidth) {
            const many = g.fullCols && d.col >= g.rect.c0 && d.col <= g.rect.c1;
            g.props.onColWidth(many ? g.rect.c0 : d.col, many ? g.rect.c1 - g.rect.c0 + 1 : 1, o.width);
          }
          return o;
        });
      } else if (d.kind === "rowResize") {
        setRowOverride((o) => {
          if (o && o.height !== d.startHeight) {
            const many = g.fullRows && d.pos >= g.rect.r0 && d.pos <= g.rect.r1;
            g.props.onRowHeight(many ? g.rect.r0 : d.pos, many ? g.rect.r1 - g.rect.r0 + 1 : 1, o.height);
          }
          return o;
        });
      } else if (d.kind === "ref") {
        requestAnimationFrame(() => editorRef.current?.focus());
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  // ---- Rendering ----

  const layerBounds: Record<Layer, [number, number, number, number]> = {
    main: [f, rows - 1, fc, cols - 1],
    top: [0, f - 1, fc, cols - 1],
    left: [f, rows - 1, 0, fc - 1],
    corner: [0, f - 1, 0, fc - 1],
  };
  const layerOf = (p: number, c: number): Layer => (p < f ? (c < fc ? "corner" : "top") : c < fc ? "left" : "main");
  const yIn = (layer: Layer, p: number) => (layer === "left" ? rowTops[p] - frozenH : HEAD_H + rowTops[p]);

  const cellElement = (layer: Layer, p: number, c: number, width: number, height: number, cell: CellOut | null, cover: boolean) => {
    const [text, sid, kind] = cell ?? ["", 0, 0];
    const st = cell ? styles.current.get(sid) : undefined;
    const colors = cellColors(st, dark);
    const h = st?.h || (kind === 1 ? "right" : kind === 3 || kind === 4 ? "center" : "left");
    const css: CSSProperties = {
      left: colLeft[c],
      top: yIn(layer, p),
      width,
      height,
      color: colors.color,
      background: colors.background ?? (cover ? "var(--layer-bg)" : undefined),
      justifyContent: h === "right" ? "flex-end" : h === "center" ? "center" : "flex-start",
      textAlign: h,
    };
    if (st) {
      if (st.size !== baseSize) css.fontSize = Math.round(((13 * st.size) / baseSize) * 10) / 10;
      if (st.b) css.fontWeight = 600;
      if (st.i) css.fontStyle = "italic";
      const decoration = [st.u && "underline", st.s && "line-through"].filter(Boolean).join(" ");
      if (decoration) css.textDecoration = decoration;
      css.boxShadow = borderShadows(st, dark);
    }
    const v = st?.v ?? "bottom";
    return (
      <div key={`c${p}:${c}`} className={`cell v-${v}${st?.wrap ? " wrap" : ""}`} style={css}>
        {text}
      </div>
    );
  };

  const renderLayer = (layer: Layer, r0: number, r1: number, c0: number, c1: number, out: ReactNode[]) => {
    if (r0 > r1 || c0 > c1) return;
    if (layout.gridLines) {
      const xs = colLeft[c0];
      const xe = colLeft[c1 + 1];
      for (let p = r0; p <= r1; p++) {
        const h = rowH(p);
        if (h) out.push(<div key={`h${p}`} className="gl" style={{ left: xs, top: yIn(layer, p) + h - 1, width: xe - xs, height: 1 }} />);
      }
      const ys = yIn(layer, r0);
      const ye = yIn(layer, r1) + rowH(r1);
      for (let c = c0; c <= c1; c++) {
        const w = colW(c);
        if (w) out.push(<div key={`v${c}`} className="gl" style={{ left: colLeft[c] + w - 1, top: ys, width: 1, height: ye - ys }} />);
      }
    }
    const lastInLayer = layer === "left" || layer === "corner" ? fc - 1 : cols - 1;
    const drawn = new Set<number>();
    for (let p = r0; p <= r1; p++) {
      const h = rowH(p);
      if (!h) continue;
      const row = cache.current.get(p);
      for (let c = c0; c <= c1; c++) {
        const key = p * KEY + c;
        const w = colW(c);
        if (!w || merges.covered.has(key)) continue;
        const cell = row?.cells[c] ?? null;
        const span = merges.anchors.get(key);
        if (span) {
          drawn.add(key);
          out.push(cellElement(layer, p, c, colLeft[c + span[1]] - colLeft[c], rowTops[p + span[0]] - rowTops[p], cell, true));
          continue;
        }
        if (!cell) continue;
        // Text runs on over empty cells to the right, as in Excel.
        let width = w;
        const st = styles.current.get(cell[1]);
        if (cell[2] === 2 && !st?.wrap && (!st?.h || st.h === "left")) {
          const px = st && st.size !== baseSize ? (13 * st.size) / baseSize : 13;
          const need = textWidth(cell[0], `${st?.i ? "italic " : ""}${st?.b ? "600 " : ""}${px}px ${FONT_FAMILY}`) + 12;
          let next = c + 1;
          const limit = Math.min(lastInLayer, c1 + 20);
          while (width < need && next <= limit && !row?.cells[next] && !merges.covered.has(p * KEY + next) && !merges.anchors.has(p * KEY + next)) {
            width += colW(next);
            next++;
          }
        }
        out.push(cellElement(layer, p, c, width, h, cell, width > w));
      }
    }
    // Merged cells that start above or left of what is drawn.
    for (const [r, c, hh, ww] of layout.merges) {
      const key = r * KEY + c;
      if (drawn.has(key) || layerOf(r, c) !== layer) continue;
      if (r + hh - 1 < r0 || r > r1 || c + ww - 1 < c0 || c > c1) continue;
      out.push(cellElement(layer, r, c, colLeft[c + ww] - colLeft[c], rowTops[r + hh] - rowTops[r], cache.current.get(r)?.cells[c] ?? null, true));
    }
  };

  /** The part of `area` inside a layer, drawn with edges only where the area ends. */
  const overlay = (layer: Layer, area: Rect, className: string, key: string, extra?: CSSProperties) => {
    const [lr0, lr1, lc0, lc1] = layerBounds[layer];
    const r0 = Math.max(area.r0, lr0);
    const r1 = Math.min(area.r1, lr1);
    const c0 = Math.max(area.c0, lc0);
    const c1 = Math.min(area.c1, lc1);
    if (r0 > r1 || c0 > c1) return null;
    return (
      <div
        key={key}
        className={className}
        style={{
          left: colLeft[c0],
          top: yIn(layer, r0),
          width: colLeft[c1 + 1] - colLeft[c0],
          height: rowTops[r1 + 1] - rowTops[r0],
          borderTopWidth: r0 === area.r0 ? undefined : 0,
          borderBottomWidth: r1 === area.r1 ? undefined : 0,
          borderLeftWidth: c0 === area.c0 ? undefined : 0,
          borderRightWidth: c1 === area.c1 ? undefined : 0,
          ...extra,
        }}
      />
    );
  };

  const single = rect.r0 === rect.r1 && rect.c0 === rect.c1;
  const activeMerge = mergeAt(active);
  const activeRect = activeMerge ?? { r0: active.r, c0: active.c, r1: active.r, c1: active.c };
  const selectionIsMerge = activeMerge && rect.r0 === activeMerge.r0 && rect.r1 === activeMerge.r1 && rect.c0 === activeMerge.c0 && rect.c1 === activeMerge.c1;

  const overlays = (layer: Layer, out: ReactNode[]) => {
    const parts = [
      single || selectionIsMerge ? null : overlay(layer, rect, "sel-range", "sel"),
      overlay(layer, activeRect, "sel-active", "act"),
      props.copied && overlay(layer, props.copied, "copied-range", "copied"),
      fillTarget && overlay(layer, fillTarget, "fill-preview", "fill"),
      refRange && editing && overlay(layer, refRange, "ref-range", "ref"),
    ];
    out.push(...parts.filter(Boolean));
    if (!editing && props.canFill && layerOf(rect.r1, rect.c1) === layer && rect.r1 < rows && rect.c1 < cols) {
      out.push(
        <div
          key="handle"
          className="fill-handle"
          style={{ left: colLeft[rect.c1 + 1] - 4, top: yIn(layer, rect.r1) + rowH(rect.r1) - 4 }}
          onMouseDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            e.stopPropagation();
            drag.current = { kind: "fill", rect };
          }}
        />,
      );
    }
    if (editing && layerOf(editing.cell.r, editing.cell.c) === layer) {
      const m = mergeAt(editing.cell);
      const cellRect = m ?? { r0: editing.cell.r, c0: editing.cell.c, r1: editing.cell.r, c1: editing.cell.c };
      const width = colLeft[cellRect.c1 + 1] - colLeft[cellRect.c0];
      const height = rowTops[cellRect.r1 + 1] - rowTops[cellRect.r0];
      const lines = editing.value.split("\n");
      const longest = lines.reduce((a, b) => (b.length > a.length ? b : a), "");
      out.push(
        <textarea
          key="editor"
          ref={editorRef}
          className="cell-editor"
          autoFocus
          spellCheck={false}
          rows={1}
          style={{
            left: colLeft[cellRect.c0],
            top: yIn(layer, cellRect.r0),
            width: Math.min(640, Math.max(width, textWidth(longest, `13px ${FONT_FAMILY}`) + 28)),
            height: Math.max(height, lines.length * 17 + 8),
          }}
          value={editing.value}
          onChange={(e) => setEditing({ ...editing, value: e.target.value, ref: null })}
          onBlur={() => {
            // A click that inserts a reference keeps the editor open.
            if (drag.current?.kind !== "ref") commitEdit(0, 0);
          }}
          onKeyDown={onEditorKey}
        />,
      );
    }
  };

  const startColResize = (e: ReactMouseEvent, col: number) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    document.body.classList.add("col-resizing");
    drag.current = { kind: "colResize", col, startX: e.clientX, startWidth: colW(col) };
  };

  const startRowResize = (e: ReactMouseEvent, pos: number) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    document.body.classList.add("row-resizing");
    drag.current = { kind: "rowResize", pos, startY: e.clientY, startHeight: rowH(pos) };
  };

  const sortOf = new Map(layout.sort.map((k, i) => [k.col, { ...k, index: i }]));
  const filtered = new Set(layout.valueFilters.map(([c]) => c));

  const colHead = (c: number) => {
    const w = colW(c);
    const hiddenBefore = c > 0 && colW(c - 1) === 0;
    if (!w)
      return hiddenBefore ? null : <div key={`ch${c}`} className="hidden-mark col" style={{ left: colLeft[c] - 2 }} title="Hidden columns" />;
    const sorted = sortOf.get(c);
    const selected = c >= rect.c0 && c <= rect.c1;
    return (
      <div
        key={`ch${c}`}
        className={`col-head${selected ? (fullCols ? " full" : " selected") : ""}`}
        style={{ left: colLeft[c], width: w }}
      >
        {hiddenBefore && <span className="hidden-mark-inline col" />}
        <span className="col-letter">{columnName(c)}</span>
        {sorted &&
          (sorted.desc ? <ArrowDown size={11} className="sort-icon" /> : <ArrowUp size={11} className="sort-icon" />)}
        {sorted && layout.sort.length > 1 && <span className="sort-index">{sorted.index + 1}</span>}
        {filtered.has(c) && <Filter size={10} className="sort-icon" />}
        <button
          type="button"
          className="col-menu"
          tabIndex={-1}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            if (!(fullCols && c >= rect.c0 && c <= rect.c1)) props.onSelection({ anchor: { r: 0, c }, focus: { r: rows - 1, c } });
            props.onColumnMenu(e, c);
          }}
        >
          <ChevronDown size={11} />
        </button>
        <span className="col-resize" onMouseDown={(e) => startColResize(e, c)} onDoubleClick={() => autoFitColumn(c)} />
      </div>
    );
  };

  const rowHead = (layer: Layer, p: number) => {
    const h = rowH(p);
    const y = yIn(layer, p);
    const hiddenBefore = p > 0 && rowH(p - 1) === 0;
    if (!h) return null;
    const selected = p >= rect.r0 && p <= rect.r1;
    return (
      <div
        key={`rh${p}`}
        className={`row-num${selected ? (fullRows ? " full" : " selected") : ""}${hiddenBefore ? " after-hidden" : ""}`}
        style={{ top: y, height: h, width: rowNumW, lineHeight: `${Math.min(h, layout.defaultRow)}px` }}
      >
        {label(p)}
        <span className="row-resize" onMouseDown={(e) => startRowResize(e, p)} onDoubleClick={() => props.onRowHeight(p, 1, layout.defaultRow)} />
      </div>
    );
  };

  const main: ReactNode[] = [];
  const top: ReactNode[] = [];
  const left: ReactNode[] = [];
  const corner: ReactNode[] = [];

  renderLayer("main", firstRow, lastRow, firstCol, lastCol, main);
  overlays("main", main);
  renderLayer("top", 0, f - 1, firstCol, lastCol, top);
  overlays("top", top);
  renderLayer("left", firstRow, lastRow, 0, fc - 1, left);
  overlays("left", left);
  renderLayer("corner", 0, f - 1, 0, fc - 1, corner);
  overlays("corner", corner);

  const heads: ReactNode[] = [];
  for (let c = firstCol; c <= lastCol; c++) heads.push(colHead(c));
  const frozenHeads: ReactNode[] = [];
  for (let c = 0; c < fc; c++) frozenHeads.push(colHead(c));
  const rowHeads: ReactNode[] = [];
  for (let p = firstRow; p <= lastRow; p++) rowHeads.push(rowHead("left", p));
  const frozenRowHeads: ReactNode[] = [];
  for (let p = 0; p < f; p++) frozenRowHeads.push(rowHead("corner", p));

  return (
    <div
      ref={scrollRef}
      className={`grid-scroll${layout.gridLines ? "" : " no-grid"}`}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      onScroll={(e) => {
        const el = e.currentTarget;
        setViewport({ top: el.scrollTop, left: el.scrollLeft, width: el.clientWidth, height: el.clientHeight });
      }}
    >
      <div className="grid-canvas" style={{ width: totalW, height: HEAD_H + totalH }}>
        <div className={`layer-top${f > 0 ? " frozen" : ""}`} style={{ height: HEAD_H + frozenH }}>
          <div className={`layer-corner${fc > 0 ? " frozen" : ""}`} style={{ width: rowNumW + frozenW, height: HEAD_H + frozenH }}>
            <div className="corner" style={{ width: rowNumW, height: HEAD_H }} title="Select all" />
            {frozenHeads}
            {frozenRowHeads}
            {corner}
          </div>
          <div className="col-heads" style={{ height: HEAD_H }} />
          {heads}
          {top}
        </div>
        <div className={`layer-left${fc > 0 ? " frozen" : ""}`} style={{ width: rowNumW + frozenW }}>
          {fc > 0 && (
            <div
              className="frozen-bg"
              style={{ left: rowNumW, top: rowTops[firstRow] - frozenH, width: frozenW, height: rowTops[lastRow + 1] - rowTops[firstRow] }}
            />
          )}
          {rowHeads}
          {left}
        </div>
        {main}
      </div>
    </div>
  );
}
