import { Check } from "lucide-react";
import { useLayoutEffect, useEffect, useRef, useState, type ReactNode } from "react";

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  checked?: boolean;
  onSelect: () => void;
}

export type MenuEntry = MenuItem | "separator";

export interface MenuState {
  x: number;
  y: number;
  items: MenuEntry[];
}

export function ContextMenu({ menu, onClose }: { menu: MenuState; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: menu.x, top: menu.y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPosition({
      left: Math.min(menu.x, window.innerWidth - width - 8),
      top: menu.y + height > window.innerHeight - 8 ? Math.max(8, menu.y - height) : menu.y,
    });
  }, [menu]);

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
    <div ref={ref} className="context-menu" style={position} role="menu" onContextMenu={(e) => e.preventDefault()}>
      {menu.items.map((item, i) =>
        item === "separator" ? (
          <div key={i} className="menu-separator" />
        ) : (
          <button
            key={i}
            className={`menu-item${item.danger ? " danger" : ""}`}
            disabled={item.disabled}
            role="menuitem"
            onClick={() => {
              onClose();
              item.onSelect();
            }}
          >
            <span className="menu-icon">{item.icon}</span>
            <span className="menu-label">{item.label}</span>
            {item.shortcut && <span className="menu-shortcut">{item.shortcut}</span>}
            {item.checked && <Check size={14} className="menu-check" />}
          </button>
        ),
      )}
    </div>
  );
}
