// Window layouts for the title bar, as in the Rectangle app: left half, center,
// fill the screen and right half. One button that opens a panel of large layout
// tiles on click. Shared by Lookout, Dispatch and Cells.
//
// Clicking a half again cycles its width through 1/2, 2/3 and 1/3, as Rectangle
// does. Clicking center again makes the window larger. Clicking "fill" on a filled
// window puts it back where it was. The tile for the current layout is highlighted.
import { MinimizeScreenIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { currentMonitor, getCurrentWindow, PhysicalPosition, PhysicalSize, type Monitor } from "@tauri-apps/api/window";
import { useEffect, useRef, useState } from "react";

export type SnapAction = "left" | "center" | "fill" | "right";

/** Matches minWidth in tauri.conf.json, so a snapped window is never narrower than the app allows. */
const MIN_WIDTH = 640;
const MIN_HEIGHT = 480;
const HALVES = [1 / 2, 2 / 3, 1 / 3];
/** Width and height of a centered window, as parts of the screen. */
const CENTERS: [number, number][] = [
  [0.6, 0.7],
  [0.8, 0.85],
];

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The size and position before the first snap, so "fill" can restore it. */
let restoreRect: Rect | null = null;

async function windowRect(): Promise<Rect> {
  const win = getCurrentWindow();
  const [pos, size] = await Promise.all([win.outerPosition(), win.outerSize()]);
  return { x: pos.x, y: pos.y, w: size.width, h: size.height };
}

function near(a: Rect, b: Rect) {
  return Math.abs(a.x - b.x) < 6 && Math.abs(a.y - b.y) < 6 && Math.abs(a.w - b.w) < 6 && Math.abs(a.h - b.h) < 6;
}

function targets(monitor: Monitor) {
  const { position: p, size: s } = monitor.workArea;
  const minW = MIN_WIDTH * monitor.scaleFactor;
  const minH = MIN_HEIGHT * monitor.scaleFactor;
  const fill: Rect = { x: p.x, y: p.y, w: s.width, h: s.height };
  // Halves narrower than the app allows are left out.
  let widths = HALVES.map((f) => Math.round(s.width * f)).filter((w) => w >= minW);
  if (!widths.length) widths = [Math.min(s.width, Math.max(minW, Math.round(s.width / 2)))];
  const left = widths.map((w): Rect => ({ x: p.x, y: p.y, w, h: s.height }));
  const right = widths.map((w): Rect => ({ x: p.x + s.width - w, y: p.y, w, h: s.height }));
  const center = CENTERS.map(([fw, fh]): Rect => {
    const w = Math.min(s.width, Math.max(minW, Math.round(s.width * fw)));
    const h = Math.min(s.height, Math.max(minH, Math.round(s.height * fh)));
    return { x: p.x + Math.round((s.width - w) / 2), y: p.y + Math.round((s.height - h) / 2), w, h };
  });
  return { fill, left, right, center };
}

/** The layout the window is in now, if any. */
async function currentLayout(): Promise<SnapAction | null> {
  const monitor = await currentMonitor();
  if (!monitor) return null;
  const rect = await windowRect();
  const t = targets(monitor);
  if (near(rect, t.fill)) return "fill";
  if (t.left.some((r) => near(rect, r))) return "left";
  if (t.right.some((r) => near(rect, r))) return "right";
  if (t.center.some((r) => near(rect, r))) return "center";
  return null;
}

async function place(rect: Rect) {
  const win = getCurrentWindow();
  // Sizing first keeps a window that grows from being pushed past the screen edge.
  await win.setSize(new PhysicalSize(rect.w, rect.h));
  await win.setPosition(new PhysicalPosition(rect.x, rect.y));
}

export async function snapWindow(action: SnapAction) {
  const win = getCurrentWindow();
  if (await win.isFullscreen()) await win.setFullscreen(false);
  if (await win.isMaximized()) await win.unmaximize();
  const monitor = await currentMonitor();
  if (!monitor) return;
  const rect = await windowRect();
  const t = targets(monitor);
  if ((await currentLayout()) === null) restoreRect = rect;

  if (action === "fill") {
    if (near(rect, t.fill) && restoreRect && !near(restoreRect, t.fill)) await place(restoreRect);
    else await place(t.fill);
    return;
  }
  // Again on the same layout steps to its next size.
  const list = t[action];
  const index = list.findIndex((r) => near(rect, r));
  await place(list[(index + 1) % list.length]);
}

/** A screen with the part the window takes filled in. */
function LayoutPicture({ action }: { action: SnapAction }) {
  const part = {
    left: { x: 5, y: 5, w: 33, h: 34 },
    right: { x: 42, y: 5, w: 33, h: 34 },
    fill: { x: 5, y: 5, w: 70, h: 34 },
    center: { x: 17, y: 10, w: 46, h: 24 },
  }[action];
  return (
    <svg className="snap-picture" width="80" height="44" viewBox="0 0 80 44" fill="none" aria-hidden="true">
      <rect x="1" y="1" width="78" height="42" rx="7" className="snap-screen" />
      <rect x={part.x} y={part.y} width={part.w} height={part.h} rx="4" className="snap-window" />
    </svg>
  );
}

const TILES: { action: SnapAction; label: string; hint: string }[] = [
  { action: "left", label: "Left", hint: "Again for 2/3, 1/3" },
  { action: "right", label: "Right", hint: "Again for 2/3, 1/3" },
  { action: "center", label: "Center", hint: "Again for larger" },
  { action: "fill", label: "Fill", hint: "Again to restore" },
];

export function WindowSnap() {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<SnapAction | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let check = 0;
    const update = () => {
      window.clearTimeout(check);
      check = window.setTimeout(() => void currentLayout().then(setActive).catch(() => undefined), 120);
    };
    update();
    const win = getCurrentWindow();
    const unlisten = [win.onMoved(update), win.onResized(update)];
    return () => {
      window.clearTimeout(check);
      unlisten.forEach((p) => void p.then((f) => f()));
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    // A click anywhere outside closes it. The panel stays open after picking a
    // layout, so a tile can be clicked again to step through its sizes.
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("blur", () => setOpen(false), { once: true });
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown, true);
    };
  }, [open]);

  return (
    <div className="window-snap" ref={ref}>
      <button
        type="button"
        className={`snap-trigger${open ? " open" : ""}`}
        aria-label="Window layout"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <HugeiconsIcon icon={MinimizeScreenIcon} size={17} strokeWidth={1.7} />
      </button>
      {open && (
        <div className="snap-panel" role="menu">
          <div className="snap-title">Window layout</div>
          <div className="snap-grid">
            {TILES.map(({ action, label, hint }) => (
              <button
                key={action}
                type="button"
                role="menuitem"
                className={`snap-tile${active === action ? " active" : ""}`}
                onClick={() => void snapWindow(action).catch(() => undefined)}
              >
                <LayoutPicture action={action} />
                <span className="snap-label">{label}</span>
                <span className="snap-hint">{hint}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
