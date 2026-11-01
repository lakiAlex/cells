import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

/** A panel under a toolbar button. Closes on a click outside or Escape. */
export function Popover(props: { anchor: DOMRect; onClose: () => void; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: props.anchor.left, top: props.anchor.bottom + 6 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPosition({
      left: Math.max(8, Math.min(props.anchor.left, window.innerWidth - width - 8)),
      top: props.anchor.bottom + 6 + height > window.innerHeight - 8 ? Math.max(8, props.anchor.top - height - 6) : props.anchor.bottom + 6,
    });
  }, [props.anchor]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) props.onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        props.onClose();
      }
    };
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", props.onClose);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("blur", props.onClose);
    };
  }, [props.onClose]);

  return (
    <div ref={ref} className={`popover ${props.className ?? ""}`} style={position} onContextMenu={(e) => e.preventDefault()}>
      {props.children}
    </div>
  );
}

const PALETTE = [
  ["#000000", "#434343", "#666666", "#999999", "#B7B7B7", "#CCCCCC", "#D9D9D9", "#EFEFEF", "#F3F3F3", "#FFFFFF"],
  ["#980000", "#FF0000", "#FF9900", "#FFFF00", "#00FF00", "#00FFFF", "#4A86E8", "#0000FF", "#9900FF", "#FF00FF"],
  ["#E6B8AF", "#F4CCCC", "#FCE5CD", "#FFF2CC", "#D9EAD3", "#D0E0E3", "#C9DAF8", "#CFE2F3", "#D9D2E9", "#EAD1DC"],
  ["#DD7E6B", "#EA9999", "#F9CB9C", "#FFE599", "#B6D7A8", "#A2C4C9", "#A4C2F4", "#9FC5E8", "#B4A7D6", "#D5A6BD"],
  ["#CC4125", "#E06666", "#F6B26B", "#FFD966", "#93C47D", "#76A5AF", "#6D9EEB", "#6FA8DC", "#8E7CC3", "#C27BA0"],
  ["#A61C00", "#CC0000", "#E69138", "#F1C232", "#6AA84F", "#45818E", "#3C78D8", "#3D85C6", "#674EA7", "#A64D79"],
];

/** Color swatches. An empty string means automatic text color or no fill. */
export function ColorPalette(props: { current: string | null; noneLabel: string; onPick: (color: string) => void }) {
  const current = props.current?.toUpperCase() ?? "";
  return (
    <div className="palette">
      <button type="button" className="palette-none" onClick={() => props.onPick("")}>
        <span className="swatch none" /> {props.noneLabel}
      </button>
      {PALETTE.map((row, i) => (
        <div key={i} className="palette-row">
          {row.map((color) => (
            <button
              type="button"
              key={color}
              className={`swatch${color === current ? " current" : ""}`}
              style={{ background: color }}
              title={color}
              onClick={() => props.onPick(color)}
            />
          ))}
        </div>
      ))}
      <label className="palette-custom">
        Custom
        <input type="color" defaultValue={props.current ?? "#000000"} onChange={(e) => props.onPick(e.target.value.toUpperCase())} />
      </label>
    </div>
  );
}

const BORDER_KINDS: { kind: string; label: string; edges: string }[] = [
  { kind: "All", label: "All borders", edges: "trblhv" },
  { kind: "Outer", label: "Outside borders", edges: "trbl" },
  { kind: "Inner", label: "Inside borders", edges: "hv" },
  { kind: "Top", label: "Top border", edges: "t" },
  { kind: "Bottom", label: "Bottom border", edges: "b" },
  { kind: "Left", label: "Left border", edges: "l" },
  { kind: "Right", label: "Right border", edges: "r" },
  { kind: "None", label: "No borders", edges: "" },
];

const LINE_STYLES = [
  { style: "thin", label: "Thin" },
  { style: "medium", label: "Medium" },
  { style: "thick", label: "Thick" },
  { style: "mediumdashed", label: "Dashed" },
  { style: "dotted", label: "Dotted" },
  { style: "double", label: "Double" },
];

function BorderIcon({ edges }: { edges: string }) {
  const solid = (d: string, key: string) => <path key={key} d={d} stroke="currentColor" strokeWidth={1.6} />;
  const lines: Record<string, string> = { t: "M2 2H16", b: "M2 16H16", l: "M2 2V16", r: "M16 2V16", h: "M2 9H16", v: "M9 2V16" };
  return (
    <svg width={18} height={18} viewBox="0 0 18 18" fill="none">
      <rect x={2} y={2} width={14} height={14} stroke="currentColor" strokeOpacity={0.3} strokeDasharray="1.5 1.5" />
      <path d="M2 9H16M9 2V16" stroke="currentColor" strokeOpacity={0.3} strokeDasharray="1.5 1.5" />
      {[...edges].map((e) => solid(lines[e], e))}
    </svg>
  );
}

export function BorderPicker(props: { onPick: (kind: string, style: string, color: string) => void }) {
  const [style, setStyle] = useState("thin");
  const [color, setColor] = useState("");
  return (
    <div className="border-picker">
      <div className="border-grid">
        {BORDER_KINDS.map((b) => (
          <button type="button" key={b.kind} className="icon-button" title={b.label} onClick={() => props.onPick(b.kind, style, color)}>
            <BorderIcon edges={b.edges} />
          </button>
        ))}
      </div>
      <label className="field compact">
        <span>Line</span>
        <select value={style} onChange={(e) => setStyle(e.target.value)}>
          {LINE_STYLES.map((s) => (
            <option key={s.style} value={s.style}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <div className="border-colors">
        {["", "#000000", "#999999", "#CC0000", "#3C78D8", "#6AA84F", "#F1C232"].map((c) => (
          <button
            type="button"
            key={c || "auto"}
            className={`swatch${c ? "" : " auto"}${c === color ? " current" : ""}`}
            style={c ? { background: c } : undefined}
            title={c || "Automatic"}
            onClick={() => setColor(c)}
          />
        ))}
      </div>
    </div>
  );
}
