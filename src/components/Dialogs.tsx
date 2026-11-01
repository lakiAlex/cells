import { ArrowUpDown, LoaderCircle, Plus, Sheet, TriangleAlert, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { SortKey } from "../api";
import { Dialog } from "./Dialog";

export function GoogleDialog(props: { onCancel: () => void; onOpen: (link: string) => Promise<string | null> }) {
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (!link.trim() || busy) return;
    setBusy(true);
    setError(await props.onOpen(link.trim()));
    setBusy(false);
  };
  return (
    <Dialog
      title="Open Google Sheet"
      icon={<Sheet size={18} />}
      width={520}
      onClose={props.onCancel}
      onSubmit={() => void submit()}
      footer={
        <>
          <span className="spacer" />
          <button type="button" className="button" onClick={props.onCancel}>
            Cancel
          </button>
          <button type="submit" className="button primary" disabled={!link.trim() || busy}>
            {busy && <LoaderCircle size={13} className="spin" />} Open
          </button>
        </>
      }
    >
      <label className="field">
        <span>Share link</span>
        <input
          value={link}
          placeholder="https://docs.google.com/spreadsheets/d/..."
          spellCheck={false}
          onChange={(e) => setLink(e.target.value)}
        />
      </label>
      {error ? (
        <p className="dialog-error">
          <TriangleAlert size={14} /> {error}
        </p>
      ) : (
        <p className="dialog-message">
          Works for sheets shared as "Anyone with the link can view". Cells downloads a copy of every tab. Edits stay in
          Cells; use Save As to keep them as an Excel or CSV file.
        </p>
      )}
    </Dialog>
  );
}

export function ChoiceDialog(props: {
  title: string;
  message: ReactNode;
  onCancel: () => void;
  actions: { label: string; kind?: "primary" | "danger-ghost"; onClick: () => void }[];
}) {
  const [secondary, ...rest] = props.actions;
  return (
    <Dialog
      title={props.title}
      onClose={props.onCancel}
      onSubmit={() => rest[rest.length - 1]?.onClick()}
      footer={
        <>
          {secondary && (
            <button type="button" className={`button ${secondary.kind ?? ""}`} onClick={secondary.onClick}>
              {secondary.label}
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="button" onClick={props.onCancel}>
            Cancel
          </button>
          {rest.map((action, i) => (
            <button
              key={action.label}
              type={i === rest.length - 1 ? "submit" : "button"}
              className={`button ${action.kind ?? ""}`}
              onClick={i === rest.length - 1 ? undefined : action.onClick}
              data-autofocus={i === rest.length - 1 ? true : undefined}
            >
              {action.label}
            </button>
          ))}
        </>
      }
    >
      <div className="dialog-message">{props.message}</div>
    </Dialog>
  );
}

export function InputDialog(props: {
  title: string;
  label: string;
  initial: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: (value: string) => void;
}) {
  const [value, setValue] = useState(props.initial);
  return (
    <Dialog
      title={props.title}
      onClose={props.onCancel}
      onSubmit={() => props.onConfirm(value)}
      footer={
        <>
          <span className="spacer" />
          <button type="button" className="button" onClick={props.onCancel}>
            Cancel
          </button>
          <button type="submit" className="button primary">
            {props.confirmLabel}
          </button>
        </>
      }
    >
      <label className="field">
        <span>{props.label}</span>
        <input value={value} spellCheck={false} onChange={(e) => setValue(e.target.value)} />
      </label>
    </Dialog>
  );
}

/** Sort by several columns: the first one decides, later ones break ties. */
export function SortDialog(props: {
  columns: { index: number; name: string }[];
  initial: SortKey[];
  header: boolean;
  onCancel: () => void;
  onApply: (keys: SortKey[]) => void;
}) {
  const [keys, setKeys] = useState<SortKey[]>(props.initial.length ? props.initial : [{ col: props.columns[0]?.index ?? 0, desc: false }]);
  const update = (i: number, key: SortKey) => setKeys(keys.map((k, j) => (j === i ? key : k)));
  const unused = props.columns.find((c) => !keys.some((k) => k.col === c.index));
  return (
    <Dialog
      title="Sort rows"
      icon={<ArrowUpDown size={18} />}
      width={480}
      onClose={props.onCancel}
      onSubmit={() => props.onApply(keys)}
      footer={
        <>
          <button type="button" className="button danger-ghost" onClick={() => props.onApply([])}>
            Remove sort
          </button>
          <span className="spacer" />
          <button type="button" className="button" onClick={props.onCancel}>
            Cancel
          </button>
          <button type="submit" className="button primary">
            Sort
          </button>
        </>
      }
    >
      <div className="sort-keys">
        {keys.map((key, i) => (
          <div key={i} className="sort-key">
            <span className="sort-key-label">{i === 0 ? "Sort by" : "Then by"}</span>
            <select value={key.col} onChange={(e) => update(i, { ...key, col: Number(e.target.value) })}>
              {props.columns.map((c) => (
                <option key={c.index} value={c.index}>
                  {c.name}
                </option>
              ))}
            </select>
            <select value={key.desc ? "desc" : "asc"} onChange={(e) => update(i, { ...key, desc: e.target.value === "desc" })}>
              <option value="asc">A to Z, 1 to 9</option>
              <option value="desc">Z to A, 9 to 1</option>
            </select>
            <button
              type="button"
              className="icon-button"
              title="Remove"
              disabled={keys.length === 1}
              onClick={() => setKeys(keys.filter((_, j) => j !== i))}
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
      {unused && (
        <button type="button" className="button small ghost" onClick={() => setKeys([...keys, { col: unused.index, desc: false }])}>
          <Plus size={13} /> Add column
        </button>
      )}
      <p className="dialog-message">
        {props.header ? "The header row stays on top. " : ""}Sorting changes the order rows are shown in. The file keeps its row order.
      </p>
    </Dialog>
  );
}
