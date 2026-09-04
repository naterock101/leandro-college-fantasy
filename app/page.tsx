"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/* Reads the JSON the GitHub Action commits. Fetching from raw.githubusercontent
   rather than /standings.json means data updates without a Vercel redeploy,
   which matters because the bot commits every 10 minutes during games. */
const SOURCE =
  "https://raw.githubusercontent.com/naterock101/leandro-college-fantasy/main/public/standings.json";

/* Fallback for local dev and for the window before the bot's first commit
   exists on main: the copy bundled with this deploy. Stale by design, only
   reached when the live fetch fails. */
const FALLBACK = "/standings.json";

type TeamRow = {
  team: string; draft: string; conf: string; tier: "p4" | "g5";
  wins: number; losses: number; points: number; remaining: number; ceiling: number;
};
type Row = {
  manager: string; points: number; wins: number; losses: number;
  remaining: number; ceiling: number; collisionLoss: number;
  teams: Record<string, TeamRow>;
};
/* manager is null on the undrafted side of a game, where draft falls back to
   the school name. */
type Side = { team: string; manager: string | null; tier: "p4" | "g5" | null; draft: string };
type Data = {
  generatedAt: string;
  season: number;
  postseasonScheduled: boolean;
  standings: Row[];
  byWeek: { key: string; label: string; seasonType: string; week: number; games: number;
            delta: Record<string, number>;
            cumulative: Record<string, { points: number; wins: number; losses: number }> }[];
  linesFetchedAt: string | null;
  projection: {
    label: string; games: number; projected: number; unprojected: number;
    managers: Record<string, { wins: number; losses: number; points: number;
                               gained: number; rankDelta: number }>;
  } | null;
  gamesOfWeek: { label: string | null; games: {
    date: string; away: Side; home: Side; neutral: boolean; sameManager: boolean;
    stakes: number; h2h: boolean;
    spread: { spread: number; favorite: string | null; formatted: string;
              overUnder: number | null; provider: string } | null }[] };
  byConference: Record<string, {
    team: string; tier: "p4" | "g5"; wins: number; losses: number;
    points: number; remaining: number; manager: string | null }[]>;
  headToHead: { week: number; seasonType: string;
                date: string; score: string; sameManager: boolean; upset: boolean;
                spread: { spread: number; favorite: string | null; formatted: string;
                          overUnder: number | null; provider: string } | null;
                winner: { team: string; manager: string }; loser: { team: string; manager: string } }[];
  /* Absent from any payload the bot wrote before the timeline shipped, so the
     page must render without it rather than assume the bot has caught up. */
  results?: { key: string; week: number; seasonType: string; date: string;
              score: string; points: number; h2h: boolean; sameManager: boolean;
              upset: boolean; line: string | null;
              winner: ScoredSide; loser: ScoredSide }[];
};
type ScoredSide = { team: string; manager: string | null };

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/* "fav" or "dog" for one side of a matchup. A pick-em has no favourite and an
   unpriced game has no line, and in both cases neither side gets coloured. */
const side = (
  team: string,
  spread: { favorite: string | null } | null
) => (!spread?.favorite ? "" : spread.favorite === team ? "fav" : "dog");

/* Rows can come from different books, and CFBD spells the same one both
   "DraftKings" and "Draft Kings", so list what is actually on screen. */
const books = (games: { spread: { provider: string } | null }[]) => {
  const seen = [...new Set(games.filter((g) => g.spread)
    .map((g) => g.spread!.provider.replace(/\s+/g, "")))];
  if (!seen.length) return "the book";
  return seen.length === 1 ? seen[0] : seen.slice(0, -1).join(", ") + " and " + seen[seen.length - 1];
};
const shortDate = (d?: string) =>
  d ? new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";

/* Folds accents and punctuation so "san jose st" finds "San Jose State" and
   "texas am" finds "Texas A&M". */
const norm = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/* Three dropdowns now close on an outside click, so it lives in one place.
   `set` must be a state setter or another stable function, since the effect
   resubscribes whenever it changes identity. */
function useClickAway(
  open: boolean,
  ref: React.RefObject<HTMLDivElement | null>,
  set: (v: boolean) => void
) {
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) set(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open, ref, set]);
}

/* "Adam's Buffalo", or the bare school when nobody drafted it. Undrafted sides
   are the common case in the timeline, so they are labelled rather than left
   sitting next to an owned team looking like missing data. */
function Owned({ side }: { side: ScoredSide }) {
  return side.manager ? (
    <>
      <b>{cap(side.manager)}</b>&rsquo;s {side.team}
    </>
  ) : (
    <>
      {side.team}
      <span className="undr"> undrafted</span>
    </>
  );
}

export default function Page() {
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<"league" | "teams" | "h2h">("league");
  const [week, setWeek] = useState(-1);
  const [open, setOpen] = useState<string | null>(null);
  /* empty = every conference. Storing the selection rather than the exclusion
     keeps "all" stable when a conference is added or renamed. */
  const [confSel, setConfSel] = useState<string[]>([]);
  const [draftSel, setDraftSel] = useState<"all" | "drafted" | "undrafted">("all");
  const [confOpen, setConfOpen] = useState(false);
  const ddRef = useRef<HTMLDivElement>(null);
  /* free text over school names, so "is Baylor taken" is one keystroke rather
     than a scroll through 130-odd rows */
  const [q, setQ] = useState("");
  /* empty = no manager filter, which shows only the head-to-heads */
  const [gowSel, setGowSel] = useState<string[]>([]);
  const [gowOpen, setGowOpen] = useState(false);
  const gowRef = useRef<HTMLDivElement>(null);
  /* empty = every manager */
  const [h2hSel, setH2hSel] = useState<string[]>([]);
  const [h2hOpen, setH2hOpen] = useState(false);
  const h2hRef = useRef<HTMLDivElement>(null);
  /* head to head is the argument, the timeline is the whole week */
  const [view, setView] = useState<"h2h" | "timeline">("h2h");

  useEffect(() => {
    let alive = true;
    const grab = (url: string) =>
      fetch(`${url}?t=${Date.now()}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))));
    const load = () =>
      grab(SOURCE)
        .catch(() => grab(FALLBACK))
        .then((d) => { if (alive) { setData(d); setErr(null); } })
        .catch((e) => alive && setErr(e.message));
    load();
    const id = setInterval(load, 120_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  useClickAway(confOpen, ddRef, setConfOpen);
  useClickAway(gowOpen, gowRef, setGowOpen);
  useClickAway(h2hOpen, h2hRef, setH2hOpen);

  /* One flat table of every FBS team, ranked on points across all ten
     conferences rather than within each one. */
  const allTeams = useMemo(() => {
    if (!data) return [];
    return Object.entries(data.byConference)
      .flatMap(([conf, teams]) => teams.map((t) => ({ ...t, conf })))
      .sort((a, b) => b.points - a.points || b.wins - a.wins || a.team.localeCompare(b.team));
  }, [data]);

  const confs = useMemo(() => (data ? Object.keys(data.byConference) : []), [data]);

  const confTier = useMemo(() => {
    const m: Record<string, "p4" | "g5"> = {};
    for (const t of allTeams) m[t.conf] ??= t.tier;
    return m;
  }, [allTeams]);

  /* The searchable words, which is not the same as "the box is non-empty": a
     query of pure punctuation normalises away to nothing and must be treated as
     no search at all, or the caption claims a filter that never ran. */
  const words = useMemo(() => norm(q).split(" ").filter(Boolean), [q]);
  const searching = words.length > 0;

  /* Two passes, because neither alone is enough. Every word has to hit, in any
     order, so "state san" still finds San Jose State; and the whole query runs
     again with the spaces closed up, so "texas am" finds Texas A&M, whose
     ampersand normalises to a word break. */
  const teamRows = useMemo(() => {
    const tight = words.join("");
    const hit = (team: string) => {
      const hay = norm(team);
      return words.every((w) => hay.includes(w)) || hay.replace(/ /g, "").includes(tight);
    };
    return allTeams.filter(
      (t) =>
        (confSel.length === 0 || confSel.includes(t.conf)) &&
        (draftSel === "all" || (draftSel === "drafted" ? !!t.manager : !t.manager)) &&
        (!searching || hit(t.team))
    );
  }, [allTeams, confSel, draftSel, words, searching]);

  /* A poll that falls back to the bundled copy can return fewer weeks than the
     one this index was picked against, so never trust it to still be in range. */
  const weekIdx = week >= 0 && data && week < data.byWeek.length ? week : -1;

  const managers = useMemo(
    () => (data ? data.standings.map((r) => r.manager).slice().sort() : []),
    [data]
  );

  /* No manager selected shows the head-to-heads, which is what the section has
     always been. Selecting managers switches to their full slate, since a
     manager's own week is mostly games against undrafted teams. */
  const gowGames = useMemo(() => {
    if (!data) return [];
    const all = data.gamesOfWeek.games;
    /* A payload written before h2h existed has no flag to filter on, which
       would empty the section. Show everything until the data catches up. */
    const tagged = all.some((g) => typeof g.h2h === "boolean");
    if (!gowSel.length) return tagged ? all.filter((g) => g.h2h) : all;
    return all.filter(
      (g) =>
        (g.away.manager && gowSel.includes(g.away.manager)) ||
        (g.home.manager && gowSel.includes(g.home.manager))
    );
  }, [data, gowSel]);

  /* headToHead is written oldest first; the history reads newest first. */
  const h2hGames = useMemo(() => {
    if (!data) return [];
    return data.headToHead
      .filter(
        (h) =>
          h2hSel.length === 0 ||
          h2hSel.includes(h.winner.manager) ||
          h2hSel.includes(h.loser.manager)
      )
      .reverse();
  }, [data, h2hSel]);

  /* Newest first the whole way down: weeks descend, and within a week the games
     descend too, so the very top of the page is the last game that finished. */
  const timeline = useMemo(() => {
    const all = data?.results ?? [];
    const keep = all.filter(
      (r) =>
        h2hSel.length === 0 ||
        (r.winner.manager && h2hSel.includes(r.winner.manager)) ||
        (r.loser.manager && h2hSel.includes(r.loser.manager))
    );
    const weeks = new Map<string, typeof keep>();
    for (const r of keep) {
      if (!weeks.has(r.key)) weeks.set(r.key, []);
      weeks.get(r.key)!.push(r);
    }
    return [...weeks.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([key, games]) => ({
        key,
        label: games[0].seasonType === "postseason"
          ? `Postseason ${games[0].week}`
          : `Week ${games[0].week}`,
        games: games.slice().reverse(),
        /* Points belong to the winner, so a filtered week counts only the wins
           the selected managers actually had - their team losing to another
           manager's team is in `games`, but those points are not theirs.
           Unfiltered, this is every point the league scored that week. */
        points: games.reduce(
          (n, g) =>
            g.winner.manager && (h2hSel.length === 0 || h2hSel.includes(g.winner.manager))
              ? n + g.points
              : n,
          0
        ),
      }));
  }, [data, h2hSel]);

  const board = useMemo(() => {
    if (!data) return null;
    if (weekIdx < 0) return data.standings.map((r) => ({ ...r, delta: 0, live: true }));
    const w = data.byWeek[weekIdx];
    return Object.entries(w.cumulative)
      .map(([manager, c]) => {
        const base = data.standings.find((s) => s.manager === manager)!;
        return { ...base, points: c.points, wins: c.wins, losses: c.losses,
                 delta: w.delta[manager] ?? 0, live: false };
      })
      .sort((a, b) => b.points - a.points || b.wins - a.wins || a.manager.localeCompare(b.manager));
  }, [data, weekIdx]);

  if (err) return <main className="wrap"><p className="err">Could not load standings ({err}). Check SOURCE.</p><Style /></main>;
  if (!data || !board) return <main className="wrap"><p className="muted">Loading…</p><Style /></main>;

  const live = weekIdx < 0;
  const stamp = new Date(data.generatedAt);

  return (
    <main className="wrap">
      <header>
        <div className="brand">
          <img src="/logo.png" alt="" width={51} height={130} className="mark" />
          <div>
            <h1>Austin College Football Fantasy League</h1>
            <div className="muted sm">
              Updated {stamp.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
            </div>
          </div>
        </div>
      </header>

      <nav className="tabs">
        <button className={tab === "league" ? "on" : ""} onClick={() => setTab("league")}>Leaderboard</button>
        <button className={tab === "teams" ? "on" : ""} onClick={() => setTab("teams")}>All teams</button>
        <button className={tab === "h2h" ? "on" : ""} onClick={() => setTab("h2h")}>Activity</button>
      </nav>

      {tab === "league" && (
        <>
          <div className="weeks">
            <button className={live ? "on" : ""} onClick={() => setWeek(-1)}>Live</button>
            {data.byWeek.map((w, i) => (
              <button key={w.key} className={weekIdx === i ? "on" : ""} onClick={() => setWeek(i)} title={`${w.games} games`}>
                {w.seasonType === "postseason" ? `P${w.week}` : w.week}
              </button>
            ))}
          </div>
          {!live && <p className="asof">As of {data.byWeek[weekIdx].label.toLowerCase()} · {data.byWeek[weekIdx].games} games scored</p>}

          <table>
            <thead>
              <tr>
                <th className="r">#</th><th>Manager</th>
                <th className="r">W-L</th>
                {live && data.projection && <th className="r">Proj</th>}
                <th className="r">Pts</th>
                <th className="r">{live ? "Left" : "+/-"}</th><th className="r">Ceil</th>
              </tr>
            </thead>
            <tbody>
              {board.map((r, i) => {
                const isOpen = open === r.manager;
                const teams = Object.values(r.teams).sort((a, b) => b.points - a.points || a.draft.localeCompare(b.draft));
                return [
                  <tr key={r.manager} className="row" onClick={() => setOpen(isOpen ? null : r.manager)}>
                    <td className="r rank">{i + 1}</td>
                    <td className="name">{cap(r.manager)}<span className={`caret ${isOpen ? "up" : ""}`}>›</span></td>
                    <td className="r mono">{r.wins}-{r.losses}</td>
                    {live && data.projection && (() => {
                      const pr = data.projection!.managers[r.manager];
                      if (!pr) return <td className="r mono muted">-</td>;
                      const dir = pr.rankDelta > 0 ? "up" : pr.rankDelta < 0 ? "down" : "flat";
                      return (
                        <td className="r mono proj">
                          {pr.wins}-{pr.losses}
                          <span
                            className={`arrow ${dir}`}
                            title={dir === "flat"
                              ? "Projected to hold this position"
                              : `Projected to move ${Math.abs(pr.rankDelta)} ${dir}`}
                          >
                            {dir === "up" ? "▲" : dir === "down" ? "▼" : "–"}
                          </span>
                        </td>
                      );
                    })()}
                    <td className="r pts">{r.points}</td>
                    <td className="r mono muted">{live ? r.remaining : r.delta > 0 ? `+${r.delta}` : "0"}</td>
                    <td className="r mono ceil">{r.ceiling}</td>
                  </tr>,
                  isOpen && (
                    <tr key={r.manager + "-d"} className="detail">
                      <td colSpan={live && data.projection ? 7 : 6}>
                        {teams.map((t) => (
                          <div className="team" key={t.team}>
                            <span className={`tier ${t.tier}`}>{t.tier === "p4" ? 3 : 2}</span>
                            <span className="tn">{t.draft}</span>
                            <span className="mono muted cf">{t.conf}</span>
                            <span className="mono wl">{t.wins}-{t.losses}</span>
                            <span className="mono tp">{t.points}</span>
                          </div>
                        ))}
                        {r.collisionLoss > 0 && (
                          <div className="note">
                            Ceiling docked {r.collisionLoss} for upcoming games between two of your own teams.
                          </div>
                        )}
                      </td>
                    </tr>
                  ),
                ];
              })}
            </tbody>
          </table>

          <p className="caption">
            {live && data.projection && (
              <>
                Proj is W-L after {data.projection.label.toLowerCase()} if every betting
                favourite wins, and the arrow is where that would move you in the table.
                {data.projection.unprojected > 0 &&
                  ` ${data.projection.unprojected} of ${data.projection.games} games have no line and are left out.`}{" "}
              </>
            )}
            Ceiling is current points plus every remaining scheduled game, less any games
            between two of your own teams.{" "}
            {data.postseasonScheduled
              ? "Bowl and playoff games are now scheduled and are included."
              : "Conference championship, bowl and playoff games are not projected. They will raise these numbers once they are scheduled in December."}
          </p>

          {data.gamesOfWeek.games.length > 0 && (
            <section>
              <h2>Games of the week</h2>
              <p className="muted sm">
                {data.gamesOfWeek.label} ·{" "}
                {gowSel.length === 0
                  ? "both teams are drafted, so these move the table twice."
                  : `every game for ${gowSel.map(cap).join(", ")} this week.`}
              </p>

              <div className="filters">
                <div className="dd" ref={gowRef}>
                  <button
                    className={`ddbtn ${gowSel.length ? "act" : ""}`}
                    onClick={() => setGowOpen((o) => !o)}
                    aria-expanded={gowOpen}
                  >
                    {gowSel.length === 0
                      ? "Head to head only"
                      : gowSel.length === 1
                      ? cap(gowSel[0])
                      : `${gowSel.length} managers`}
                    <span className={`ddcaret ${gowOpen ? "up" : ""}`}>▾</span>
                  </button>
                  {gowOpen && (
                    <div className="ddmenu">
                      <label className="ddopt">
                        <input
                          type="checkbox"
                          checked={gowSel.length === 0}
                          onChange={() => setGowSel([])}
                        />
                        <span className="ddname">Head to head only</span>
                      </label>
                      <div className="ddsep" />
                      {managers.map((m) => (
                        <label key={m} className="ddopt">
                          <input
                            type="checkbox"
                            checked={gowSel.includes(m)}
                            onChange={() =>
                              setGowSel((v) => (v.includes(m) ? v.filter((x) => x !== m) : [...v, m]))
                            }
                          />
                          <span className="ddname">{cap(m)}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
                <span className="muted sm">{gowGames.length} games</span>
              </div>

              {gowGames.map((g, i) => (
                <div className="gow" key={i}>
                  <span className="mono muted d">{shortDate(g.date)}</span>
                  <span className="mu">
                    {g.away.manager ? <><b>{cap(g.away.manager)}</b>&rsquo;s{" "}</> : null}
                    <span className={side(g.away.team, g.spread)}>{g.away.draft}</span>
                    {!g.away.manager && <span className="undr"> undrafted</span>}
                    <span className="at">{g.neutral ? " vs " : " at "}</span>
                    {g.home.manager ? <><b>{cap(g.home.manager)}</b>&rsquo;s{" "}</> : null}
                    <span className={side(g.home.team, g.spread)}>{g.home.draft}</span>
                    {!g.home.manager && <span className="undr"> undrafted</span>}
                    {g.sameManager && <em className="self"> both his</em>}
                  </span>
                  {g.spread && <span className="mono line">{g.spread.formatted}</span>}
                  <span className="mono stakes">{g.stakes}pt</span>
                </div>
              ))}
              {!gowGames.length && <p className="caption">No games match that filter.</p>}
              {data.linesFetchedAt && (
                <p className="caption">
                  Spreads from {books(gowGames)}, refreshed{" "}
                  {new Date(data.linesFetchedAt).toLocaleString(undefined,
                    { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}.
                </p>
              )}
            </section>
          )}

        </>
      )}

      {tab === "teams" && (
        <>
          <div className="filters">
            <div className="dd" ref={ddRef}>
              <button
                className={`ddbtn ${confSel.length ? "act" : ""}`}
                onClick={() => setConfOpen((o) => !o)}
                aria-expanded={confOpen}
              >
                {confSel.length === 0
                  ? "All conferences"
                  : confSel.length === 1
                  ? confSel[0]
                  : `${confSel.length} conferences`}
                <span className={`ddcaret ${confOpen ? "up" : ""}`}>▾</span>
              </button>
              {confOpen && (
                <div className="ddmenu">
                  <label className="ddopt">
                    <input
                      type="checkbox"
                      checked={confSel.length === 0}
                      onChange={() => setConfSel([])}
                    />
                    <span className="ddname">All conferences</span>
                  </label>
                  <div className="ddsep" />
                  {confs.map((c) => (
                    <label key={c} className="ddopt">
                      <input
                        type="checkbox"
                        checked={confSel.includes(c)}
                        onChange={() =>
                          setConfSel((s) => (s.includes(c) ? s.filter((x) => x !== c) : [...s, c]))
                        }
                      />
                      <span className="ddname">{c}</span>
                      <span className={`tier ${confTier[c]}`}>{confTier[c] === "p4" ? 3 : 2}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div className="seg">
              {(["all", "drafted", "undrafted"] as const).map((k) => (
                <button key={k} className={draftSel === k ? "on" : ""} onClick={() => setDraftSel(k)}>
                  {k === "all" ? "All" : cap(k)}
                </button>
              ))}
            </div>

            <div className="sw">
              <input
                className="search"
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search a team"
                aria-label="Search for a team"
              />
              {q && (
                <button className="clear" onClick={() => setQ("")} aria-label="Clear search">
                  ×
                </button>
              )}
            </div>
          </div>

          <p className="asof">
            {teamRows.length} team{teamRows.length === 1 ? "" : "s"}
            {searching && <> matching &ldquo;{q.trim()}&rdquo;</>}, ranked by points.
          </p>

          <table className="tt">
            <thead>
              <tr>
                <th className="r">#</th>
                <th style={{ textAlign: "left" }}>Team</th>
                <th style={{ textAlign: "left" }}>Conf</th>
                <th className="r">W-L</th>
                <th className="r">Drafter</th>
                <th className="r">Pts</th>
              </tr>
            </thead>
            <tbody>
              {teamRows.map((t, i) => (
                <tr key={t.team}>
                  <td className="r rank">{i + 1}</td>
                  <td className="tname">{t.team}</td>
                  <td className="tconf mono muted">{t.conf}</td>
                  <td className="mono muted wl r">{t.wins}-{t.losses}</td>
                  <td className={`owner ${t.manager ? "" : "un"}`}>
                    {t.manager ? cap(t.manager) : "undrafted"}
                  </td>
                  <td className="r pts sm2">{t.points}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!teamRows.length && (
            <p className="caption">
              {searching
                ? `No team matching \u201C${q.trim()}\u201D. Check the conference and drafted filters too.`
                : "No teams match that filter."}
            </p>
          )}
        </>
      )}

      {tab === "h2h" && (
        <>
          <div className="filters">
            <div className="dd" ref={h2hRef}>
              <button
                className={`ddbtn ${h2hSel.length ? "act" : ""}`}
                onClick={() => setH2hOpen((o) => !o)}
                aria-expanded={h2hOpen}
              >
                {h2hSel.length === 0
                  ? "All managers"
                  : h2hSel.length === 1
                  ? cap(h2hSel[0])
                  : `${h2hSel.length} managers`}
                <span className={`ddcaret ${h2hOpen ? "up" : ""}`}>▾</span>
              </button>
              {h2hOpen && (
                <div className="ddmenu">
                  <label className="ddopt">
                    <input
                      type="checkbox"
                      checked={h2hSel.length === 0}
                      onChange={() => setH2hSel([])}
                    />
                    <span className="ddname">All managers</span>
                  </label>
                  <div className="ddsep" />
                  {managers.map((m) => (
                    <label key={m} className="ddopt">
                      <input
                        type="checkbox"
                        checked={h2hSel.includes(m)}
                        onChange={() =>
                          setH2hSel((v) => (v.includes(m) ? v.filter((x) => x !== m) : [...v, m]))
                        }
                      />
                      <span className="ddname">{cap(m)}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div className="seg">
              {(["h2h", "timeline"] as const).map((k) => (
                <button key={k} className={view === k ? "on" : ""} onClick={() => setView(k)}>
                  {k === "h2h" ? "Head to head" : "Timeline"}
                </button>
              ))}
            </div>

          </div>

          {view === "h2h" && (
            <>
              <p className="asof">
                {h2hGames.length} scored game{h2hGames.length === 1 ? "" : "s"}, newest first.
                Every game with a drafted team on both sides - the league tiebreaker.
              </p>

              {h2hGames.map((h, i) => (
                <div className="gow" key={`${h.date}-${h.winner.team}-${i}`}>
                  <span className="mono muted d">{shortDate(h.date)}</span>
                  <span className="mu">
                    <b>{cap(h.winner.manager)}</b>&rsquo;s {h.winner.team} beat{" "}
                    <b>{cap(h.loser.manager)}</b>&rsquo;s {h.loser.team}
                    {h.sameManager && <em className="self"> own goal</em>}
                    {h.upset && <em className="upset"> upset · {h.spread!.formatted}</em>}
                  </span>
                  <span className="mono muted wk">
                    {h.seasonType === "postseason" ? `P${h.week}` : `Wk ${h.week}`}
                  </span>
                  <span className="mono muted score">{h.score}</span>
                </div>
              ))}

              {!h2hGames.length && (
                <p className="caption">
                  {data.headToHead.length === 0
                    ? "No game between two drafted teams has been scored yet."
                    : "No games match that filter."}
                </p>
              )}
            </>
          )}

          {view === "timeline" && (
            <>
              <p className="asof">
                Every scored game with a drafted team in it, newest first.{" "}
                {h2hSel.length > 0 && `Filtered to ${h2hSel.map(cap).join(", ")}.`}
              </p>

              {timeline.map((w) => (
                <section key={w.key}>
                  <h2>
                    {w.label}
                    <span className="cw">
                      {w.games.length} game{w.games.length === 1 ? "" : "s"} · {w.points} pts
                    </span>
                  </h2>
                  {w.games.map((g, i) => (
                    <div className="gow" key={`${g.date}-${g.winner.team}-${i}`}>
                      <span className="mono muted d">{shortDate(g.date)}</span>
                      <span className="mu">
                        <Owned side={g.winner} /> beat <Owned side={g.loser} />
                        {g.sameManager && <em className="self"> own goal</em>}
                        {g.upset && g.line && <em className="upset"> upset · {g.line}</em>}
                      </span>
                      <span className="mono muted score">{g.score}</span>
                      {/* Points belong to the winner. Under a manager filter the
                          list still shows the games their teams lost, so a badge
                          that is not theirs is dimmed - otherwise a filtered week
                          reads as "+3" on a game they lost while the heading above
                          it correctly says 0. A loss worth nothing to anyone gets
                          a blank, which says it more plainly than a 0. */}
                      <span
                        className={`mono stakes${
                          g.winner.manager && (h2hSel.length === 0 || h2hSel.includes(g.winner.manager))
                            ? ""
                            : " them"
                        }`}
                      >
                        {g.points ? `+${g.points}` : ""}
                      </span>
                    </div>
                  ))}
                </section>
              ))}

              {!timeline.length && (
                <p className="caption">
                  {data.results
                    ? "No scored games match that filter."
                    : "The timeline arrives with the next standings refresh."}
                </p>
              )}
            </>
          )}
        </>
      )}
      <Style />
    </main>
  );
}

function Style() {
  return (
    <style>{`
    :root{--ink:#0D1520;--panel:#141F2E;--rule:#2A3D53;--chalk:#E9EEF4;--muted:#7E8FA3;--amber:#F0A83C;--teal:#49B49E;--red:#D9697F}
    body{margin:0;background:var(--ink);color:var(--chalk);
      font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
    .wrap{max-width:760px;margin:0 auto;padding:20px 14px 70px}
    .mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
    .muted{color:var(--muted)} .sm{font-size:12px} .r{text-align:right}
    .err{color:#C4566B}
    header{border-bottom:2px solid var(--rule);padding-bottom:14px;margin-bottom:14px}
    h1{font-family:Georgia,serif;font-size:26px;line-height:1.15;letter-spacing:-.02em;margin:8px 0 6px}
    .brand{display:flex;align-items:center;gap:14px}
    .brand h1{margin:0 0 3px}
    .mark{flex-shrink:0;height:130px;width:auto;display:block}
    h2{font-family:Georgia,serif;font-size:19px;margin:26px 0 2px;display:flex;
      justify-content:space-between;align-items:baseline}
    .cw{font-family:ui-monospace,Menlo,monospace;font-size:9px;letter-spacing:.1em;
      text-transform:uppercase;color:var(--muted)}
    .tabs{display:flex;gap:6px;margin-bottom:14px}
    .tabs button{flex:1;background:transparent;border:1px solid var(--rule);color:var(--muted);
      border-radius:6px;padding:9px 4px;font-size:13px;font-weight:600;cursor:pointer;
      font-family:inherit;white-space:nowrap}
    .tabs button.on{background:var(--chalk);border-color:var(--chalk);color:var(--ink)}
    .weeks{display:flex;gap:5px;flex-wrap:wrap;margin-bottom:12px}
    .weeks button{background:transparent;border:1px solid var(--rule);color:var(--muted);
      border-radius:5px;padding:4px 9px;font-family:ui-monospace,Menlo,monospace;font-size:12px;cursor:pointer}
    .weeks button.on{background:var(--amber);border-color:var(--amber);color:var(--ink);font-weight:700}
    .asof{font-size:12px;color:var(--muted);margin:0 0 10px}
    .caption{font-size:11px;line-height:1.5;color:var(--muted);margin:9px 0 0;opacity:.85}
    table{width:100%;border-collapse:collapse}
    th{font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);
      font-family:ui-monospace,Menlo,monospace;font-weight:600;padding:0 5px 7px;border-bottom:1px solid var(--rule)}
    td{padding:11px 5px;border-bottom:1px solid rgba(42,61,83,.55)}
    .row{cursor:pointer} .row:hover{background:var(--panel)}
    .rank{font-family:ui-monospace,Menlo,monospace;color:var(--muted);width:22px;font-size:12px}
    .name{font-family:Georgia,serif;font-size:17px}
    .caret{color:var(--muted);margin-left:6px;display:inline-block;transition:transform .15s}
    .caret.up{transform:rotate(90deg)}
    .pts{font-family:ui-monospace,Menlo,monospace;font-size:18px;font-weight:700;color:var(--amber)}
    .ceil{color:var(--teal)}
    .detail td{background:var(--panel);padding:9px 10px}
    .team{display:flex;align-items:center;gap:8px;padding:4px 0;font-size:12.5px}
    .team .tn{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .team .cf{font-size:10px;width:78px;text-align:right;flex-shrink:0}
    .team .wl{width:30px;text-align:right;flex-shrink:0}
    .team .tp{color:var(--amber);font-weight:700;width:22px;text-align:right;flex-shrink:0}
    .tier{font-family:ui-monospace,Menlo,monospace;font-size:9px;font-weight:700;
      width:15px;text-align:center;border-radius:3px;padding:2px 0;flex-shrink:0}
    .tier.p4{background:rgba(73,180,158,.18);color:var(--teal)}
    .tier.g5{background:rgba(240,168,60,.15);color:var(--amber)}
    .note{margin-top:8px;font-size:11.5px;color:var(--muted);border-top:1px solid var(--rule);padding-top:7px}
    .gow{display:flex;gap:9px;align-items:baseline;padding:8px 0;font-size:13px;
      border-bottom:1px solid rgba(42,61,83,.4)}
    .gow .mu{flex:1} .gow .d{width:44px;flex-shrink:0;font-size:11px}
    .at{color:var(--muted)}
    .stakes{color:var(--amber);font-weight:700;font-size:12px;width:30px;text-align:right;flex-shrink:0}
    .line{color:var(--muted);font-size:11.5px;white-space:nowrap;flex-shrink:0}
    .self{color:var(--amber);font-style:normal;font-size:11px;white-space:nowrap}
    /* an opponent nobody drafted has no owner to name, and a bare team name
       beside "Nathan's ..." otherwise reads as missing data */
    .undr{color:var(--muted);opacity:.65;font-size:11px;white-space:nowrap}
    .proj{color:var(--muted);white-space:nowrap}
    /* the projected column makes the leaderboard 7 wide, which overruns a
       375px phone at the default padding */
    @media (max-width:430px){
      th{padding-left:2px;padding-right:2px;letter-spacing:.06em}
      td{padding-left:2px;padding-right:2px}
      .name{font-size:15px} .pts{font-size:16px}
      td.mono,.proj{font-size:12px}
      .arrow{margin-left:2px}
    }
    .arrow{margin-left:4px;font-size:9px;vertical-align:1px}
    .arrow.up{color:var(--teal)} .arrow.down{color:var(--red)} .arrow.flat{color:var(--muted);opacity:.6}
    .upset{color:var(--teal);font-style:normal;font-size:11px;white-space:nowrap}
    .fav{color:var(--teal)}
    .dog{color:var(--red)}
    .toggle{display:flex;gap:7px;align-items:center;font-size:12.5px;color:var(--muted);margin-bottom:4px}
    .filters{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px}
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
    .seg{display:flex;border:1px solid var(--rule);border-radius:6px;overflow:hidden}
    .seg button{background:transparent;border:0;border-right:1px solid var(--rule);color:var(--muted);
      padding:7px 12px;font-size:12.5px;cursor:pointer;font-family:inherit}
    .seg button:last-child{border-right:0}
    .seg button.on{background:var(--chalk);color:var(--ink);font-weight:600}
    .tt td{padding:8px 5px;font-size:13px}
    .tconf{font-size:10.5px;white-space:nowrap}
    .tname{font-size:13.5px}
    .owner{font-size:11.5px;color:var(--teal);text-align:right;white-space:nowrap}
    .owner.un{color:var(--muted);opacity:.65}
    .sm2{font-size:14px}
    .wl{font-size:11.5px}
    .sw{position:relative;display:flex;align-items:center;flex:1;min-width:130px;max-width:230px}
    .search{width:100%;background:transparent;border:1px solid var(--rule);color:var(--chalk);
      border-radius:6px;padding:7px 26px 7px 11px;font-size:12.5px;font-family:inherit}
    .search::placeholder{color:var(--muted)}
    .search:focus{outline:none;border-color:var(--amber)}
    /* the UA's own clear affordance is a light glyph on a dark field, so it is
       replaced rather than styled */
    .search::-webkit-search-cancel-button{-webkit-appearance:none;appearance:none}
    .clear{position:absolute;right:6px;background:transparent;border:0;color:var(--muted);
      font-size:16px;line-height:1;padding:2px 4px;cursor:pointer;font-family:inherit}
    .clear:hover{color:var(--chalk)}
    /* a points badge that belongs to a manager the filter is not about */
    .stakes.them{color:var(--muted);opacity:.55;font-weight:400}
    .wk{font-size:11px;width:34px;text-align:right;flex-shrink:0;opacity:.75}
    .score{width:44px;text-align:right;flex-shrink:0}
    @media (max-width:430px){
      .tabs button{font-size:12px;padding:9px 2px}
      .sw{max-width:none}
    }
  `}</style>
  );
}
