import { useRef, type ReactNode } from "react";

import { useDismiss } from "../hooks/useDismiss";
import { useViewState } from "../hooks/useViewState";

export type Option = { value: string; label: string; badge?: ReactNode };

/**
 * The multi-select the page uses three times: conferences on All teams,
 * managers on Games of the week, managers on Activity.
 *
 * It was three copies of the same forty lines, differing only in their labels
 * and in one of them carrying a tier badge per option. Three copies is three
 * places to fix anything wrong with it, and the keyboard was wrong in all
 * three - which is a good argument on its own for there being one.
 *
 * The empty selection means "all", and the caller decides what to call that.
 * Storing the selection rather than the exclusion is what keeps "all" stable
 * when a conference is added or renamed.
 */
export function Dropdown({
  name,
  summary,
  allLabel,
  options,
  selected,
  onToggle,
  onClear,
}: {
  /* unique among the dropdowns on the page: it keys whether this one is
     open, which outlives the tab switch that unmounts it */
  name: string;
  /* what the closed button reads: the caller knows whether "2 selected" is two
     managers or two conferences */
  summary: string;
  allLabel: string;
  options: Option[];
  selected: string[];
  onToggle: (value: string) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useViewState(`${name}.open`, false);
  const ref = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useDismiss(open, ref, setOpen, trigger);
  const menu = `${name}-menu`;

  return (
    <div className="dd" ref={ref}>
      <button
        ref={trigger}
        className={`ddbtn ${selected.length ? "act" : ""}`}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={menu}
      >
        {summary}
        {/* the caret repeats what aria-expanded already says, so it is
            decoration and is announced as nothing */}
        <span className={`ddcaret ${open ? "up" : ""}`} aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="ddmenu" id={menu} role="group" aria-label={allLabel}>
          <label className="ddopt">
            <input type="checkbox" checked={selected.length === 0} onChange={onClear} />
            <span className="ddname">{allLabel}</span>
          </label>
          <div className="ddsep" />
          {options.map((o) => (
            <label key={o.value} className="ddopt">
              <input
                type="checkbox"
                checked={selected.includes(o.value)}
                onChange={() => onToggle(o.value)}
              />
              <span className="ddname">{o.label}</span>
              {o.badge}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

export const css = `
    .dd{position:relative}
    .ddbtn{display:flex;align-items:center;gap:7px;background:transparent;border:1px solid var(--rule);
      color:var(--chalk);border-radius:6px;padding:7px 11px;font-size:12.5px;cursor:pointer;
      font-family:inherit;white-space:nowrap}
    .ddbtn.act{border-color:var(--amber);color:var(--amber)}
    .ddcaret{color:var(--muted);font-size:10px;transition:transform .15s}
    .ddcaret.up{transform:rotate(180deg)}
    .ddmenu{position:absolute;z-index:20;top:calc(100% + 5px);left:0;min-width:210px;
      background:var(--panel);border:1px solid var(--rule);border-radius:7px;padding:5px;
      box-shadow:0 10px 26px rgba(0,0,0,.45)}
    .ddopt{display:flex;align-items:center;gap:8px;padding:6px 7px;font-size:12.5px;
      border-radius:5px;cursor:pointer}
    .ddopt:hover{background:rgba(42,61,83,.5)}
    .ddopt input{cursor:pointer;flex-shrink:0;margin:0}
    .ddname{flex:1}
    .ddsep{height:1px;background:var(--rule);margin:4px 7px}
`;
