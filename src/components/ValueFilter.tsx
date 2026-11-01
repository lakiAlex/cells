import { LoaderCircle, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Popover } from "./Popover";

const numberFormat = new Intl.NumberFormat();

/** Pick which values of a column are shown. */
export function ValueFilter(props: {
  anchor: DOMRect;
  column: string;
  values: [string, number][] | null;
  /** The shown values, or null when the column is not filtered. */
  shown: string[] | null;
  onApply: (shown: string[] | null) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const [checked, setChecked] = useState<Set<string> | null>(props.shown ? new Set(props.shown) : null);
  const all = props.values ?? [];
  const isChecked = (value: string) => checked === null || checked.has(value);
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return needle ? all.filter(([v]) => v.toLowerCase().includes(needle)) : all;
  }, [all, search]);

  const toggle = (value: string) => {
    const next = new Set(checked ?? all.map(([v]) => v));
    if (next.has(value)) next.delete(value);
    else next.add(value);
    setChecked(next.size === all.length ? null : next);
  };

  const setVisible = (on: boolean) => {
    const next = new Set(checked ?? all.map(([v]) => v));
    for (const [v] of visible) {
      if (on) next.add(v);
      else next.delete(v);
    }
    setChecked(next.size === all.length ? null : next);
  };

  return (
    <Popover anchor={props.anchor} onClose={props.onClose} className="value-filter">
      <div className="value-filter-title">Show rows where {props.column} is</div>
      <label className="filter">
        <Search size={13} />
        <input value={search} placeholder="Search values" spellCheck={false} autoFocus onChange={(e) => setSearch(e.target.value)} />
      </label>
      <div className="value-filter-actions">
        <button type="button" className="link-button" onClick={() => setVisible(true)}>
          Select all
        </button>
        <button type="button" className="link-button" onClick={() => setVisible(false)}>
          Clear
        </button>
      </div>
      <div className="value-list">
        {props.values === null && (
          <div className="value-loading">
            <LoaderCircle size={14} className="spin" /> Reading values
          </div>
        )}
        {visible.map(([value, count]) => (
          <label key={value} className="value-row">
            <input type="checkbox" checked={isChecked(value)} onChange={() => toggle(value)} />
            <span className="value-text">{value === "" ? <em>(Blank)</em> : value}</span>
            <span className="value-count">{numberFormat.format(count)}</span>
          </label>
        ))}
      </div>
      <div className="value-filter-footer">
        <button type="button" className="button small" onClick={props.onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="button small primary"
          disabled={checked !== null && checked.size === 0}
          onClick={() => props.onApply(checked === null ? null : [...checked])}
        >
          Apply
        </button>
      </div>
    </Popover>
  );
}
