// The update button in the title bar. The app checks GitHub for a newer release
// at launch and every few hours. When there is one, an "Update" button shows in
// the title bar; its panel has the version, what changed and "Update and restart".
// Shared by Lookout, Dispatch, Cells and Patchy, with its styles in update.css.
//
// The download is checked against the public key in tauri.conf.json (plugins >
// updater) before it replaces the app. The release workflow signs each build.
//
// `VITE_FAKE_UPDATE=1 pnpm tauri dev` shows a made-up update, to work on the
// design without a release.
import { getVersion } from "@tauri-apps/api/app";
import { sendNotification } from "@tauri-apps/plugin-notification";
import { openUrl } from "@tauri-apps/plugin-opener";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type DownloadEvent } from "@tauri-apps/plugin-updater";
import { ArrowRight02Icon, Download04Icon, LinkSquare02Icon, Loading03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { useEffect, useRef, useState } from "react";
import appIcon from "../../src-tauri/icons/128x128@2x.png";
import "./update.css";

function Icon(props: { icon: IconSvgElement; size: number; className?: string }) {
  return <HugeiconsIcon icon={props.icon} size={props.size} strokeWidth={1.7} className={props.className} />;
}

const FIRST_CHECK_MS = 8_000;
const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;
/** The version a macOS notification was last shown for, shared by all windows. */
const NOTIFIED_KEY = "updateNotified";
const FAKE = import.meta.env.DEV && import.meta.env.VITE_FAKE_UPDATE === "1";

interface Available {
  version: string;
  current: string;
  date: string | null;
  notes: string[];
  install: (onEvent: (event: DownloadEvent) => void) => Promise<void>;
}

type Phase =
  | { kind: "idle" }
  | { kind: "downloading"; done: number; total: number | null }
  | { kind: "restarting" }
  | { kind: "error"; message: string };

/** The bullet points under "Changes" in the GitHub release, which latest.json does not carry. */
async function releaseNotes(repo: string, version: string, fallback: string | undefined): Promise<string[]> {
  const bullets = (text: string) =>
    text
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("- "))
      .map((l) => l.slice(2).replace(/`/g, ""));
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/releases/tags/v${version}`);
    if (res.ok) {
      const body: string = (await res.json()).body ?? "";
      const changes = body.split(/^## Changes.*$/m)[1]?.split(/^## /m)[0];
      const list = bullets(changes ?? "");
      if (list.length) return list;
    }
  } catch {
    // Offline or rate limited: the notes from latest.json, if any.
  }
  return bullets(fallback ?? "");
}

/** The next patch version, for the made-up update. */
function nextPatch(version: string) {
  const parts = version.split(".").map(Number);
  return parts.length === 3 && parts.every((n) => !Number.isNaN(n)) ? `${parts[0]}.${parts[1]}.${parts[2] + 1}` : "9.9.9";
}

async function findUpdate(repo: string): Promise<Available | null> {
  const current = await getVersion();
  if (FAKE) {
    return {
      version: nextPatch(current),
      current,
      date: new Date().toISOString(),
      notes: [
        "Update button in the title bar, with what changed and Update and restart.",
        "A made-up second change, to see how the list looks.",
        "A made-up third change that is a bit longer, so it wraps onto a second line.",
      ],
      install: async (onEvent) => {
        const total = 14_372_066;
        onEvent({ event: "Started", data: { contentLength: total } });
        for (let done = 0; done < total; done += 420_000) {
          await new Promise((r) => setTimeout(r, 70));
          onEvent({ event: "Progress", data: { chunkLength: 420_000 } });
        }
        onEvent({ event: "Finished" });
      },
    };
  }
  const update = await check();
  if (!update) return null;
  return {
    version: update.version,
    current,
    date: update.date ?? null,
    notes: await releaseNotes(repo, update.version, update.body),
    install: (onEvent) => update.downloadAndInstall(onEvent),
  };
}

function megabytes(bytes: number) {
  return (bytes / 1_000_000).toFixed(1);
}

function released(date: string | null) {
  if (!date) return null;
  const d = new Date(date.replace(" ", "T").replace(/ .*$/, ""));
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export function UpdateButton(props: {
  /** The app's name, as in "Lookout 1.4.1". */
  app: string;
  /** The GitHub repository, "owner/name". */
  repo: string;
  /** Shown under the panel, about what restarting ends. */
  restartNote?: string;
  /** macOS notification when a new version is found. */
  notify: boolean;
}) {
  const [update, setUpdate] = useState<Available | null>(null);
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const ref = useRef<HTMLDivElement>(null);
  const notify = useRef(props.notify);
  notify.current = props.notify;

  useEffect(() => {
    let stopped = false;
    const run = async () => {
      const found = await findUpdate(props.repo).catch(() => null);
      if (stopped || !found) return;
      setUpdate(found);
      let seen: string | null = null;
      try {
        seen = localStorage.getItem(NOTIFIED_KEY);
        localStorage.setItem(NOTIFIED_KEY, found.version);
      } catch {
        // Storage off: no notification rather than one per check.
        seen = found.version;
      }
      if (seen !== found.version && notify.current) {
        sendNotification({ title: `${props.app} ${found.version} is available`, body: "Click Update in the title bar to install it." });
      }
    };
    const first = setTimeout(() => void run(), FAKE ? 1_500 : FIRST_CHECK_MS);
    const timer = setInterval(() => void run(), CHECK_EVERY_MS);
    return () => {
      stopped = true;
      clearTimeout(first);
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  if (!update) return null;

  const install = async () => {
    let total: number | null = null;
    let done = 0;
    setPhase({ kind: "downloading", done: 0, total: null });
    try {
      await update.install((event) => {
        if (event.event === "Started") total = event.data.contentLength ?? null;
        if (event.event === "Progress") done += event.data.chunkLength;
        setPhase({ kind: "downloading", done: total ? Math.min(done, total) : done, total });
      });
      setPhase({ kind: "restarting" });
      if (FAKE) {
        setTimeout(() => setPhase({ kind: "idle" }), 1_500);
        return;
      }
      await relaunch();
    } catch (e) {
      setPhase({ kind: "error", message: String(e instanceof Error ? e.message : e) });
    }
  };

  const busy = phase.kind === "downloading" || phase.kind === "restarting";
  const date = released(update.date);
  const percent = phase.kind === "downloading" && phase.total ? Math.round((phase.done / phase.total) * 100) : null;

  return (
    <div className="update" ref={ref}>
      <button
        type="button"
        className={`update-button${open ? " open" : ""}`}
        title={`${props.app} ${update.version} is available`}
        onClick={() => setOpen((o) => !o)}
      >
        {busy ? <Icon icon={Loading03Icon} size={14} className="update-spin" /> : <Icon icon={Download04Icon} size={14} />}
        <span>{busy ? (percent !== null ? `${percent}%` : "Updating") : "Update"}</span>
      </button>
      {open && (
        <div className="update-panel" onContextMenu={(e) => e.preventDefault()}>
          <div className="update-head">
            <img className="update-icon" src={appIcon} alt="" />
            <div className="update-title">
              <span className="update-name">
                {props.app} {update.version}
                <span className="update-badge">New</span>
              </span>
              <span className="update-meta">
                <span className="update-from">{update.current}</span>
                <Icon icon={ArrowRight02Icon} size={11} />
                <span className="update-to">{update.version}</span>
                {date && <span className="update-date">· {date}</span>}
              </span>
            </div>
          </div>
          {update.notes.length > 0 && (
            <div className="update-whatsnew">
              <span className="update-label">What's new</span>
              <ul className="update-notes">
                {update.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="update-foot">
            {phase.kind === "downloading" && (
              <div className="update-progress">
                <div className="update-bar">
                  <span style={{ width: percent !== null ? `${percent}%` : "30%" }} className={percent === null ? "indeterminate" : ""} />
                </div>
                <span className="update-progress-text">
                  {phase.total ? `Downloading ${megabytes(phase.done)} of ${megabytes(phase.total)} MB` : `Downloading ${megabytes(phase.done)} MB`}
                </span>
              </div>
            )}
            {phase.kind === "restarting" && <span className="update-status">Installed. Restarting {props.app}…</span>}
            {phase.kind === "error" && <span className="update-status error">The update failed: {phase.message}</span>}
            {!busy && (
              <span className="update-status">
                {props.app} restarts to finish.{props.restartNote ? ` ${props.restartNote}` : ""}
              </span>
            )}
            <div className="update-actions">
              <button type="button" className="update-link" onClick={() => void openUrl(`https://github.com/${props.repo}/releases/tag/v${update.version}`)}>
                Release notes <Icon icon={LinkSquare02Icon} size={12} />
              </button>
              <span className="spacer" />
              <button type="button" className="update-later" disabled={busy} onClick={() => setOpen(false)}>
                Later
              </button>
            </div>
            <button type="button" className="update-go" disabled={busy} onClick={() => void install()}>
              {phase.kind === "error" ? "Try again" : "Update and restart"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
