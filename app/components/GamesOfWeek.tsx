import { useMemo } from "react";

import { cap, shortDate } from "../../lib/format.mjs";
import { useViewState } from "../hooks/useViewState";
import { Dropdown } from "./Dropdown";
import { TeamName } from "./TeamName";
import type { Data, Game } from "../types";

/* "fav" or "dog" for one side of a matchup. A pick-em has no favourite and an
   unpriced game has no line, and in both cases neither side gets coloured. */
const side = (team: string, spread: { favorite: string | null } | null) =>
  !spread?.favorite ? "" : spread.favorite === team ? "fav" : "dog";

/* Rows can come from different books, and CFBD spells the same one both
   "DraftKings" and "Draft Kings", so list what is actually on screen. */
const books = (games: Game[]) => {
  const seen = [...new Set(games.filter((g) => g.spread)
    .map((g) => g.spread!.provider.replace(/\s+/g, "")))];
  if (!seen.length) return "the book";
  return seen.length === 1 ? seen[0] : seen.slice(0, -1).join(", ") + " and " + seen[seen.length - 1];
};

export function GamesOfWeek({ data }: { data: Data }) {
  /* empty = no manager filter, which shows only the head-to-heads */
  const [sel, setSel] = useViewState<string[]>("gow.managers", []);

  const managers = useMemo(
    () => data.standings.map((r) => r.manager).slice().sort(),
    [data]
  );

  /* No manager selected shows the head-to-heads, which is what the section has
     always been. Selecting managers switches to their full slate, since a
     manager's own week is mostly games against undrafted teams. */
  const games = useMemo(() => {
    const all = data.gamesOfWeek.games;
    /* A payload written before h2h existed has no flag to filter on, which
       would empty the section. Show everything until the data catches up. */
    const tagged = all.some((g) => typeof g.h2h === "boolean");
    if (!sel.length) return tagged ? all.filter((g) => g.h2h) : all;
    return all.filter(
      (g) =>
        (g.away.manager && sel.includes(g.away.manager)) ||
        (g.home.manager && sel.includes(g.home.manager))
    );
  }, [data, sel]);

  if (!data.gamesOfWeek.games.length) return null;

  return (
    <section>
      <h2>Games of the week</h2>
      <p className="muted sm">
        {data.gamesOfWeek.label} ·{" "}
        {sel.length === 0
          ? "both teams are drafted, so these move the table twice."
          : `every game for ${sel.map(cap).join(", ")} this week.`}
      </p>

      <div className="filters">
        <Dropdown
          name="gow"
          summary={
            sel.length === 0
              ? "Head to head only"
              : sel.length === 1
              ? cap(sel[0])
              : `${sel.length} managers`
          }
          allLabel="Head to head only"
          options={managers.map((m) => ({ value: m, label: cap(m) }))}
          selected={sel}
          onClear={() => setSel([])}
          onToggle={(m) =>
            setSel((v) => (v.includes(m) ? v.filter((x) => x !== m) : [...v, m]))
          }
        />
        <span className="muted sm">{games.length} games</span>
      </div>

      {games.map((g, i) => (
        <div className="gow" key={i}>
          <span className="mono muted d">{shortDate(g.date)}</span>
          <span className="mu">
            {g.away.manager ? <><b>{cap(g.away.manager)}</b>&rsquo;s{" "}</> : null}
            <TeamName team={g.away.team} label={g.away.draft} className={side(g.away.team, g.spread)} />
            {!g.away.manager && <span className="undr"> undrafted</span>}
            <span className="at">{g.neutral ? " vs " : " at "}</span>
            {g.home.manager ? <><b>{cap(g.home.manager)}</b>&rsquo;s{" "}</> : null}
            <TeamName team={g.home.team} label={g.home.draft} className={side(g.home.team, g.spread)} />
            {!g.home.manager && <span className="undr"> undrafted</span>}
            {g.sameManager && <em className="self"> both his</em>}
          </span>
          {g.spread && <span className="mono line">{g.spread.formatted}</span>}
          <span className="mono stakes">{g.stakes}pt</span>
        </div>
      ))}
      {!games.length && <p className="caption">No games match that filter.</p>}
      {data.linesFetchedAt && (
        <p className="caption">
          Spreads from {books(games)}, refreshed{" "}
          {new Date(data.linesFetchedAt).toLocaleString(undefined,
            { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}.
        </p>
      )}
    </section>
  );
}

export const css = `
    .line{color:var(--muted);font-size:11.5px;white-space:nowrap;flex-shrink:0}
    .fav{color:var(--teal)}
    .dog{color:var(--red)}
`;
