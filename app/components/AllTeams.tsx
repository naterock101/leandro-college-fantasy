import { useMemo } from "react";

import { cap, norm } from "../../lib/format.mjs";
import { useViewState } from "../hooks/useViewState";
import { Dropdown } from "./Dropdown";
import { TeamName } from "./TeamName";
import type { Data, Tier } from "../types";

/**
 * Every FBS team in one flat table, ranked on points across all ten
 * conferences rather than within each one.
 *
 * `note` is what to say instead of this tab's own empty state while its
 * payload file is not here. The distinction is the whole point of having it:
 * an empty array reads the same whether nothing has happened yet or the fetch
 * failed, and only one of those is the site's fault.
 */
export function AllTeams({ data, note }: { data: Data; note: string | null }) {
  /* empty = every conference. Storing the selection rather than the exclusion
     keeps "all" stable when a conference is added or renamed. */
  const [confSel, setConfSel] = useViewState<string[]>("teams.confs", []);
  const [draftSel, setDraftSel] = useViewState<"all" | "drafted" | "undrafted">("teams.drafted", "all");
  /* free text over school names, so "is Baylor taken" is one keystroke rather
     than a scroll through 130-odd rows */
  const [q, setQ] = useViewState("teams.q", "");

  const allTeams = useMemo(
    () =>
      Object.entries(data.byConference)
        .flatMap(([conf, teams]) => teams.map((t) => ({ ...t, conf })))
        .sort((a, b) => b.points - a.points || b.wins - a.wins || a.team.localeCompare(b.team)),
    [data]
  );

  const confs = useMemo(() => Object.keys(data.byConference), [data]);

  const confTier = useMemo(() => {
    const m: Record<string, Tier> = {};
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

  return (
    <>
      <div className="filters">
        <Dropdown
          name="conf"
          summary={
            confSel.length === 0
              ? "All conferences"
              : confSel.length === 1
              ? confSel[0]
              : `${confSel.length} conferences`
          }
          allLabel="All conferences"
          options={confs.map((c) => ({
            value: c,
            label: c,
            badge: <span className={`tier ${confTier[c]}`}>{confTier[c] === "p4" ? 3 : 2}</span>,
          }))}
          selected={confSel}
          onClear={() => setConfSel([])}
          onToggle={(c) =>
            setConfSel((s) => (s.includes(c) ? s.filter((x) => x !== c) : [...s, c]))
          }
        />

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
            {/* Right, not centred: this rank runs to 136, so a centred
                column staggers one- against three-digit numbers all the way
                down. The leaderboard's own rank stops at 8 and stays centred
                with the rest of its table. Either way the heading wears the
                column's class. */}
            <th className="rt">#</th>
            <th>Team</th>
            <th>Conf</th>
            <th className="num">W-L</th>
            {/* Right, like its cells - names, not numbers, sitting against
                the points column. The heading wears the column's class. */}
            <th className="rt">Drafter</th>
            <th className="num">Pts</th>
          </tr>
        </thead>
        <tbody>
          {teamRows.map((t, i) => (
            <tr key={t.team}>
              <td className="rt rank">{i + 1}</td>
              <td className="tname"><TeamName team={t.team} /></td>
              <td className="tconf mono muted">{t.conf}</td>
              <td className="mono muted wl num">{t.wins}-{t.losses}</td>
              <td className={`owner rt ${t.manager ? "" : "un"}`}>
                {t.manager ? cap(t.manager) : "undrafted"}
              </td>
              <td className="num pts sm2">{t.points}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!teamRows.length && (
        <p className="caption">
          {note ??
            (searching
              ? `No team matching “${q.trim()}”. Check the conference and drafted filters too.`
              : "No teams match that filter.")}
        </p>
      )}
    </>
  );
}

export const css = `
    .tt td{padding:8px 5px;font-size:13px}
    .tconf{font-size:10.5px;white-space:nowrap}
    .tname{font-size:13.5px}
    /* No text-align here: this column's alignment is the rt class, worn by
       the heading and the cells alike, so there is one place it is written. */
    .owner{font-size:11.5px;color:var(--teal);white-space:nowrap}
    .owner.un{color:var(--dim)}
    .sm2{font-size:14px}
    .wl{font-size:11.5px}
    .sw{position:relative;display:flex;align-items:center;flex:1;min-width:130px;max-width:230px}
    .search{width:100%;background:transparent;border:1px solid var(--rule);color:var(--chalk);
      border-radius:6px;padding:7px 26px 7px 11px;font-size:12.5px;font-family:inherit}
    .search::placeholder{color:var(--muted)}
    /* The border change is the pointer affordance; the ring is the keyboard
       one, and this rule used to remove it for both. */
    .search:focus{outline:none;border-color:var(--amber)}
    .search:focus-visible{outline:2px solid var(--amber);outline-offset:2px}
    /* the UA's own clear affordance is a light glyph on a dark field, so it is
       replaced rather than styled */
    .search::-webkit-search-cancel-button{-webkit-appearance:none;appearance:none}
    .clear{position:absolute;right:6px;background:transparent;border:0;color:var(--muted);
      font-size:16px;line-height:1;padding:2px 4px;cursor:pointer;font-family:inherit}
    .clear:hover{color:var(--chalk)}
    @media (max-width:430px){
      .sw{max-width:none}
      /* The leaderboard's narrow-screen block tightens td for the whole
         page, and this table never got it: the .tt td rule above is one class
         more specific, so it won wherever the two met and source order was
         never asked. The rule it beat was about padding; this one is about
         a font size and restated the padding on its way past. */
      .tt td{padding-left:2px;padding-right:2px}
      /* Even tightened, the table still wanted 372px of a phone's 347. The
         conference column is what was taking it - "American Athletic" held on
         one line is 143px, more than a third of the table, for the column
         that can most afford to run to two. Wrapped, it is 101px. */
      .tconf{white-space:normal}
    }
`;
