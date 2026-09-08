import { cap, kickoff, shortTime } from "../../lib/format.mjs";
import { useLiveScores, type LiveScore } from "../hooks/useLiveScores";
import { TeamName } from "./TeamName";
import type { Game } from "../types";

/**
 * The games that have kicked off and are not yet in the payload as final.
 *
 * Which games those are is decided by the page, because the poll cadence is a
 * function of the same answer - a minute while something is on, five minutes
 * otherwise - and two definitions of "is anything on" is exactly the drift
 * that produced the dead-week bug. This component draws what it is handed.
 *
 * What it draws them *with* is its own: the payload's own clock, plus whatever
 * ESPN is carrying for the same game id right now. The overlay is strictly
 * additive. Every row below renders from the payload first and is then
 * improved, so a game ESPN has never heard of and a Saturday where ESPN is
 * down both draw the block that was here before the overlay existed.
 */

/**
 * "Q3 7:42", or ESPN's own word for whatever else is going on.
 *
 * The clock is composed from `period` and `displayClock` while the ball is in
 * play and taken from ESPN's `detail` when it is not, because there is no
 * honest way to compose the second case from the first: at halftime the state
 * is still "in" and the clock still reads 0:00, so "Q2 0:00" is a sentence
 * nobody says about a game. `detail` says "Halftime", "End of 3rd", "Final",
 * "Delayed" - all of them things a reader wants and none of them derivable.
 *
 * The exception is a game that has not kicked off, where `detail` is a long
 * date string ("Sat, September 12th at 12:00 PM EDT"). The row already carries
 * the kickoff in its own column and in the reader's own timezone, so that one
 * returns nothing and the column keeps what it had.
 */
function clock(s: LiveScore | undefined): string | null {
  if (!s || s.state === "pre") return null;
  const running = s.state === "in" && s.displayClock && s.displayClock !== "0:00";
  if (!running) return s.detail;
  const p = s.period;
  if (typeof p !== "number" || p < 1) return s.displayClock;
  /* Period 5 is the first overtime, and college football's overtimes have no
     clock worth showing anyway - but the period still counts up, so this at
     least stops it announcing a ninth quarter. */
  const label = p <= 4 ? `Q${p}` : p === 5 ? "OT" : `${p - 4}OT`;
  return `${label} ${s.displayClock}`;
}

export function LiveGames({ games, generatedAt }: { games: Game[]; generatedAt: string }) {
  /* Called before the early return, because a hook has to be. It costs
     nothing when the list is empty: no live game means no date to ask about
     and no timer to run. */
  const scores = useLiveScores(games);
  if (!games.length) return null;
  /* Whether the caption should promise a live clock at all. It should not on a
     Saturday when ESPN is unreachable, and the page has no other way of
     knowing that than by having asked and got nothing back. */
  const anyScored = games.some((g) => scores[String(g.id)]);
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
      {games.map((g, i) => {
        const s = scores[String(g.id)];
        const when = clock(s);
        /* Away first, which is the order the row reads in and the order the
           builder's own partial score already used. ESPN's is preferred over
           the payload's because the payload is at best ten minutes old and
           this is three seconds old. */
        const score = s?.score
          ? `${s.score.away}-${s.score.home}`
          : g.partial
          ? `${g.partial.away}-${g.partial.home}`
          : "";
        return (
          <div className="gow" key={`${g.date}-${g.home.team}-${i}`}>
            {/* The kickoff, until there is something better to say. A game in
                flight is asked "how long left", not "when did it start". */}
            <span className={`mono ${when ? "live" : "muted"} d`}>{when ?? kickoff(g.date)}</span>
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
            <span className={`mono ${s?.score ? "now" : "muted"} score`}>{score}</span>
            <span className="mono stakes">{g.stakes}pt</span>
          </div>
        );
      })}
      {/* The first sentence is about the list and is true either way: the
          games in it come from the payload whatever ESPN is doing. Only the
          second changes, and the version that promises a live clock is only
          printed once one has actually arrived - a caption that says "every 30
          seconds" beside a column of kickoff times would be the page telling
          the reader something it can see is not happening. */}
      <p className="caption">
        Kicked off and not yet final as of the last refresh
        {generatedAt && `, ${shortTime(generatedAt)}`}.{" "}
        {anyScored
          ? "Scores and clocks are ESPN's, every 30 seconds."
          : "Scores appear only when the feed is carrying them."}
      </p>
    </section>
  );
}

export const css = `
    /* this follows the standings small print, which is dense and low contrast,
       so it needs a clearer break than the 26px an ordinary section heading
       gets - the live block should read as its own thing, not as a footnote */
    .livewrap h2{margin-top:32px}
    /* a kickoff time needs more room than the "Sep 3" the other rows carry,
       and "Halftime" needs more again - it is the longest thing this column
       ever holds, and wrapping it would make the row two lines high on a
       phone for no gain */
    .livewrap .gow .d{width:62px}
    /* A running clock is the newest thing on the page and the reason to look
       at the block at all, so it is not drawn in the muted grey a kickoff time
       that has already passed is drawn in. */
    .livewrap .gow .d.live{color:var(--chalk);font-weight:600}
    .livewrap .score.now{color:var(--chalk);font-weight:600}
    /* two-digit scores both sides, plus the dash */
    .livewrap .score{width:52px}
    .livehead{display:flex;align-items:center;gap:7px}
    .dot{width:7px;height:7px;border-radius:50%;background:var(--red);flex-shrink:0;
      animation:pulse 2s ease-in-out infinite}
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:.25}}
    /* a viewer who has asked for less motion still needs to see the dot, just
       not the blink */
    @media (prefers-reduced-motion:reduce){.dot{animation:none}}
`;
