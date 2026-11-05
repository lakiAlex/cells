import { Check, ChevronRight } from "./icons";
import { useLayoutEffect, useEffect, useRef, useState, type ReactNode } from "react";

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  shortcut?: string;
  /** Gray text on the right, like the current value of a setting. */
  detail?: string;
  danger?: boolean;
  disabled?: boolean;
  checked?: boolean;
  onSelect?: () => void;
  /** Items shown in a menu beside this one, opened on hover. */
  submenu?: MenuList;
}

export type MenuEntry = MenuItem | "separator";

export interface MenuList {
  /** A heading above the items, with an optional line explaining them. */
  title?: string;
  note?: string;
  items: MenuEntry[];
}

export interface MenuState extends MenuList {
  x: number;
  y: number;
}

export function ContextMenu({ menu, onClose }: { menu: MenuState; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: Event) => {
      if (e instanceof MouseEvent && ref.current?.contains(e.target as Node)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", close, true);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", close, true);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div ref={ref} style={{ display: "contents" }}>
      <MenuPanel list={menu} x={menu.x} y={menu.y} onClose={onClose} />
    </div>
  );
}

interface SubmenuAnchor {
  index: number;
  /** The parent menu's right and left edges, and the item's top. */
  right: number;
  left: number;
  top: number;
}

/** One menu box. A submenu opens beside it, on the left when the right side has no room. */
function MenuPanel(props: { list: MenuList; x: number; y: number; flipX?: number; submenu?: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: props.x, top: props.y });
  const [open, setOpen] = useState<SubmenuAnchor | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const overflowX = props.x + width > window.innerWidth - 8;
    const overflowY = props.y + height > window.innerHeight - 8;
    setPosition({
      left: overflowX ? (props.flipX !== undefined ? props.flipX - width : window.innerWidth - width - 8) : props.x,
      // A context menu opens upward from the pointer; a submenu moves up just enough to fit.
      top: overflowY ? Math.max(8, props.submenu ? window.innerHeight - height - 8 : props.y - height) : props.y,
    });
  }, [props.x, props.y, props.flipX, props.submenu]);

  const showSubmenu = (index: number, target: HTMLElement) => {
    const panel = ref.current!.getBoundingClientRect();
    setOpen({ index, right: panel.right + 2, left: panel.left - 2, top: target.getBoundingClientRect().top - 4 });
  };

  const openItem = open ? props.list.items[open.index] : null;

  return (
    <>
      <div ref={ref} className="context-menu" style={position} role="menu" onContextMenu={(e) => e.preventDefault()}>
        {props.list.title && (
          <>
            <div className="menu-header">
              <div className="menu-title">{props.list.title}</div>
              {props.list.note && <div className="menu-note">{props.list.note}</div>}
            </div>
            <div className="menu-separator" />
          </>
        )}
        {props.list.items.map((item, i) =>
          item === "separator" ? (
            <div key={i} className="menu-separator" />
          ) : (
            <button
              key={i}
              className={`menu-item${item.danger ? " danger" : ""}${open?.index === i ? " open" : ""}`}
              disabled={item.disabled}
              role="menuitem"
              aria-haspopup={item.submenu ? "menu" : undefined}
              onMouseEnter={(e) => (item.submenu ? showSubmenu(i, e.currentTarget) : setOpen(null))}
              onClick={(e) => {
                if (item.submenu) return showSubmenu(i, e.currentTarget);
                props.onClose();
                item.onSelect?.();
              }}
            >
              <span className="menu-icon">{item.icon}</span>
              <span className="menu-label">{item.label}</span>
              {item.detail && <span className="menu-detail">{item.detail}</span>}
              {item.shortcut && <span className="menu-shortcut">{item.shortcut}</span>}
              {item.checked && <Check size={14} className="menu-check" />}
              {item.submenu && <ChevronRight size={14} className="menu-chevron" />}
            </button>
          ),
        )}
      </div>
      {open && openItem && openItem !== "separator" && openItem.submenu && (
        <MenuPanel key={open.index} list={openItem.submenu} x={open.right} y={open.top} flipX={open.left} submenu onClose={props.onClose} />
      )}
    </>
  );
}
