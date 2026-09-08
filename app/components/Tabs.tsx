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
];

export function Tabs({ active, onSelect }: { active: Tab; onSelect: (t: Tab) => void }) {
  return (
    <nav className="tabs">
      {TABS.map((t) => (
        <button
          key={t.id}
          className={active === t.id ? "on" : ""}
          onClick={() => onSelect(t.id)}
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
