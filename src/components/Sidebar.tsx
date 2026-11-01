import { FilePlus2, FileSpreadsheet, FolderOpen, Link, Sheet, SquaresUnite } from "lucide-react";
import type { MouseEvent as ReactMouseEvent } from "react";
import type { RecentItem } from "../api";

interface SidebarProps {
  recent: RecentItem[];
  activeLocation: string | null;
  onNew: () => void;
  onOpenFile: () => void;
  onOpenGoogle: () => void;
  onOpenRecent: (item: RecentItem) => void;
  onRecentMenu: (e: ReactMouseEvent, item: RecentItem) => void;
}

function folderOf(path: string): string {
  const parts = path.split("/");
  parts.pop();
  const dir = parts.join("/");
  return dir.replace(/^\/Users\/[^/]+/, "~");
}

export function Sidebar(props: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="sidebar-titlebar" data-tauri-drag-region />
      <div className="brand" data-tauri-drag-region>
        <SquaresUnite size={15} strokeWidth={2} />
        <span className="brand-name">Cells</span>
        <span className="brand-sub">- Spreadsheet Editor</span>
      </div>

      <nav className="side-section">
        <button type="button" className="side-item" onClick={props.onNew}>
          <FilePlus2 size={16} className="side-icon" /> New Spreadsheet
        </button>
        <button type="button" className="side-item" onClick={props.onOpenFile}>
          <FolderOpen size={16} className="side-icon" /> Open File…
        </button>
        <button type="button" className="side-item" onClick={props.onOpenGoogle}>
          <Link size={16} className="side-icon" /> Open Google Sheet…
        </button>
      </nav>

      <div className="recent">
        <div className="recent-title">Recent</div>
        {props.recent.length === 0 && <div className="recent-empty">Files you open show up here.</div>}
        {props.recent.map((item) => (
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
            {item.kind === "google" ? <Sheet size={15} className="recent-icon google" /> : <FileSpreadsheet size={15} className="recent-icon" />}
            <span className="recent-text">
              <span className="recent-name">{item.title}</span>
              <span className="recent-where">{item.kind === "google" ? "Google Sheets" : folderOf(item.location)}</span>
            </span>
          </button>
        ))}
      </div>
    </aside>
  );
}
