import { cap, kickoff, shortTime } from "../../lib/format.mjs";
import { TeamName } from "./TeamName";
import type { Game } from "../types";

/**
 * The games that have kicked off and are not yet in the payload as final.
 *
 * Which games those are is decided by the page, because the poll cadence is a
 * function of the same answer - a minute while something is on, five minutes
 * otherwise - and two definitions of "is anything on" is exactly the drift
 * that produced the dead-week bug. This component draws what it is handed.
 */
export function LiveGames({ games, generatedAt }: { games: Game[]; generatedAt: string }) {
  if (!games.length) return null;
  return (
    <section className="livewrap">
      <h2>
        <span className="livehead">
          {/* The dot said "these are happening now" in red and in motion and
              in nothing else, which leaves out anyone who cannot see either.
              The words are in the count beside it rather than hidden behind
              the dot, so the answer is the same whoever is reading. */}
          <span className="dot" aria-hidden="true" />
          On the field
        </span>
        <span className="cw">
          {games.length} game{games.length === 1 ? "" : "s"} in progress
        </span>
      </h2>
      {games.map((g, i) => (
        <div className="gow" key={`${g.date}-${g.home.team}-${i}`}>
          <span className="mono muted d">{kickoff(g.date)}</span>
          <span className="mu">
            {g.away.manager ? <><b>{cap(g.away.manager)}</b>&rsquo;s </> : null}
            <TeamName team={g.away.team} />
            {!g.away.manager && <span className="undr"> undrafted</span>}
            <span className="at">{g.neutral ? " vs " : " at "}</span>
            {g.home.manager ? <><b>{cap(g.home.manager)}</b>&rsquo;s </> : null}
            <TeamName team={g.home.team} />
            {!g.home.manager && <span className="undr"> undrafted</span>}
            {g.sameManager && <em className="self"> both his</em>}
          </span>
          {/* the feed carries a score for a game in flight only
              sometimes, so the column is often empty by design */}
          <span className="mono muted score">
            {g.partial ? `${g.partial.away}-${g.partial.home}` : ""}
          </span>
          <span className="mono stakes">{g.stakes}pt</span>
        </div>
      ))}
      <p className="caption">
        Kicked off and not yet final as of the last refresh
        {generatedAt && `, ${shortTime(generatedAt)}`}. Scores
        appear only when the feed is carrying them.
      </p>
    </section>
  );
}

export const css = `
    /* this follows the standings small print, which is dense and low contrast,
       so it needs a clearer break than the 26px an ordinary section heading
       gets - the live block should read as its own thing, not as a footnote */
    .livewrap h2{margin-top:32px}
    /* a kickoff time needs more room than the "Sep 3" the other rows carry */
    .livewrap .gow .d{width:58px}
    .livehead{display:flex;align-items:center;gap:7px}
    .dot{width:7px;height:7px;border-radius:50%;background:var(--red);flex-shrink:0;
      animation:pulse 2s ease-in-out infinite}
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:.25}}
    /* a viewer who has asked for less motion still needs to see the dot, just
       not the blink */
    @media (prefers-reduced-motion:reduce){.dot{animation:none}}
`;
