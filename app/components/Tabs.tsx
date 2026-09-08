import { useRef } from "react";

import type { Lazy, Tab } from "../types";

/**
 * The tab strip, and the list of tabs itself.
 *
 * The list lives here rather than in the page because adding a tab is then one
 * entry in one file, plus the line in the page that composes the tab's own
 * component. `needs` says which lazy payload file the tab cannot render
 * without, which is what the page uses to decide when to ask for it - the core
 * is on screen the moment the page opens, and the other two are ~70% of the
 * bytes and invisible until a tab is clicked.
 */
export const TABS: { id: Tab; label: string; needs: Lazy | null }[] = [
  { id: "league", label: "Leaderboard", needs: null },
  { id: "teams", label: "All teams", needs: "teams" },
  { id: "h2h", label: "Activity", needs: "results" },
  { id: "trends", label: "Trends", needs: "results" },
];

/* The two halves of the tab/panel relationship have to agree on these, and
   they are in two different files, so neither writes the string itself. */
export const tabId = (t: Tab) => `tab-${t}`;
export const panelId = (t: Tab) => `panel-${t}`;

/**
 * Three unrelated buttons before this: nothing said they were three views of
 * one thing, and reaching the third meant tabbing past the first two.
 *
 * Now the ARIA tabs pattern. The strip is one stop in the page's tab order -
 * a roving `tabindex`, so Tab moves past the whole strip rather than through
 * it - and the arrows move within it, wrapping at both ends, with Home and End
 * for the ends.
 *
 * Activation follows focus, which the authoring practices recommend when
 * showing a panel is cheap. It is here: the payload is already in memory, and
 * a lazy file that has not arrived yet shows the same loading note it would
 * show on a click.
 */
export function Tabs({ active, onSelect }: { active: Tab; onSelect: (t: Tab) => void }) {
  const refs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});

  const onKeyDown = (e: React.KeyboardEvent, from: number) => {
    const last = TABS.length - 1;
    const to =
      e.key === "ArrowRight" ? (from === last ? 0 : from + 1)
      : e.key === "ArrowLeft" ? (from === 0 ? last : from - 1)
      : e.key === "Home" ? 0
      : e.key === "End" ? last
      : -1;
    if (to < 0) return;
    /* Left and Right scroll the page by default, and Home and End jump it to
       the ends, all of which would happen underneath the tab that just
       changed. */
    e.preventDefault();
    onSelect(TABS[to].id);
    refs.current[TABS[to].id]?.focus();
  };

  return (
    <nav className="tabs" role="tablist" aria-label="Views">
      {TABS.map((t, i) => (
        <button
          key={t.id}
          id={tabId(t.id)}
          ref={(el) => { refs.current[t.id] = el; }}
          role="tab"
          aria-selected={active === t.id}
          /* Only the open tab names a panel. The other two panels are not in
             the document - rendering them would put a table of nothing into a
             screen reader's path while its file is still on the wire - and an
             aria-controls pointing at an id that does not exist is a broken
             reference rather than a helpful one. */
          aria-controls={active === t.id ? panelId(t.id) : undefined}
          tabIndex={active === t.id ? 0 : -1}
          className={active === t.id ? "on" : ""}
          onClick={() => onSelect(t.id)}
          onKeyDown={(e) => onKeyDown(e, i)}
        >
          {t.label}
        </button>
      ))}
    </nav>
  );
}

export const css = `
    .tabs{display:flex;gap:6px;margin-bottom:14px}
    .tabs button{flex:1;background:transparent;border:1px solid var(--rule);color:var(--muted);
      border-radius:6px;padding:9px 4px;font-size:13px;font-weight:600;cursor:pointer;
      font-family:inherit;white-space:nowrap}
    .tabs button.on{background:var(--chalk);border-color:var(--chalk);color:var(--ink)}
    @media (max-width:430px){
      .tabs button{font-size:12px;padding:9px 2px}
    }
`;
