import { useEffect, useRef, type ReactNode } from "react";

interface DialogProps {
  title: string;
  icon?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
  onClose: () => void;
  onSubmit?: () => void;
}

export function Dialog({ title, icon, children, footer, width = 440, onClose, onSubmit }: DialogProps) {
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>("[data-autofocus], input:not([type=checkbox]), select, textarea");
    el?.focus();
    if (el instanceof HTMLInputElement) el.select();
  }, []);

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        ref={ref}
        className="dialog"
        style={{ width }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
          }
        }}
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit?.();
        }}
      >
        <div className="dialog-header">
          {icon && <span className="dialog-icon">{icon}</span>}
          <h2>{title}</h2>
        </div>
        <div className="dialog-body">{children}</div>
        {footer && <div className="dialog-footer">{footer}</div>}
      </form>
    </div>
  );
}
