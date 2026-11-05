import { CaseSensitive, ChevronDown, ChevronRight, ChevronUp, Search, WholeWord, X } from "./icons";
import { useEffect, useRef, useState } from "react";
import type { FindOptions } from "../api";

interface FindBarProps {
  options: FindOptions;
  count: number | null;
  index: number;
  focusToken: number;
  onOptions: (options: FindOptions) => void;
  onStep: (direction: 1 | -1) => void;
  onReplace: (replacement: string) => void;
  onReplaceAll: (replacement: string) => void;
  onClose: () => void;
}

export function FindBar(props: FindBarProps) {
  const [showReplace, setShowReplace] = useState(false);
  const [replacement, setReplacement] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const { options } = props;

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [props.focusToken]);

  const counter =
    props.count === null || !options.query ? "" : props.count === 0 ? "No results" : `${props.index + 1} of ${props.count}${props.count >= 10000 ? "+" : ""}`;

  return (
    <div
      className="findbar"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          props.onClose();
        }
      }}
    >
      <button
        type="button"
        className="tool"
        title={showReplace ? "Hide replace" : "Show replace"}
        onClick={() => setShowReplace((s) => !s)}
      >
        {showReplace ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>
      <label className="filter find-input">
        <Search size={13} />
        <input
          ref={inputRef}
          value={options.query}
          placeholder="Find"
          spellCheck={false}
          onChange={(e) => props.onOptions({ ...options, query: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              props.onStep(e.shiftKey ? -1 : 1);
            }
          }}
        />
        <span className="find-count">{counter}</span>
      </label>
      <button
        type="button"
        className={`tool${options.matchCase ? " on" : ""}`}
        title="Match case"
        onClick={() => props.onOptions({ ...options, matchCase: !options.matchCase })}
      >
        <CaseSensitive size={16} />
      </button>
      <button
        type="button"
        className={`tool${options.wholeCell ? " on" : ""}`}
        title="Match whole cell"
        onClick={() => props.onOptions({ ...options, wholeCell: !options.wholeCell })}
      >
        <WholeWord size={16} />
      </button>
      <button type="button" className="tool" title="Previous (⇧↩)" disabled={!props.count} onClick={() => props.onStep(-1)}>
        <ChevronUp size={15} />
      </button>
      <button type="button" className="tool" title="Next (↩)" disabled={!props.count} onClick={() => props.onStep(1)}>
        <ChevronDown size={15} />
      </button>
      {showReplace && (
        <>
          <label className="filter find-input">
            <input
              value={replacement}
              placeholder="Replace with"
              spellCheck={false}
              onChange={(e) => setReplacement(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  props.onReplace(replacement);
                }
              }}
            />
          </label>
          <button type="button" className="button small" disabled={!props.count} onClick={() => props.onReplace(replacement)}>
            Replace
          </button>
          <button type="button" className="button small" disabled={!props.count} onClick={() => props.onReplaceAll(replacement)}>
            Replace All
          </button>
        </>
      )}
      <span className="tool-spacer" />
      <button type="button" className="tool" title="Close (Esc)" onClick={props.onClose}>
        <X size={15} />
      </button>
    </div>
  );
}
