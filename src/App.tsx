import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { open as openFileDialog, save as saveFileDialog } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  ArrowDownAZ,
  ArrowDownToLine,
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUpDown,
  ArrowUpZA,
  BetweenHorizontalEnd,
  BetweenHorizontalStart,
  BetweenVerticalEnd,
  BetweenVerticalStart,
  ClipboardPaste,
  Copy,
  CopyPlus,
  Eraser,
  Eye,
  EyeOff,
  FilePlus2,
  FileSpreadsheet,
  FolderOpen,
  Link,
  ListFilter,
  Moon,
  MoveDown,
  MoveLeft,
  MoveRight,
  MoveUp,
  Palette,
  Pencil,
  Pin,
  PinOff,
  RemoveFormatting,
  Save,
  Scissors,
  SquareFunction,
  Sun,
  TableCellsMerge,
  TableCellsSplit,
  Trash2,
  TriangleAlert,
  X,
  Cat,
  BrandMark,
} from "./components/icons";
import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import {
  api,
  columnIndex,
  columnName,
  OPEN_EXTENSIONS,
  toAppError,
  type CellInfo,
  type DocInfo,
  type Edit,
  type FindOptions,
  type Layout,
  type Rect,
  type RecentItem,
  type SortKey,
  type Stats,
} from "./api";
import { ContextMenu, type MenuEntry, type MenuState } from "./components/ContextMenu";
import { ChoiceDialog, GoogleDialog, InputDialog, SortDialog } from "./components/Dialogs";
import { FindBar } from "./components/FindBar";
import { Grid, selectionRect, type Cell, type Selection } from "./components/Grid";
import { SheetTabs } from "./components/SheetTabs";
import { MemeButton } from "./components/Meme";
import { UpdateButton } from "./components/Update";
import { WindowSnap } from "./components/WindowSnap";
import { RecentIcon, RecentPanel, SidebarIcon, folderOf, type SidebarIconName } from "./components/Sidebar";
import { Toolbar, ViewControls } from "./components/Toolbar";
import { ACCENT_KEY, ACCENTS, savedAccent, type AccentId } from "./lib/accent";
import appIcon from "../src-tauri/icons/128x128@2x.png";
import { ValueFilter } from "./components/ValueFilter";

const THEME_KEY = "cells.theme";
const SIDE_KEY = "cells.sideWidth";
const PANEL_KEY = "cells.panel";
const COMPACT_KEY = "cells.compactBar";
const MEMES_KEY = "cells.memes";

type Panel = "recent";

type Theme = "dark" | "light";
type DialogState =
  | { type: "google" }
  | { type: "input"; title: string; label: string; initial: string; confirm: string; onConfirm: (value: string) => void }
  | { type: "sort"; columns: { index: number; name: string }[] }
  | { type: "choice"; title: string; message: ReactNode; actions: { label: string; kind?: "primary" | "danger-ghost"; onClick: () => void }[] };

interface Toast {
  id: number;
  kind: "info" | "error";
  message: string;
}

interface FindState {
  open: boolean;
  options: FindOptions;
  matches: [number, number][] | null;
  index: number;
  token: number;
}

const ORIGIN: Selection = { anchor: { r: 0, c: 0 }, focus: { r: 0, c: 0 } };
const LAST_ROW = 1_048_576;
const LAST_COL = 16_384;
const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 });
const countFormat = new Intl.NumberFormat();

function extensionOf(path: string): string {
  return path.split(".").pop()?.toLowerCase() ?? "";
}

function focusGrid() {
  (document.querySelector(".grid-scroll") as HTMLElement | null)?.focus({ preventScroll: true });
}

/** "tables, charts and comments" */
function listText(items: string[]): string {
  return items.length < 2 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function plural(n: number, one: string, many: string) {
  return n === 1 ? `1 ${one}` : `${countFormat.format(n)} ${many}`;
}

export default function App() {
  const [doc, setDoc] = useState<DocInfo | null>(null);
  const [sheet, setSheet] = useState(0);
  const [layout, setLayout] = useState<Layout | null>(null);
  const [version, setVersion] = useState(0);
  const [selection, setSelection] = useState<Selection>(ORIGIN);
  const [activeInfo, setActiveInfo] = useState<{ cell: Cell; info: CellInfo } | null>(null);
  const [formulaBar, setFormulaBar] = useState<string | null>(null);
  const [addressInput, setAddressInput] = useState<string | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [copied, setCopied] = useState<Rect | null>(null);
  const [filterInput, setFilterInput] = useState("");
  const [find, setFind] = useState<FindState>({
    open: false,
    options: { query: "", matchCase: false, wholeCell: false },
    matches: null,
    index: 0,
    token: 0,
  });
  const [valueFilter, setValueFilter] = useState<{ col: number; anchor: DOMRect; values: [string, number][] | null } | null>(null);
  const [reveal, setReveal] = useState<{ cell: Cell; token: number } | null>(null);
  const [renameRequest, setRenameRequest] = useState<{ index: number; token: number } | null>(null);
  const [noticeClosed, setNoticeClosed] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecentItem[]>([]);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [dropping, setDropping] = useState(false);
  const [theme, setTheme] = useState<Theme>(() => (document.documentElement.dataset.theme === "light" ? "light" : "dark"));
  const [accent, setAccent] = useState<AccentId>(savedAccent);
  const [themeSwitched, setThemeSwitched] = useState(false);
  const [panel, setPanel] = useState<Panel | null>(() => (localStorage.getItem(PANEL_KEY) === "none" ? null : "recent"));
  const [sideWidth, setSideWidth] = useState(() => Number(localStorage.getItem(SIDE_KEY)) || 260);
  const [compact, setCompact] = useState(() => localStorage.getItem(COMPACT_KEY) === "1");
  const [memes, setMemes] = useState(() => localStorage.getItem(MEMES_KEY) !== "0");

  // Event listeners registered once read the latest state through this ref.
  const latest = useRef({ doc, sheet, layout, selection });
  latest.current = { doc, sheet, layout, selection };

  const toast = useCallback((kind: Toast["kind"], message: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, kind, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 8000 : 2500);
  }, []);

  const refreshRecent = useCallback(async () => setRecent(await api.recentList()), []);

  useEffect(() => {
    document.documentElement.dataset.accent = accent;
    localStorage.setItem(ACCENT_KEY, accent);
  }, [accent]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
    void getCurrentWindow().setTheme(theme).catch(() => undefined);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem(PANEL_KEY, panel ?? "none");
  }, [panel]);

  // ---- Layout and data ----

  const refresh = useCallback(async () => {
    const { doc: current, sheet: sh } = latest.current;
    if (!current) return;
    try {
      setLayout(await api.layout(current.id, sh));
      setVersion((v) => v + 1);
    } catch (e) {
      toast("error", toAppError(e).message);
    }
  }, [toast]);

  useEffect(() => {
    if (!doc) {
      setLayout(null);
      return;
    }
    let current = true;
    void api
      .layout(doc.id, sheet)
      .then((l) => {
        if (!current) return;
        setLayout(l);
        setFilterInput(l.filter);
        setVersion((v) => v + 1);
      })
      .catch((e) => toast("error", toAppError(e).message));
    return () => {
      current = false;
    };
  }, [doc?.id, sheet, toast]);

  const viewActive = !!layout && (layout.sort.length > 0 || layout.filter.trim() !== "" || layout.valueFilters.length > 0);

  const setView = async (sort: SortKey[], filter: string, values: [number, string[]][]) => {
    const { doc: current, sheet: sh } = latest.current;
    if (!current) return;
    setBusy(sort.length || filter || values.length ? "Sorting and filtering" : null);
    try {
      await api.setView(current.id, sh, sort, filter, values);
      await refresh();
    } catch (e) {
      toast("error", toAppError(e).message);
    } finally {
      setBusy(null);
    }
  };

  // The text filter waits for a pause in typing.
  useEffect(() => {
    if (!layout || filterInput === layout.filter) return;
    const timer = setTimeout(() => void setView(layout.sort, filterInput, layout.valueFilters), 250);
    return () => clearTimeout(timer);
  }, [filterInput, layout]);

  // ---- Editing ----

  /** The selection, without the blank rows and columns of a whole-column or whole-row selection. */
  const opRect = (sel: Selection = latest.current.selection): Rect => {
    const r = selectionRect(sel);
    const l = latest.current.layout;
    if (!l) return r;
    return {
      r0: r.r0,
      c0: r.c0,
      r1: r.r1 >= l.rows - 1 ? Math.max(r.r0, l.dataRows - 1) : r.r1,
      c1: r.c1 >= l.cols - 1 ? Math.max(r.c0, l.dataCols - 1) : r.c1,
    };
  };

  /** For styles: whole columns or rows are sent as such, so the style goes on
   * the column or row instead of on every cell. */
  const styleRect = (): Rect => {
    const r = selectionRect(latest.current.selection);
    const l = latest.current.layout;
    if (!l) return r;
    const view = l.sort.length > 0 || l.filter.trim() !== "" || l.valueFilters.length > 0;
    const wholeColumns = r.r0 === 0 && r.r1 >= l.rows - 1 && !view;
    const wholeRows = r.c0 === 0 && r.c1 >= l.cols - 1;
    return { r0: r.r0, c0: r.c0, r1: wholeColumns ? LAST_ROW - 1 : r.r1, c1: wholeRows ? LAST_COL - 1 : r.c1 };
  };

  const runEdit = async (edit: Edit) => {
    const { doc: current, sheet: sh } = latest.current;
    if (!current) return null;
    try {
      const result = await api.edit(current.id, sh, edit);
      setDoc(result.doc);
      const next = result.outcome.sheet;
      if (next !== null && next !== sh) {
        setSheet(next);
        setSelection(ORIGIN);
      } else await refresh();
      const s = result.outcome.select;
      if (s) setSelection({ anchor: { r: s.r0, c: s.c0 }, focus: { r: s.r1, c: s.c1 } });
      if (result.outcome.clipUsed) setCopied(null);
      return result;
    } catch (e) {
      toast("error", toAppError(e).message);
      return null;
    }
  };

  const replay = async (undo: boolean) => {
    const current = latest.current.doc;
    if (!current) return;
    try {
      const info = await (undo ? api.undo(current.id) : api.redo(current.id));
      setDoc(info);
      if (latest.current.sheet >= info.sheets.length || info.sheets[latest.current.sheet]?.hidden) {
        setSheet(Math.max(0, info.sheets.findIndex((s) => !s.hidden)));
      } else await refresh();
    } catch (e) {
      toast("error", toAppError(e).message);
    }
  };

  const copySelection = async (cut: boolean) => {
    const current = latest.current.doc;
    if (!current) return;
    const rect = opRect();
    try {
      await writeText(await api.copy(current.id, latest.current.sheet, rect, cut));
      setCopied(rect);
    } catch (e) {
      toast("error", toAppError(e).message);
    }
  };

  const paste = async () => {
    const text = (await readText().catch(() => "")) ?? "";
    if (!text) return;
    await runEdit({ op: "paste", rect: opRect(), text });
  };

  const style = (path: string, value: string) => void runEdit({ op: "style", rect: styleRect(), path, value });

  // ---- Opening ----

  const loadDoc = useCallback(
    async (load: () => Promise<DocInfo>) => {
      setBusy("Opening");
      try {
        const info = await load();
        const previous = latest.current.doc;
        if (previous && previous.id !== info.id) void api.closeDoc(previous.id);
        setDoc(info);
        setSheet(Math.max(0, info.sheets.findIndex((s) => !s.hidden)));
        setSelection(ORIGIN);
        setCopied(null);
        setStats(null);
        setFind((f) => ({ ...f, open: false, matches: null }));
        void refreshRecent();
        return null;
      } catch (e) {
        return toAppError(e).message;
      } finally {
        setBusy(null);
      }
    },
    [refreshRecent],
  );

  /** Runs `then`, first asking what to do with unsaved changes. */
  const guardUnsaved = useCallback((then: () => void) => {
    const current = latest.current.doc;
    if (!current?.dirty) {
      then();
      return;
    }
    setDialog({
      type: "choice",
      title: `Save changes to "${current.title}"?`,
      message: "Your changes are lost if you don't save them.",
      actions: [
        {
          label: "Don't Save",
          kind: "danger-ghost",
          onClick: () => {
            setDialog(null);
            then();
          },
        },
        {
          label: current.canSave ? "Save" : "Save As",
          kind: "primary",
          onClick: async () => {
            setDialog(null);
            if (await saveRef.current()) then();
          },
        },
      ],
    });
  }, []);

  const openPath = useCallback(
    (path: string) =>
      guardUnsaved(async () => {
        const error = await loadDoc(() => api.openPath(path));
        if (error) toast("error", error);
      }),
    [guardUnsaved, loadDoc, toast],
  );

  const openFile = () =>
    guardUnsaved(async () => {
      const path = await openFileDialog({
        multiple: false,
        directory: false,
        filters: [{ name: "Spreadsheets", extensions: OPEN_EXTENSIONS }],
      });
      if (typeof path === "string") {
        const error = await loadDoc(() => api.openPath(path));
        if (error) toast("error", error);
      }
    });

  const newDoc = () =>
    guardUnsaved(async () => {
      const error = await loadDoc(() => api.newDoc());
      if (error) toast("error", error);
    });

  const openRecent = (item: RecentItem) =>
    guardUnsaved(async () => {
      const error = await loadDoc(() => (item.kind === "google" ? api.openGoogle(item.location) : api.openPath(item.location)));
      if (error) toast("error", error);
    });

  // Files opened from Finder, and files dropped on the window.
  useEffect(() => {
    void refreshRecent();
    const openPending = async () => {
      const paths = await api.takePendingOpens();
      // The newest file wins when several arrived at once.
      const path = paths[paths.length - 1];
      if (path) openPath(path);
    };
    // Listen first, then take what is already waiting, so a file that arrives in between is not missed.
    const unlistenOpen = listen("open-paths", () => void openPending());
    void unlistenOpen.then(() => openPending());
    const unlistenDrop = getCurrentWebview().onDragDropEvent((event) => {
      const p = event.payload;
      if (p.type === "enter" || p.type === "over") setDropping(true);
      else if (p.type === "leave") setDropping(false);
      else if (p.type === "drop") {
        setDropping(false);
        const path = p.paths.find((x) => OPEN_EXTENSIONS.includes(extensionOf(x)));
        if (path) openPath(path);
        else if (p.paths.length) toast("error", "Cells opens CSV, Excel, OpenDocument and .gsheet files.");
      }
    });
    const unlistenClose = getCurrentWindow().onCloseRequested((event) => {
      if (!latest.current.doc?.dirty) return;
      event.preventDefault();
      guardUnsaved(() => void getCurrentWindow().destroy());
    });
    return () => {
      void unlistenOpen.then((f) => f());
      void unlistenDrop.then((f) => f());
      void unlistenClose.then((f) => f());
    };
  }, []);

  // ---- Saving ----

  const writeAs = async (path: string): Promise<boolean> => {
    const current = latest.current.doc;
    if (!current) return false;
    setBusy("Saving");
    try {
      const info = await api.saveAs(current.id, path, latest.current.sheet);
      setDoc(info);
      if (info.sheets.length !== current.sheets.length) setSheet(0);
      else await refresh();
      void refreshRecent();
      toast("info", `Saved ${info.title}`);
      return true;
    } catch (e) {
      toast("error", toAppError(e).message);
      return false;
    } finally {
      setBusy(null);
    }
  };

  const saveAs = async (): Promise<boolean> => {
    const current = latest.current.doc;
    if (!current) return false;
    const base = current.title.replace(/\.[^.]+$/, "");
    const dir = current.location.startsWith("/") ? current.location.slice(0, current.location.lastIndexOf("/") + 1) : "";
    const path = await saveFileDialog({
      defaultPath: `${dir}${base}.xlsx`,
      filters: [
        { name: "Excel workbook", extensions: ["xlsx"] },
        { name: "CSV", extensions: ["csv"] },
        { name: "Tab separated", extensions: ["tsv"] },
      ],
    });
    if (!path) return false;
    const ext = extensionOf(path);
    const visible = current.sheets.filter((s) => !s.hidden).length;
    if ((ext === "csv" || ext === "tsv") && (visible > 1 || current.kind.startsWith("Excel") || current.kind === "New")) {
      const name = current.sheets[latest.current.sheet]?.name ?? "";
      return new Promise((resolve) =>
        setDialog({
          type: "choice",
          title: "Save as CSV?",
          message: `A CSV file holds the values of one sheet. Cells saves "${name}" without formulas and formatting, and then shows the saved file. Save as Excel to keep everything.`,
          actions: [
            {
              label: "Save as CSV",
              kind: "primary",
              onClick: async () => {
                setDialog(null);
                resolve(await writeAs(path));
              },
            },
          ],
        }),
      );
    }
    return writeAs(path);
  };

  const save = async (): Promise<boolean> => {
    const current = latest.current.doc;
    if (!current) return false;
    if (!current.canSave) return saveAs();
    const write = async () => {
      setBusy("Saving");
      try {
        setDoc(await api.save(current.id));
        toast("info", "Saved");
        return true;
      } catch (e) {
        toast("error", toAppError(e).message);
        return false;
      } finally {
        setBusy(null);
      }
    };
    if (current.notice.unkept.length > 0) {
      return new Promise((resolve) =>
        setDialog({
          type: "choice",
          title: `Save over "${current.title}"?`,
          message: `This file has ${listText(current.notice.unkept)}, which Cells does not keep. Saving over the file removes them. The original goes to the Trash. Save As keeps the original file as it is.`,
          actions: [
            {
              label: "Save Anyway",
              kind: "danger-ghost",
              onClick: async () => {
                setDialog(null);
                resolve(await write());
              },
            },
            {
              label: "Save As…",
              kind: "primary",
              onClick: async () => {
                setDialog(null);
                resolve(await saveAs());
              },
            },
          ],
        }),
      );
    }
    if (current.singleSheet && current.sheets.filter((s) => !s.hidden).length > 1) {
      return new Promise((resolve) =>
        setDialog({
          type: "choice",
          title: "This CSV file has more than one sheet",
          message: `A CSV file holds one sheet, so Save writes only "${current.sheets[0].name}". Save as Excel to keep all sheets.`,
          actions: [
            {
              label: "Save as Excel",
              onClick: async () => {
                setDialog(null);
                resolve(await saveAs());
              },
            },
            {
              label: "Save First Sheet",
              kind: "primary",
              onClick: async () => {
                setDialog(null);
                resolve(await write());
              },
            },
          ],
        }),
      );
    }
    return write();
  };
  const saveRef = useRef(save);
  saveRef.current = save;

  // ---- Find ----

  const selectCell = (cell: Cell) => {
    setSelection({ anchor: cell, focus: cell });
    setReveal({ cell, token: Date.now() });
  };

  const lastQuery = useRef("");
  useEffect(() => {
    if (!doc || !find.open || !find.options.query) {
      setFind((f) => (f.matches ? { ...f, matches: null, index: 0 } : f));
      return;
    }
    const key = JSON.stringify([find.options, sheet]);
    const timer = setTimeout(() => {
      void api.find(doc.id, sheet, find.options).then((matches) => {
        const fresh = lastQuery.current !== key;
        lastQuery.current = key;
        const { anchor } = latest.current.selection;
        setFind((f) => {
          let index = Math.min(f.index, Math.max(0, matches.length - 1));
          if (fresh) {
            const after = matches.findIndex(([r, c]) => r > anchor.r || (r === anchor.r && c >= anchor.c));
            index = after < 0 ? 0 : after;
          }
          return { ...f, matches, index };
        });
        if (fresh && matches.length) {
          const after = matches.findIndex(([r, c]) => r > anchor.r || (r === anchor.r && c >= anchor.c));
          const [r, c] = matches[after < 0 ? 0 : after];
          selectCell({ r, c });
        }
      });
    }, 150);
    return () => clearTimeout(timer);
  }, [find.open, find.options, version, sheet, doc?.id]);

  const stepFind = (direction: 1 | -1) => {
    const n = find.matches?.length ?? 0;
    if (!n) return;
    const index = (find.index + direction + n) % n;
    setFind({ ...find, index });
    const [r, c] = find.matches![index];
    selectCell({ r, c });
  };

  const openFind = () => setFind((f) => ({ ...f, open: true, token: f.token + 1 }));

  // ---- Keyboard ----

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !e.metaKey) return;
      const target = e.target as HTMLElement;
      const inInput = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
      const key = e.key.toLowerCase();
      const hasDoc = !!latest.current.doc;
      if (key === "r") e.preventDefault(); // Cmd+R would reload the web view.
      if (key === "e" && e.shiftKey) {
        e.preventDefault();
        setPanel((p) => (p === "recent" ? null : "recent"));
      } else if (key === "o") {
        e.preventDefault();
        openFile();
      } else if (key === "n") {
        e.preventDefault();
        newDoc();
      } else if (key === "s" && hasDoc) {
        e.preventDefault();
        void (e.shiftKey ? saveAs() : save());
      } else if (key === "f" && hasDoc) {
        e.preventDefault();
        openFind();
      } else if (!inInput && hasDoc) {
        const actions: Record<string, () => void> = {
          z: () => void replay(!e.shiftKey),
          y: () => void replay(false),
          b: () => style("font.b", String(!activeRef.current?.style.b)),
          i: () => style("font.i", String(!activeRef.current?.style.i)),
          u: () => style("font.u", String(!activeRef.current?.style.u)),
          d: () => void runEdit({ op: "fillDown", rect: opRect() }),
          r: () => void runEdit({ op: "fillRight", rect: opRect() }),
        };
        if (e.shiftKey && key === "x") {
          e.preventDefault();
          style("font.strike", String(!activeRef.current?.style.s));
        } else if (actions[key]) {
          e.preventDefault();
          actions[key]();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ---- Active cell and selection stats ----

  const activeRef = useRef<CellInfo | null>(null);
  activeRef.current = activeInfo?.info ?? null;

  useEffect(() => {
    if (!doc || !layout) return;
    const cell = selection.anchor;
    let current = true;
    setFormulaBar(null);
    void api
      .cell(doc.id, sheet, cell.r, cell.c)
      .then((info) => current && setActiveInfo({ cell, info }))
      .catch(() => undefined);
    const rect = opRect();
    const timer = setTimeout(() => {
      if (rect.r0 === rect.r1 && rect.c0 === rect.c1) setStats(null);
      else void api.stats(doc.id, sheet, rect).then((s) => current && setStats(s));
    }, 120);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [selection, version, doc?.id, sheet]);

  const activeMatches = activeInfo && activeInfo.cell.r === selection.anchor.r && activeInfo.cell.c === selection.anchor.c;
  const rowNumber = activeMatches ? activeInfo!.info.row : selection.anchor.r + 1;
  const address = `${columnName(selection.anchor.c)}${rowNumber}`;

  const goToAddress = (text: string) => {
    const m = /^\s*([a-z]{1,3})\s*(\d+)\s*$/i.exec(text);
    if (!m || !layout) {
      toast("error", "Type a cell address like B12");
      return;
    }
    const cell = { r: Math.min(layout.rows - 1, Number(m[2]) - 1), c: Math.min(layout.cols - 1, columnIndex(m[1])) };
    selectCell(cell);
    focusGrid();
  };

  // ---- Menus ----

  const rect = selectionRect(selection);
  const rowCount = rect.r1 - rect.r0 + 1;
  const colCount = rect.c1 - rect.c0 + 1;

  const sortBy = (col: number, desc: boolean) => layout && void setView([{ col, desc }], layout.filter, layout.valueFilters);

  const openValueFilter = (col: number, anchor: DOMRect) => {
    if (!doc) return;
    setValueFilter({ col, anchor, values: null });
    void api.columnValues(doc.id, sheet, col).then((values) => setValueFilter((v) => (v && v.col === col ? { ...v, values } : v)));
  };

  const askNumber = (title: string, label: string, initial: number, apply: (n: number) => void) =>
    setDialog({
      type: "input",
      title,
      label,
      initial: String(Math.round(initial)),
      confirm: "Apply",
      onConfirm: (value) => {
        setDialog(null);
        const n = Number(value.replace(",", "."));
        if (Number.isFinite(n) && n >= 0) apply(n);
        else toast("error", "Type a number");
      },
    });

  const openSortDialog = async () => {
    if (!doc || !layout) return;
    let names: string[] = [];
    if (layout.frozenRows > 0) {
      const head = await api.cells(doc.id, sheet, 0, 1, layout.cols).catch(() => null);
      names = head?.rows[0]?.cells.map((c) => c?.[0] ?? "") ?? [];
    }
    const count = Math.max(1, layout.dataCols);
    setDialog({
      type: "sort",
      columns: Array.from({ length: count }, (_, i) => ({
        index: i,
        name: names[i] ? `${columnName(i)} · ${names[i]}` : `Column ${columnName(i)}`,
      })),
    });
  };

  const freezeMenu = (rows: number | null, cols: number | null): MenuEntry[] => {
    if (!layout) return [];
    const frozenRows = layout.frozenRows;
    const frozenCols = layout.frozenCols;
    const out: MenuEntry[] = [];
    if (rows !== null)
      out.push(
        frozenRows > 0 && rows === frozenRows
          ? { label: "Unfreeze rows", icon: <PinOff size={14} />, onSelect: () => void runEdit({ op: "freeze", rows: 0, cols: frozenCols }) }
          : {
              label: rows === 1 ? "Freeze top row" : `Freeze rows 1 to ${rows}`,
              icon: <Pin size={14} />,
              onSelect: () => void runEdit({ op: "freeze", rows, cols: frozenCols }),
            },
      );
    if (cols !== null)
      out.push(
        frozenCols > 0 && cols === frozenCols
          ? { label: "Unfreeze columns", icon: <PinOff size={14} />, onSelect: () => void runEdit({ op: "freeze", rows: frozenRows, cols: 0 }) }
          : {
              label: cols === 1 ? "Freeze first column" : `Freeze columns A to ${columnName(cols - 1)}`,
              icon: <Pin size={14} />,
              onSelect: () => void runEdit({ op: "freeze", rows: frozenRows, cols }),
            },
      );
    return out;
  };

  const showMenu = (e: ReactMouseEvent, items: MenuEntry[]) => setMenu({ x: e.clientX, y: e.clientY, items });

  const cellMenu = (e: ReactMouseEvent) => {
    const merged = activeRef.current?.merged ?? false;
    const view = viewActive;
    const r = opRect();
    showMenu(e, [
      { label: "Cut", icon: <Scissors size={14} />, shortcut: "⌘X", onSelect: () => void copySelection(true) },
      { label: "Copy", icon: <Copy size={14} />, shortcut: "⌘C", onSelect: () => void copySelection(false) },
      { label: "Paste", icon: <ClipboardPaste size={14} />, shortcut: "⌘V", onSelect: () => void paste() },
      "separator",
      {
        label: rowCount > 1 ? `Insert ${rowCount} rows above` : "Insert row above",
        icon: <BetweenHorizontalStart size={14} />,
        disabled: view,
        onSelect: () => void runEdit({ op: "insertRows", pos: rect.r0, count: rowCount }),
      },
      {
        label: colCount > 1 ? `Insert ${colCount} columns left` : "Insert column left",
        icon: <BetweenVerticalStart size={14} />,
        onSelect: () => void runEdit({ op: "insertCols", col: rect.c0, count: colCount }),
      },
      {
        label: rowCount > 1 ? `Delete ${rowCount} rows` : "Delete row",
        icon: <Trash2 size={14} />,
        disabled: view,
        onSelect: () => void runEdit({ op: "deleteRows", pos: rect.r0, count: rowCount }),
      },
      {
        label: colCount > 1 ? `Delete ${colCount} columns` : "Delete column",
        icon: <Trash2 size={14} />,
        onSelect: () => void runEdit({ op: "deleteCols", col: rect.c0, count: colCount }),
      },
      "separator",
      merged
        ? { label: "Unmerge cells", icon: <TableCellsSplit size={14} />, disabled: view, onSelect: () => void runEdit({ op: "unmerge", rect }) }
        : {
            label: "Merge cells",
            icon: <TableCellsMerge size={14} />,
            disabled: view || (rowCount === 1 && colCount === 1),
            onSelect: () => void runEdit({ op: "merge", rect }),
          },
      { label: "Fill down", icon: <ArrowDownToLine size={14} />, shortcut: "⌘D", disabled: view || rowCount === 1, onSelect: () => void runEdit({ op: "fillDown", rect: r }) },
      { label: "Fill right", icon: <ArrowRightToLine size={14} />, shortcut: "⌘R", disabled: view || colCount === 1, onSelect: () => void runEdit({ op: "fillRight", rect: r }) },
      "separator",
      {
        label: "Show only rows with this value",
        icon: <ListFilter size={14} />,
        disabled: !layout || selection.anchor.r < layout.frozenRows,
        onSelect: () => {
          if (!layout || !doc) return;
          void api.cells(doc.id, sheet, selection.anchor.r, 1, layout.cols).then((out) => {
            const text = out.rows[0]?.cells[selection.anchor.c]?.[0] ?? "";
            const values = layout.valueFilters.filter(([c]) => c !== selection.anchor.c);
            void setView(layout.sort, layout.filter, [...values, [selection.anchor.c, [text]]]);
          });
        },
      },
      "separator",
      { label: "Clear contents", icon: <Eraser size={14} />, shortcut: "⌫", onSelect: () => void runEdit({ op: "clear", rect: r, what: "contents" }) },
      { label: "Clear formatting", icon: <RemoveFormatting size={14} />, onSelect: () => void runEdit({ op: "clear", rect: styleRect(), what: "formatting" }) },
    ]);
  };

  const rowMenu = (e: ReactMouseEvent, pos: number) => {
    if (!layout) return;
    const sel = selectionRect(latest.current.selection);
    const r0 = Math.min(sel.r0, pos);
    const n = Math.max(sel.r1, pos) - r0 + 1;
    const view = viewActive;
    const rows = n > 1 ? `${n} rows` : "row";
    showMenu(e, [
      { label: `Insert ${n > 1 ? `${n} rows` : "row"} above`, icon: <BetweenHorizontalStart size={14} />, disabled: view, onSelect: () => void runEdit({ op: "insertRows", pos: r0, count: n }) },
      { label: `Insert ${n > 1 ? `${n} rows` : "row"} below`, icon: <BetweenHorizontalEnd size={14} />, disabled: view, onSelect: () => void runEdit({ op: "insertRows", pos: r0 + n, count: n }) },
      { label: `Delete ${rows}`, icon: <Trash2 size={14} />, danger: true, disabled: view, onSelect: () => void runEdit({ op: "deleteRows", pos: r0, count: n }) },
      "separator",
      { label: "Move up", icon: <MoveUp size={14} />, disabled: view || r0 === 0, onSelect: () => void runEdit({ op: "moveRows", pos: r0, count: n, delta: -1 }) },
      { label: "Move down", icon: <MoveDown size={14} />, disabled: view, onSelect: () => void runEdit({ op: "moveRows", pos: r0, count: n, delta: 1 }) },
      "separator",
      { label: `Hide ${rows}`, icon: <EyeOff size={14} />, onSelect: () => void runEdit({ op: "hideRows", pos: r0, count: n, hidden: true }) },
      {
        label: "Show hidden rows",
        icon: <Eye size={14} />,
        onSelect: () => void runEdit({ op: "hideRows", pos: Math.max(0, r0 - 1), count: n + (r0 > 0 ? 2 : 1), hidden: false }),
      },
      {
        label: "Row height…",
        icon: <ArrowUpDown size={14} />,
        onSelect: () => askNumber("Row height", "Height in pixels", layout.defaultRow, (h) => void runEdit({ op: "rowHeight", pos: r0, count: n, height: h })),
      },
      "separator",
      ...freezeMenu(r0 + n, null),
    ]);
  };

  const columnMenu = (e: ReactMouseEvent, col: number) => {
    if (!layout) return;
    const anchor = e.currentTarget instanceof HTMLElement && e.currentTarget.classList.contains("col-menu")
      ? e.currentTarget.getBoundingClientRect()
      : new DOMRect(e.clientX, e.clientY, 0, 0);
    const sel = selectionRect(latest.current.selection);
    const c0 = Math.min(sel.c0, col);
    const n = Math.max(sel.c1, col) - c0 + 1;
    const cols = n > 1 ? `${n} columns` : "column";
    setMenu({
      x: anchor.left,
      y: anchor.bottom,
      items: [
        { label: "Sort A to Z", icon: <ArrowDownAZ size={14} />, onSelect: () => sortBy(col, false) },
        { label: "Sort Z to A", icon: <ArrowUpZA size={14} />, onSelect: () => sortBy(col, true) },
        { label: "Sort by several columns…", icon: <ArrowUpDown size={14} />, onSelect: () => void openSortDialog() },
        { label: "Filter by values…", icon: <ListFilter size={14} />, onSelect: () => openValueFilter(col, anchor) },
        ...(viewActive
          ? [{ label: "Clear sort and filter", icon: <X size={14} />, onSelect: () => void setView([], "", []).then(() => setFilterInput("")) }]
          : []),
        "separator",
        { label: `Insert ${n > 1 ? `${n} columns` : "column"} left`, icon: <BetweenVerticalStart size={14} />, onSelect: () => void runEdit({ op: "insertCols", col: c0, count: n }) },
        { label: `Insert ${n > 1 ? `${n} columns` : "column"} right`, icon: <BetweenVerticalEnd size={14} />, onSelect: () => void runEdit({ op: "insertCols", col: c0 + n, count: n }) },
        { label: `Delete ${cols}`, icon: <Trash2 size={14} />, danger: true, onSelect: () => void runEdit({ op: "deleteCols", col: c0, count: n }) },
        "separator",
        { label: "Move left", icon: <MoveLeft size={14} />, disabled: c0 === 0, onSelect: () => void runEdit({ op: "moveCols", col: c0, count: n, delta: -1 }) },
        { label: "Move right", icon: <MoveRight size={14} />, onSelect: () => void runEdit({ op: "moveCols", col: c0, count: n, delta: 1 }) },
        "separator",
        { label: `Hide ${cols}`, icon: <EyeOff size={14} />, onSelect: () => void runEdit({ op: "hideCols", col: c0, count: n, hidden: true }) },
        {
          label: "Show hidden columns",
          icon: <Eye size={14} />,
          onSelect: () => void runEdit({ op: "hideCols", col: Math.max(0, c0 - 1), count: n + (c0 > 0 ? 2 : 1), hidden: false }),
        },
        {
          label: "Column width…",
          icon: <ArrowLeftToLine size={14} />,
          onSelect: () =>
            askNumber("Column width", "Width in pixels", layout.colWidths[col] ?? 90, (w) => void runEdit({ op: "colWidth", col: c0, count: n, width: w })),
        },
        "separator",
        ...freezeMenu(null, c0 + n),
      ],
    });
  };

  const sheetMenu = (e: ReactMouseEvent, index: number) => {
    if (!doc) return;
    const visible = doc.sheets.filter((s) => !s.hidden).length;
    const hidden = doc.sheets.map((s, i) => ({ s, i })).filter(({ s }) => s.hidden);
    const onSheet = async (edit: Edit) => {
      if (index !== latest.current.sheet) {
        setSheet(index);
        latest.current.sheet = index;
      }
      await runEdit(edit);
    };
    showMenu(e, [
      { label: "Rename", icon: <Pencil size={14} />, onSelect: () => setRenameRequest({ index, token: Date.now() }) },
      { label: "Duplicate", icon: <CopyPlus size={14} />, onSelect: () => void onSheet({ op: "duplicateSheet" }) },
      { label: "Move left", icon: <MoveLeft size={14} />, disabled: index === 0, onSelect: () => void onSheet({ op: "moveSheet", to: index - 1 }) },
      {
        label: "Move right",
        icon: <MoveRight size={14} />,
        disabled: index >= doc.sheets.length - 1,
        onSelect: () => void onSheet({ op: "moveSheet", to: index + 1 }),
      },
      "separator",
      { label: "Hide", icon: <EyeOff size={14} />, disabled: visible <= 1, onSelect: () => void onSheet({ op: "hideSheet" }) },
      ...hidden.map(({ s, i }) => ({ label: `Show "${s.name}"`, icon: <Eye size={14} />, onSelect: () => void runEdit({ op: "unhideSheet", index: i }) })),
      "separator",
      {
        label: "Delete",
        icon: <Trash2 size={14} />,
        danger: true,
        disabled: visible <= 1,
        onSelect: () =>
          setDialog({
            type: "choice",
            title: `Delete "${doc.sheets[index].name}"?`,
            message: "The sheet and its data are removed. Undo brings it back.",
            actions: [
              {
                label: "Delete",
                kind: "primary",
                onClick: () => {
                  setDialog(null);
                  void onSheet({ op: "deleteSheet" });
                },
              },
            ],
          }),
      },
    ]);
  };

  const recentMenu = (e: ReactMouseEvent, item: RecentItem) => {
    showMenu(e, [
      { label: "Open", icon: <FolderOpen size={14} />, onSelect: () => openRecent(item) },
      ...(item.kind === "file"
        ? [{ label: "Show in Finder", icon: <FileSpreadsheet size={14} />, onSelect: () => void revealItemInDir(item.location) }]
        : []),
      "separator" as const,
      {
        label: "Remove from list",
        icon: <Trash2 size={14} />,
        danger: true,
        onSelect: () => void api.recentRemove(item.location).then(refreshRecent),
      },
    ]);
  };

  // ---- Status ----

  let statusText = "";
  if (layout) {
    const dataRows = Math.max(0, layout.dataRows - layout.frozenRows);
    const rowsText =
      layout.shown !== null ? `${countFormat.format(layout.shown)} of ${plural(dataRows, "row", "rows")}` : plural(dataRows, "row", "rows");
    statusText = `${rowsText} · ${plural(layout.dataCols, "column", "columns")}`;
  }

  const activeStyle = activeMatches ? activeInfo!.info.style : null;
  const formulaValue = formulaBar ?? (activeMatches ? activeInfo!.info.content : "");

  // ---- Sidebar ----

  const isGoogle = !!doc?.location.startsWith("http");

  const toggleCompact = () => {
    setCompact(!compact);
    localStorage.setItem(COMPACT_KEY, compact ? "0" : "1");
  };

  const startResize = (e: ReactMouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sideWidth;
    const move = (ev: MouseEvent) => setSideWidth(Math.max(200, Math.min(520, startW + ev.clientX - startX)));
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      document.body.classList.remove("col-resizing");
      setSideWidth((w) => (localStorage.setItem(SIDE_KEY, String(w)), w));
    };
    document.body.classList.add("col-resizing");
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const sideButton = (name: SidebarIconName, tip: string, onClick: () => void, options: { active?: boolean; disabled?: boolean } = {}) => (
    <button
      type="button"
      className={`activity-button${options.active ? " active" : ""}`}
      data-tip={tip}
      aria-label={tip}
      disabled={options.disabled}
      onClick={onClick}
    >
      <SidebarIcon name={name} filled={options.active} />
    </button>
  );

  const settingsMenu = (e: ReactMouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const items: MenuEntry[] = [
      {
        label: "Appearance",
        icon: theme === "dark" ? <Moon size={14} /> : <Sun size={14} />,
        detail: theme === "dark" ? "Dark" : "Light",
        submenu: {
          items: (["light", "dark"] as Theme[]).map((t) => ({
            label: t === "dark" ? "Dark" : "Light",
            checked: theme === t,
            onSelect: () => {
              setThemeSwitched(true);
              setTheme(t);
            },
          })),
        },
      },
      {
        label: "Accent color",
        icon: <Palette size={14} />,
        detail: ACCENTS.find((a) => a.id === accent)?.label,
        submenu: {
          items: ACCENTS.map((a) => ({
            label: a.label,
            icon: <span className="accent-dot" style={{ background: a.color }} />,
            checked: a.id === accent,
            onSelect: () => setAccent(a.id),
          })),
        },
      },
      "separator",
      {
        label: "Memes",
        icon: <Cat size={14} />,
        detail: memes ? "On" : "Off",
        submenu: {
          items: [true, false].map((on) => ({
            label: on ? "Enable" : "Disable",
            checked: memes === on,
            onSelect: () => {
              setMemes(on);
              localStorage.setItem(MEMES_KEY, on ? "1" : "0");
            },
          })),
        },
      },
    ];
    setMenu({ x: rect.right + 8, y: Math.max(8, rect.bottom - 30 - items.length * 26), items });
  };

  return (
    <div className={`app${compact ? " compact" : ""}`} style={{ ["--side-w" as string]: panel ? `${sideWidth}px` : "0px" }}>
      <header className="titlebar" data-tauri-drag-region>
        <div className="titlebar-left" data-tauri-drag-region>
          <span className="brand" data-tauri-drag-region>
            <BrandMark />
            <span className="brand-name" data-tauri-drag-region>
              Cells
            </span>
          </span>
        </div>
        <div className="doc-title" data-tauri-drag-region>
          {doc ? (
            <>
              <span className="doc-pill" title={doc.location || doc.title}>
                <RecentIcon item={{ kind: isGoogle ? "google" : "file", location: doc.location || doc.title, title: doc.title, openedAt: 0 }} size={14} />
                <strong>{doc.title}</strong>
                {doc.dirty && <span className="edited-dot" title="Edited" />}
              </span>
              <span className="kind-tag" data-tauri-drag-region>
                {doc.kind}
              </span>
              {doc.location && !isGoogle && (
                <span className="doc-where" data-tauri-drag-region>
                  {folderOf(doc.location)}
                </span>
              )}
            </>
          ) : (
            <span className="doc-where" data-tauri-drag-region>
              No file open
            </span>
          )}
        </div>
        <div className="titlebar-actions">
          {doc && (
            <>
              <button type="button" className="button small ghost" onClick={() => void saveAs()}>
                Save As
              </button>
              <button
                type="button"
                className={`button small${doc.dirty ? " primary" : ""}`}
                disabled={!doc.dirty}
                title={doc.canSave ? "Save (⌘S)" : "This file is saved with Save As"}
                onClick={() => void save()}
              >
                <Save size={13} /> Save
              </button>
            </>
          )}
          <UpdateButton app="Cells" repo="lakiAlex/cells" restartNote="Save your changes first." notify />
          <WindowSnap />
          <button
            type="button"
            role="switch"
            aria-checked={theme === "dark"}
            className={`theme-switch ${theme}${themeSwitched ? " switched" : ""}`}
            title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            onClick={() => {
              setThemeSwitched(true);
              setTheme((t) => (t === "dark" ? "light" : "dark"));
            }}
          >
            <span className="theme-thumb" />
            <span className="theme-option sun">
              <Sun size={15} strokeWidth={1.9} />
            </span>
            <span className="theme-option moon">
              <Moon size={12.5} strokeWidth={1.9} />
            </span>
          </button>
        </div>
      </header>

      <nav className="activity-bar">
        <div className="activity-group">
          {sideButton("recent", "Recent files (⇧⌘E)", () => setPanel((p) => (p === "recent" ? null : "recent")), { active: panel === "recent" })}
          {sideButton("find", "Find and replace (⌘F)", openFind, { disabled: !doc })}
        </div>
        <div className="activity-group">
          {sideButton("new", "New spreadsheet (⌘N)", newDoc)}
          {sideButton("open", "Open file (⌘O)", openFile)}
          {sideButton("google", "Open Google Sheet", () => guardUnsaved(() => setDialog({ type: "google" })))}
        </div>
        <span className="activity-spacer" />
        <div className="activity-group">
          {sideButton("sidebar", compact ? "Expand sidebar" : "Minimize sidebar", toggleCompact)}
          <button type="button" className="activity-button" data-tip="Settings" aria-label="Settings" onClick={settingsMenu}>
            <SidebarIcon name="settings" />
          </button>
        </div>
      </nav>

      <aside className="side-panel">
        {panel === "recent" && (
          <div key={panel} className="side-panel-body">
            <RecentPanel
              recent={recent}
              activeLocation={doc?.location ?? null}
              onClose={() => setPanel(null)}
              onOpenRecent={openRecent}
              onRecentMenu={recentMenu}
            />
          </div>
        )}
        {panel && <div className="side-resize" onMouseDown={startResize} />}
      </aside>

      <main className="content">
        {memes && <MemeButton />}

        {doc && layout ? (
          <>
            <Toolbar
              style={activeStyle}
              merged={activeMatches ? activeInfo!.info.merged : false}
              canUndo={doc.canUndo}
              canRedo={doc.canRedo}
              onUndo={() => void replay(true)}
              onRedo={() => void replay(false)}
              onStyle={style}
              onDecimals={(delta) =>
                void runEdit({ op: "decimals", rect: styleRect(), pos: selection.anchor.r, col: selection.anchor.c, delta })
              }
              onBorder={(kind, lineStyle, color) => void runEdit({ op: "border", rect: opRect(), kind, style: lineStyle, color })}
              onMerge={(merge) => void runEdit(merge ? { op: "merge", rect } : { op: "unmerge", rect })}
              onClearFormatting={() => void runEdit({ op: "clear", rect: styleRect(), what: "formatting" })}
            />

            <div className="formula-bar">
              <input
                className="cell-address"
                value={addressInput ?? address}
                spellCheck={false}
                onFocus={(e) => {
                  setAddressInput(address);
                  e.currentTarget.select();
                }}
                onBlur={() => setAddressInput(null)}
                onChange={(e) => setAddressInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    goToAddress(e.currentTarget.value);
                    setAddressInput(null);
                  } else if (e.key === "Escape") {
                    setAddressInput(null);
                    focusGrid();
                  }
                }}
              />
              <SquareFunction size={15} className="fx" />
              <input
                className="formula-input"
                value={formulaValue}
                spellCheck={false}
                placeholder={activeMatches ? "" : " "}
                onChange={(e) => setFormulaBar(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (formulaBar !== null && activeMatches && formulaBar !== activeInfo!.info.content)
                      void runEdit({ op: "input", pos: selection.anchor.r, col: selection.anchor.c, value: formulaBar });
                    setFormulaBar(null);
                    focusGrid();
                  } else if (e.key === "Escape") {
                    setFormulaBar(null);
                    focusGrid();
                  }
                }}
              />
              <ViewControls
                header={layout.frozenRows > 0}
                filter={filterInput}
                viewActive={viewActive}
                onHeader={(on) => void runEdit({ op: "freeze", rows: on ? Math.max(1, layout.frozenRows) : 0, cols: layout.frozenCols })}
                onFilter={setFilterInput}
                onSort={() => void openSortDialog()}
                onClearView={() => {
                  setFilterInput("");
                  void setView([], "", []);
                }}
                onFind={openFind}
              />
            </div>

            {find.open && (
              <FindBar
                options={find.options}
                count={find.matches?.length ?? null}
                index={find.index}
                focusToken={find.token}
                onOptions={(options) => setFind((f) => ({ ...f, options }))}
                onStep={stepFind}
                onReplace={async (replacement) => {
                  const match = find.matches?.[find.index];
                  if (!match) return;
                  await runEdit({ op: "replace", find: find.options, replacement, cell: match });
                }}
                onReplaceAll={async (replacement) => {
                  const result = await runEdit({ op: "replace", find: find.options, replacement, cell: null });
                  if (result) toast("info", `Replaced ${plural(result.outcome.count ?? 0, "cell", "cells")}`);
                }}
                onClose={() => {
                  setFind((f) => ({ ...f, open: false, matches: null }));
                  focusGrid();
                }}
              />
            )}

            {noticeClosed !== doc.id && (doc.notice.unkept.length > 0 || doc.notice.recalcChanged > 0) && (
              <div className="notice">
                <TriangleAlert size={15} className="notice-icon" />
                <div className="notice-text">
                  {doc.notice.unkept.length > 0 && (
                    <p>
                      This file has {listText(doc.notice.unkept)}. Cells does not show them, and saving over the file removes them.
                      Save As keeps the original as it is.
                    </p>
                  )}
                  {doc.notice.recalcChanged > 0 && (
                    <p>
                      {plural(doc.notice.recalcChanged, "formula gives", "formulas give")} a different result in Cells than the one
                      stored in the file. Cells does not support every Excel feature, such as table references and links to other
                      workbooks. For example: {doc.notice.recalcExamples.join("; ")}
                    </p>
                  )}
                </div>
                <button type="button" className="icon-button" title="Close" onClick={() => setNoticeClosed(doc.id)}>
                  <X size={14} />
                </button>
              </div>
            )}

            <div className="grid-wrap">
              <Grid
                key={`${doc.id}:${sheet}`}
                docId={doc.id}
                sheet={sheet}
                layout={layout}
                version={version}
                theme={theme}
                selection={selection}
                active={activeMatches ? { cell: activeInfo!.cell, content: activeInfo!.info.content } : null}
                copied={copied}
                canFill={!viewActive}
                revealRequest={reveal}
                onSelection={setSelection}
                onInput={(pos, col, value) => void runEdit({ op: "input", pos, col, value })}
                onCopy={(cut) => void copySelection(cut)}
                onPaste={() => void paste()}
                onClear={() => void runEdit({ op: "clear", rect: opRect(), what: "contents" })}
                onEscape={() => setCopied(null)}
                onAutofill={(r, to, rows) => void runEdit({ op: "autofill", rect: r, to, rows })}
                onColWidth={(col, count, width) => void runEdit({ op: "colWidth", col, count, width })}
                onRowHeight={(pos, count, height) => void runEdit({ op: "rowHeight", pos, count, height })}
                onColumnMenu={columnMenu}
                onRowMenu={rowMenu}
                onCellMenu={cellMenu}
              />
            </div>

            <footer className="statusbar">
              <SheetTabs
                sheets={doc.sheets}
                active={sheet}
                renameRequest={renameRequest}
                onSelect={(i) => {
                  if (i === sheet) return;
                  setSheet(i);
                  setSelection(ORIGIN);
                  setCopied(null);
                }}
                onAdd={() => void runEdit({ op: "addSheet" })}
                onRename={(i, name) => {
                  latest.current.sheet = i;
                  void runEdit({ op: "renameSheet", name });
                }}
                onMenu={sheetMenu}
              />
              <div className="status-info">
                {stats && stats.numbers > 0 && (
                  <span className="stats">
                    Count {numberFormat.format(stats.filled)} · Sum {numberFormat.format(stats.sum)} · Average{" "}
                    {numberFormat.format(stats.sum / stats.numbers)} · Min {numberFormat.format(stats.min ?? 0)} · Max{" "}
                    {numberFormat.format(stats.max ?? 0)}
                  </span>
                )}
                {stats && stats.numbers === 0 && <span className="stats">Count {numberFormat.format(stats.filled)}</span>}
                <span>{statusText}</span>
              </div>
            </footer>
          </>
        ) : (
          <div className="welcome">
            <div className="welcome-card">
              <img className="welcome-icon" src={appIcon} alt="" />
              <h3>Cells</h3>
              <p className="muted">Open a CSV, Excel or OpenDocument file, or a Google Sheets link. You can also drop a file on the window.</p>
              <div className="welcome-actions">
                <button type="button" className="button primary" onClick={openFile}>
                  <FolderOpen size={14} /> Open File… <span className="kbd">⌘O</span>
                </button>
                <button type="button" className="button" onClick={newDoc}>
                  <FilePlus2 size={14} /> New Spreadsheet <span className="kbd">⌘N</span>
                </button>
                <button type="button" className="button" onClick={() => setDialog({ type: "google" })}>
                  <Link size={14} /> Open Google Sheet…
                </button>
              </div>
              {recent.length > 0 && (
                <div className="welcome-recent">
                  <div className="recent-title">Recent files</div>
                  {recent.slice(0, 6).map((item) => (
                    <button
                      key={item.location}
                      type="button"
                      className="welcome-row"
                      title={item.location}
                      onClick={() => openRecent(item)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        recentMenu(e, item);
                      }}
                    >
                      <RecentIcon item={item} size={15} />
                      <span className="welcome-row-name">{item.title}</span>
                      <span className="welcome-row-where">{item.kind === "google" ? "Google Sheets" : folderOf(item.location)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {menu && <ContextMenu menu={menu} onClose={() => setMenu(null)} />}
      {valueFilter && layout && (
        <ValueFilter
          anchor={valueFilter.anchor}
          column={`column ${columnName(valueFilter.col)}`}
          values={valueFilter.values}
          shown={layout.valueFilters.find(([c]) => c === valueFilter.col)?.[1] ?? null}
          onClose={() => setValueFilter(null)}
          onApply={(shown) => {
            const col = valueFilter.col;
            setValueFilter(null);
            const others = layout.valueFilters.filter(([c]) => c !== col);
            void setView(layout.sort, layout.filter, shown ? [...others, [col, shown]] : others);
          }}
        />
      )}
      {dialog?.type === "google" && (
        <GoogleDialog
          onCancel={() => setDialog(null)}
          onOpen={async (link) => {
            const error = await loadDoc(() => api.openGoogle(link));
            if (!error) setDialog(null);
            return error;
          }}
        />
      )}
      {dialog?.type === "input" && (
        <InputDialog
          title={dialog.title}
          label={dialog.label}
          initial={dialog.initial}
          confirmLabel={dialog.confirm}
          onCancel={() => setDialog(null)}
          onConfirm={dialog.onConfirm}
        />
      )}
      {dialog?.type === "sort" && layout && (
        <SortDialog
          columns={dialog.columns}
          initial={layout.sort}
          header={layout.frozenRows > 0}
          onCancel={() => setDialog(null)}
          onApply={(keys) => {
            setDialog(null);
            void setView(keys, layout.filter, layout.valueFilters);
          }}
        />
      )}
      {dialog?.type === "choice" && (
        <ChoiceDialog title={dialog.title} message={dialog.message} actions={dialog.actions} onCancel={() => setDialog(null)} />
      )}
      {busy && (
        <div className="busy">
          <span className="spin-dot" /> {busy}
        </div>
      )}
      {dropping && <div className="drop-overlay">Drop to open</div>}
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.message}
          </div>
        ))}
      </div>
    </div>
  );
}
