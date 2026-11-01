import { Plus } from "lucide-react";
import { useEffect, useState, type MouseEvent as ReactMouseEvent } from "react";
import type { SheetInfo } from "../api";

export function SheetTabs(props: {
  sheets: SheetInfo[];
  active: number;
  onSelect: (index: number) => void;
  onAdd: () => void;
  onRename: (index: number, name: string) => void;
  onMenu: (e: ReactMouseEvent, index: number) => void;
  /** Set by the tab menu's Rename item. */
  renameRequest: { index: number; token: number } | null;
}) {
  const [renaming, setRenaming] = useState<{ index: number; name: string } | null>(null);

  useEffect(() => {
    const index = props.renameRequest?.index;
    if (index !== undefined && props.sheets[index]) setRenaming({ index, name: props.sheets[index].name });
  }, [props.renameRequest?.token]);

  const finish = () => {
    if (renaming && renaming.name.trim() && renaming.name !== props.sheets[renaming.index]?.name) props.onRename(renaming.index, renaming.name.trim());
    setRenaming(null);
  };

  return (
    <div className="sheet-tabs">
      {props.sheets.map((s, i) =>
        s.hidden ? null : renaming?.index === i ? (
          <input
            key={`${s.name}${i}`}
            className="sheet-rename"
            autoFocus
            value={renaming.name}
            size={Math.max(6, renaming.name.length)}
            onChange={(e) => setRenaming({ index: i, name: e.target.value })}
            onBlur={finish}
            onFocus={(e) => e.currentTarget.select()}
            onKeyDown={(e) => {
              if (e.key === "Enter") finish();
              else if (e.key === "Escape") setRenaming(null);
            }}
          />
        ) : (
          <button
            type="button"
            key={`${s.name}${i}`}
            className={`sheet-tab${i === props.active ? " active" : ""}`}
            onClick={() => props.onSelect(i)}
            onDoubleClick={() => setRenaming({ index: i, name: s.name })}
            onContextMenu={(e) => {
              e.preventDefault();
              props.onMenu(e, i);
            }}
          >
            {s.color && <span className="tab-color" style={{ background: s.color }} />}
            {s.name}
          </button>
        ),
      )}
      <button type="button" className="sheet-add" title="Add sheet" onClick={props.onAdd}>
        <Plus size={14} />
      </button>
    </div>
  );
}
