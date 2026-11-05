import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  Baseline,
  Bold,
  ChevronDown,
  DecimalsArrowLeft,
  DecimalsArrowRight,
  Grid2x2,
  Italic,
  PaintBucket,
  Redo2,
  RemoveFormatting,
  Strikethrough,
  TableCellsMerge,
  TableCellsSplit,
  Underline,
  Undo2,
  WrapText,
} from "./icons";
import { ArrowUpDown, ListFilter, Search, X } from "./icons";
import { useState, type ReactNode } from "react";
import { NUMBER_FORMATS, type StyleDto } from "../api";
import { BorderPicker, ColorPalette, Popover } from "./Popover";

const FONT_SIZES = [8, 9, 10, 11, 12, 13, 14, 16, 18, 20, 24, 28, 32, 36, 48, 72];

type Panel = "format" | "text" | "fill" | "valign" | "border" | null;

interface ToolbarProps {
  style: StyleDto | null;
  merged: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onStyle: (path: string, value: string) => void;
  onDecimals: (delta: number) => void;
  onBorder: (kind: string, style: string, color: string) => void;
  onMerge: (merge: boolean) => void;
  onClearFormatting: () => void;
}

function formatLabel(fmt: string | undefined): string {
  if (!fmt) return "Automatic";
  return NUMBER_FORMATS.find((f) => f.fmt === fmt)?.label ?? (fmt === "General" ? "Automatic" : "Custom");
}

export function Toolbar(props: ToolbarProps) {
  const [panel, setPanel] = useState<{ name: Panel; anchor: DOMRect } | null>(null);
  const st = props.style;
  const open = (name: Panel) => (e: React.MouseEvent<HTMLButtonElement>) =>
    setPanel(panel?.name === name ? null : { name, anchor: e.currentTarget.getBoundingClientRect() });
  const close = () => setPanel(null);

  const toggle = (label: string, shortcut: string | null, on: boolean, icon: ReactNode, onClick: () => void) => (
    <button
      type="button"
      className={`tool${on ? " on" : ""}`}
      title={shortcut ? `${label} (${shortcut})` : label}
      aria-pressed={on}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {icon}
    </button>
  );

  const h = st?.h ?? "";
  const v = st?.v ?? "bottom";
  const VIcon = v === "top" ? AlignVerticalJustifyStart : v === "center" ? AlignVerticalJustifyCenter : AlignVerticalJustifyEnd;

  return (
    <div className="toolbar">
      <div className="tool-group">
        {toggle("Undo", "⌘Z", false, <Undo2 size={15} />, props.onUndo)}
        {toggle("Redo", "⇧⌘Z", false, <Redo2 size={15} />, props.onRedo)}
      </div>

      <button type="button" className="tool popup" title="Number format" onMouseDown={(e) => e.preventDefault()} onClick={open("format")}>
        <span className="tool-text">{formatLabel(st?.fmt)}</span>
        <ChevronDown size={12} />
      </button>
      <div className="tool-group">
        {toggle("Fewer decimals", null, false, <DecimalsArrowLeft size={15} />, () => props.onDecimals(-1))}
        {toggle("More decimals", null, false, <DecimalsArrowRight size={15} />, () => props.onDecimals(1))}
      </div>

      <select
        className="tool-select"
        title="Font size"
        value={st?.size ?? 12}
        onChange={(e) => props.onStyle("font.size", e.target.value)}
      >
        {[...new Set([...FONT_SIZES, st?.size ?? 12])]
          .sort((a, b) => a - b)
          .map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
      </select>
      <div className="tool-group">
        {toggle("Bold", "⌘B", !!st?.b, <Bold size={15} />, () => props.onStyle("font.b", String(!st?.b)))}
        {toggle("Italic", "⌘I", !!st?.i, <Italic size={15} />, () => props.onStyle("font.i", String(!st?.i)))}
        {toggle("Underline", "⌘U", !!st?.u, <Underline size={15} />, () => props.onStyle("font.u", String(!st?.u)))}
        {toggle("Strikethrough", "⇧⌘X", !!st?.s, <Strikethrough size={15} />, () => props.onStyle("font.strike", String(!st?.s)))}
      </div>
      <div className="tool-group">
        <button type="button" className="tool color" title="Text color" onMouseDown={(e) => e.preventDefault()} onClick={open("text")}>
          <Baseline size={15} />
          <span className="color-bar" style={{ background: st?.color ?? "var(--fg)" }} />
        </button>
        <button type="button" className="tool color" title="Fill color" onMouseDown={(e) => e.preventDefault()} onClick={open("fill")}>
          <PaintBucket size={15} />
          <span className="color-bar" style={{ background: st?.fill ?? "transparent" }} />
        </button>
      </div>

      <div className="tool-group">
        {toggle("Align left", null, h === "left", <AlignLeft size={15} />, () =>
          props.onStyle("alignment.horizontal", h === "left" ? "general" : "left"),
        )}
        {toggle("Center", null, h === "center", <AlignCenter size={15} />, () =>
          props.onStyle("alignment.horizontal", h === "center" ? "general" : "center"),
        )}
        {toggle("Align right", null, h === "right", <AlignRight size={15} />, () =>
          props.onStyle("alignment.horizontal", h === "right" ? "general" : "right"),
        )}
      </div>
      <div className="tool-group">
        <button type="button" className="tool" title="Vertical alignment" onMouseDown={(e) => e.preventDefault()} onClick={open("valign")}>
          <VIcon size={15} />
        </button>
        {toggle("Wrap text", null, !!st?.wrap, <WrapText size={15} />, () => props.onStyle("alignment.wrap_text", String(!st?.wrap)))}
      </div>
      <div className="tool-group">
        <button type="button" className="tool" title="Borders" onMouseDown={(e) => e.preventDefault()} onClick={open("border")}>
          <Grid2x2 size={15} />
        </button>
        {toggle(
          props.merged ? "Unmerge cells" : "Merge cells",
          null,
          props.merged,
          props.merged ? <TableCellsSplit size={15} /> : <TableCellsMerge size={15} />,
          () => props.onMerge(!props.merged),
        )}
        {toggle("Clear formatting", null, false, <RemoveFormatting size={15} />, props.onClearFormatting)}
      </div>

      {panel?.name === "format" && (
        <Popover anchor={panel.anchor} onClose={close} className="menu-popover">
          {NUMBER_FORMATS.map((f) => (
            <button
              type="button"
              key={f.fmt}
              className={`menu-item${st?.fmt === f.fmt ? " checked" : ""}`}
              onClick={() => {
                close();
                props.onStyle("num_fmt", f.fmt);
              }}
            >
              <span className="menu-label">{f.label}</span>
              <span className="menu-shortcut">{f.example}</span>
            </button>
          ))}
        </Popover>
      )}
      {panel?.name === "text" && (
        <Popover anchor={panel.anchor} onClose={close}>
          <ColorPalette
            current={st?.color ?? null}
            noneLabel="Automatic"
            onPick={(color) => {
              close();
              props.onStyle("font.color", color);
            }}
          />
        </Popover>
      )}
      {panel?.name === "fill" && (
        <Popover anchor={panel.anchor} onClose={close}>
          <ColorPalette
            current={st?.fill ?? null}
            noneLabel="No fill"
            onPick={(color) => {
              close();
              props.onStyle("fill.color", color);
            }}
          />
        </Popover>
      )}
      {panel?.name === "valign" && (
        <Popover anchor={panel.anchor} onClose={close} className="menu-popover">
          {(
            [
              ["top", "Top", <AlignVerticalJustifyStart size={14} key="t" />],
              ["center", "Middle", <AlignVerticalJustifyCenter size={14} key="c" />],
              ["bottom", "Bottom", <AlignVerticalJustifyEnd size={14} key="b" />],
            ] as const
          ).map(([value, label, icon]) => (
            <button
              type="button"
              key={value}
              className={`menu-item${v === value ? " checked" : ""}`}
              onClick={() => {
                close();
                props.onStyle("alignment.vertical", value);
              }}
            >
              <span className="menu-icon">{icon}</span>
              <span className="menu-label">{label}</span>
            </button>
          ))}
        </Popover>
      )}
      {panel?.name === "border" && (
        <Popover anchor={panel.anchor} onClose={close}>
          <BorderPicker
            onPick={(kind, style, color) => {
              close();
              props.onBorder(kind, style, color);
            }}
          />
        </Popover>
      )}
    </div>
  );
}

/** Header row, filter, sort and find, at the end of the formula bar. */
export function ViewControls(props: {
  header: boolean;
  filter: string;
  viewActive: boolean;
  onHeader: (on: boolean) => void;
  onFilter: (text: string) => void;
  onSort: () => void;
  onClearView: () => void;
  onFind: () => void;
}) {
  return (
    <>
      <label className="check" title="Keep the first row in place when scrolling, sorting and filtering">
        <input type="checkbox" checked={props.header} onChange={(e) => props.onHeader(e.target.checked)} />
        Header row
      </label>
      <label className="filter">
        <ListFilter size={13} />
        <input
          value={props.filter}
          placeholder="Filter rows"
          spellCheck={false}
          onChange={(e) => props.onFilter(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && props.onFilter("")}
        />
        {props.filter && (
          <button type="button" className="filter-clear" onClick={() => props.onFilter("")}>
            <X size={12} />
          </button>
        )}
      </label>
      <button type="button" className="tool" title="Sort" onClick={props.onSort}>
        <ArrowUpDown size={15} />
      </button>
      {props.viewActive && (
        <button type="button" className="button small ghost" onClick={props.onClearView}>
          <X size={12} /> Clear sort and filter
        </button>
      )}
      <button type="button" className="tool" title="Find and replace (⌘F)" onClick={props.onFind}>
        <Search size={15} />
      </button>
    </>
  );
}
