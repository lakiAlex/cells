// The sidebar: icons from Hugeicons like the rest of the app, with the open
// panel's icon drawn bolder, and the recent files panel beside it.
import {
  Clock01Icon,
  FileAddIcon,
  FolderOpenIcon,
  Link04Icon,
  MoreHorizontalIcon,
  Search01Icon,
  SidebarLeftIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMemo, useState, type MouseEvent as ReactMouseEvent } from "react";
import type { RecentItem } from "../api";
import { FileSpreadsheet, Search, Sheet, X } from "./icons";

const ICONS = {
  recent: Clock01Icon,
  find: Search01Icon,
  new: FileAddIcon,
  open: FolderOpenIcon,
  google: Link04Icon,
  settings: MoreHorizontalIcon,
  sidebar: SidebarLeftIcon,
};

export type SidebarIconName = keyof typeof ICONS;

export function SidebarIcon({ name, filled = false, size = 24 }: { name: SidebarIconName; filled?: boolean; size?: number }) {
  return <HugeiconsIcon icon={ICONS[name]} size={size} strokeWidth={filled ? 2 : 1.6} />;
}

/** "~/Documents/Reports" for a file in that folder. */
export function folderOf(path: string): string {
  const parts = path.split("/");
  parts.pop();
  return parts.join("/").replace(/^\/Users\/[^/]+/, "~");
}

/** The file type a recent item is, for its icon color. */
export function recentKind(item: RecentItem): string {
  if (item.kind === "google") return "google";
  const ext = item.location.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "csv" || ext === "tsv") return "csv";
  if (ext === "ods") return "ods";
  return "excel";
}

export function RecentIcon({ item, size = 16 }: { item: RecentItem; size?: number }) {
  const kind = recentKind(item);
  return (
    <span className={`file-icon ${kind}`}>
      {kind === "google" ? <Sheet size={size} /> : <FileSpreadsheet size={size} />}
    </span>
  );
}

interface RecentPanelProps {
  recent: RecentItem[];
  activeLocation: string | null;
  onClose: () => void;
  onOpenRecent: (item: RecentItem) => void;
  onRecentMenu: (e: ReactMouseEvent, item: RecentItem) => void;
}

export function RecentPanel(props: RecentPanelProps) {
  const [query, setQuery] = useState("");
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? props.recent.filter((r) => r.title.toLowerCase().includes(q) || r.location.toLowerCase().includes(q)) : props.recent;
  }, [props.recent, query]);

  return (
    <div className="panel">
      <div className="panel-header">
        <span className="panel-title">Recent</span>
        <div className="panel-actions">
          <button type="button" className="icon-button" title="Close" onClick={props.onClose}>
            <X size={14} />
          </button>
        </div>
      </div>
      {props.recent.length > 4 && (
        <label className="panel-search">
          <Search size={13} />
          <input value={query} placeholder="Filter files" spellCheck={false} onChange={(e) => setQuery(e.target.value)} />
          {query && (
            <button type="button" className="filter-clear" title="Clear" onClick={() => setQuery("")}>
              <X size={9} strokeWidth={2.5} />
            </button>
          )}
        </label>
      )}
      <div className="recent-list">
        {props.recent.length === 0 && <div className="panel-empty">Files you open show up here.</div>}
        {props.recent.length > 0 && shown.length === 0 && <div className="panel-empty">No file matches.</div>}
        {shown.map((item) => (
          <button
            type="button"
            key={item.location}
            className={`recent-row${item.location === props.activeLocation ? " active" : ""}`}
            title={item.location}
            onClick={() => props.onOpenRecent(item)}
            onContextMenu={(e) => {
              e.preventDefault();
              props.onRecentMenu(e, item);
            }}
          >
            <RecentIcon item={item} />
            <span className="recent-text">
              <span className="recent-name">{item.title}</span>
              <span className="recent-where">{item.kind === "google" ? "Google Sheets" : folderOf(item.location)}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
