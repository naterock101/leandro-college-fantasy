import type { ReactNode } from "react";

import { percent } from "../../lib/winprob.mjs";
import type { Award, Data } from "../types";

/**
 * The trophy case: six season superlatives in a cabinet, one holder each.
 *
 * A fifth tab rather than six more rows on the leaderboard, for the reason
 * Trends is a tab: the leaderboard answers "who is winning", and this answers
 * "who holds what", which is read for fun and not on every visit.
 *
 * It reads `awards` out of the always-fetched core, so unlike All teams and
 * Activity there is no lazy file and no loading note - the case is on screen
 * the moment the tab is clicked. The awards are the *reduction* of `results`,
 * six records under a kilobyte, so shipping the answer costs a rounding error
 * on every poll where fetching the 60KB array they came from would put a
 * spinner on a tab that draws six lines. That trade is stated in lib/payload.
 *
 * Nothing here derives a holder. Every figure on a plate was computed by
 * lib/awards.mjs in the builder and is rendered as published, which is what
 * keeps the card and the run log from ever disagreeing.
 */

/* ------------------------------------------------------------------ */
/* the drawings                                                        */
/* ------------------------------------------------------------------ */

/**
 * One 64x64 cartoon per award, inline rather than in `public/`.
 *
 * Six files would be six requests on a page whose whole architecture is built
 * around not making them, and an `<img>` cannot take its colours from the
 * tokens. They are drawn on one grid with one outline weight so they sit at
 * the same optical weight beside each other in the case.
 *
 * Keyed by award id, and an id with no drawing simply renders a bare plinth
 * rather than breaking the shelf - a seventh award added to lib/awards.mjs
 * should reach the page looking unfinished, not crash it.
 */
const O = "#0A111A";   /* the outline every icon shares */

const ICONS: Record<string, ReactNode> = {
  /* A slingshot, loaded: the longest-odds win of the season is David's
     weapon, not a trophy about somebody losing. */
  upset: (
    <>
      <g fill="none" stroke={O} strokeWidth="11" strokeLinecap="round">
        <path d="M32 57V40" /><path d="M32 40 19 19" /><path d="M32 40 45 19" />
      </g>
      <g fill="none" stroke="var(--brass)" strokeWidth="7" strokeLinecap="round">
        <path d="M32 57V40" /><path d="M32 40 19 19" /><path d="M32 40 45 19" />
      </g>
      <path d="M19 19C24 30 40 30 45 19" fill="none" stroke={O} strokeWidth="8" strokeLinecap="round" />
      <path d="M19 19C24 30 40 30 45 19" fill="none" stroke="var(--teal)" strokeWidth="4.5" strokeLinecap="round" />
      <circle cx="32" cy="27" r="7.5" fill={O} />
      <circle cx="32" cy="27" r="5.5" fill="var(--chalk)" />
    </>
  ),
  /* A heart with a jagged split down it. Their team was the favourite. */
  heartbreaker: (
    <>
      <path d="M32 55C11 39 6 24 16 15c8-7 14-2 16 4 2-6 8-11 16-4C58 24 53 39 32 55z"
            fill="var(--red)" stroke={O} strokeWidth="3.4" strokeLinejoin="round" />
      <path d="M32 19l-6 10 9 5-7 9 4 12" fill="none" stroke={O}
            strokeWidth="4.6" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  /* Dynamite, fuse already lit. */
  blowout: (
    <>
      <g transform="rotate(-11 32 38)">
        <rect x="22" y="24" width="20" height="34" rx="8" fill="var(--red)" stroke={O} strokeWidth="3.4" />
        <rect x="22" y="32" width="20" height="4.5" fill={O} />
        <rect x="22" y="46" width="20" height="4.5" fill={O} />
      </g>
      <path d="M35 22c6-3 7-8 3-12" fill="none" stroke={O} strokeWidth="6.4" strokeLinecap="round" />
      <path d="M35 22c6-3 7-8 3-12" fill="none" stroke="#8B6B45" strokeWidth="3.2" strokeLinecap="round" />
      <path d="M38 10l3.5 5.5 6-2.5-3.2 5.6 6 2.4-6.4 1.3.9 6.2-4.6-4.4-4.4 4.6.7-6.3-6.3-1.6 6.1-2.2-3-5.7z"
            fill="var(--amber)" stroke={O} strokeWidth="2.4" strokeLinejoin="round" />
    </>
  ),
  /* Crossed swords over a football: their own two teams, and the points the
     losing one took with it. */
  civilWar: (
    <>
      <g stroke={O} strokeWidth="10" strokeLinecap="round">
        <path d="M13 53 47 15" /><path d="M51 53 17 15" />
      </g>
      <path d="M13 53 47 15" fill="none" stroke="#B9C6D6" strokeWidth="6" strokeLinecap="round" />
      <path d="M51 53 17 15" fill="none" stroke="#B9C6D6" strokeWidth="6" strokeLinecap="round" />
      <path d="M9 45 20 56" stroke="var(--amber)" strokeWidth="7" strokeLinecap="round" />
      <path d="M55 45 44 56" stroke="var(--amber)" strokeWidth="7" strokeLinecap="round" />
      <ellipse cx="32" cy="32" rx="13" ry="9" transform="rotate(-45 32 32)"
               fill="var(--brass)" stroke={O} strokeWidth="3.2" />
      <g stroke="var(--chalk)" strokeWidth="2.6" strokeLinecap="round">
        <path d="M27 27 37 37" /><path d="M30 29l-1.6 1.6" />
        <path d="M33 32l-1.6 1.6" /><path d="M36 35l-1.6 1.6" />
      </g>
    </>
  ),
  /* A calendar page with a star cut into it. */
  bestWeek: (
    <>
      <g stroke={O} strokeWidth="3.4" strokeLinecap="round">
        <path d="M21 8v8" /><path d="M43 8v8" />
      </g>
      <rect x="9" y="13" width="46" height="43" rx="6" fill="var(--chalk)" stroke={O} strokeWidth="3.4" />
      <path d="M9 19a6 6 0 016-6h34a6 6 0 016 6v6H9z" fill="var(--teal)" />
      <path d="M9 25h46" stroke={O} strokeWidth="3.4" />
      <path d="M32 30.5l4.9 9.9 11 1.6-7.9 7.7 1.9 10.9L32 55.4l-9.8 5.2 1.9-10.9-7.9-7.7 11-1.6z"
            fill="var(--amber)" stroke={O} strokeWidth="3.2" strokeLinejoin="round" />
    </>
  ),
  /* A four-leaf clover with a spark. */
  luckiest: (
    <>
      <path d="M32 40c0 8 3 13 9 17" fill="none" stroke={O} strokeWidth="7.4" strokeLinecap="round" />
      <path d="M32 40c0 8 3 13 9 17" fill="none" stroke="#2F7F6E" strokeWidth="4" strokeLinecap="round" />
      <g fill="var(--teal)" stroke={O} strokeWidth="3.2" strokeLinejoin="round">
        <path d="M31 34C22 34 15 31 15 24s10-9 13-3c2 4 2 8 3 13z" />
        <path d="M33 34c9 0 16-3 16-10s-10-9-13-3c-2 4-2 8-3 13z" />
        <path d="M31 36c-9 0-16 3-16 10s10 9 13 3c2-4 2-8 3-13z" />
        <path d="M33 36c9 0 16 3 16 10s-10 9-13 3c-2-4-2-8-3-13z" />
      </g>
      <circle cx="32" cy="35" r="3" fill="#2F7F6E" />
      <path d="M50 12l1.7 4.3L56 18l-4.3 1.7L50 24l-1.7-4.3L44 18l4.3-1.7z"
            fill="var(--amber)" stroke={O} strokeWidth="1.8" strokeLinejoin="round" />
    </>
  ),
};

/* ------------------------------------------------------------------ */
/* the words                                                           */
/* ------------------------------------------------------------------ */

/**
 * A published number, in the sentence its own award is about.
 *
 * Presentation, so it lives here and not in lib/awards.mjs, which publishes
 * the number and the unit and says nothing about how either reads. Keyed by
 * id because the sentence is per-award and not per-unit: the civil war and
 * the luck delta are both `points` and one of them is a loss.
 *
 * The `unit` fallback is what an id with no entry gets, so a seventh award
 * reaches the page reading plainly rather than reading blank.
 */
const say = (a: Award, value: number) => {
  switch (a.id) {
    case "upset":
    case "heartbreaker": return `${percent(value)} to win`;
    case "blowout": return `${value}-point margin`;
    case "civilWar": return `−${value} points`;
    case "bestWeek": return `${value} point${value === 1 ? "" : "s"}`;
    case "luckiest": return `+${value} vs the lines`;
    default: return a.unit === "chance" ? percent(value) : `${value} ${a.unit}`;
  }
};

/**
 * Up to two names, then a count.
 *
 * A plate is a plate. Eight managers tied on a trophy nobody has scored on
 * yet is a real payload - it is what the first Saturday of a season looks
 * like - and eight names in one engraved line is not a plate any more.
 */
const engrave = (holders: Award["holders"]) => {
  const names = holders.map((h) => h.manager);
  if (names.length <= 2) return names.join(" & ");
  return `${names.slice(0, 2).join(", ")} +${names.length - 2}`;
};

/* ------------------------------------------------------------------ */

function Trophy({ award }: { award: Award }) {
  const held = award.holders.length > 0;
  return (
    <div className="trophy">
      {award.changed && (
        <span className="flag" title="This trophy changed hands this week">New</span>
      )}
      <div className="stand">
        {/* Decoration. The plate names the award in text directly underneath,
            so a label here would be the same word read out twice. */}
        <svg className="icon" viewBox="0 0 64 64" aria-hidden="true">{ICONS[award.id]}</svg>
        <span className="plinth" />
      </div>
      <div className="plate">
        <p className="award">{award.label}</p>
        {held ? (
          <>
            <p className="holder">{engrave(award.holders)}</p>
            <p className="figure mono">{say(award, award.holders[0].value)}</p>
            <p className="detail">{award.holders[0].detail}</p>
          </>
        ) : (
          /* Not a zero. A zero is a claim about a season that has not happened
             yet, and the two read identically once it is printed. */
          <p className="holder none">Not awarded yet</p>
        )}
        <p className="blurb">{award.blurb}</p>
        {award.runnerUp && (
          <p className="next">
            Next: {award.runnerUp.manager}{" "}
            <span className="mono">{say(award, award.runnerUp.value)}</span>
          </p>
        )}
      </div>
    </div>
  );
}

export function Trophies({ data }: { data: Data }) {
  const awards = data.awards;
  const moved = awards?.filter((a) => a.changed).length ?? 0;

  return (
    <>
      <h2>
        Trophy case
        <span className="cw">
          {moved ? `${moved} changed hands` : "nothing moved"}
        </span>
      </h2>
      <p className="asof">
        One holder each, rebuilt from every settled game on every update. The
        line under a name is the next manager down &ndash; how safe the holder
        is, rather than only who they are.
      </p>

      {/* An absent key is the window where a browser holds JS from after this
          shipped and the bot has not written a payload with it yet. It reads
          as its own sentence rather than as an empty case, because an empty
          case would say the season has no trophies in it. */}
      {!awards ? (
        <p className="muted">
          There are no trophies in this update. The case fills in after the next
          one.
        </p>
      ) : (
        <div className="cabinet">
          <div className="interior">
            {awards.map((a) => <Trophy key={a.id} award={a} />)}
          </div>
        </div>
      )}
    </>
  );
}

/* The cabinet is CSS, not an image: brass is a gradient, the glass is a second
   gradient over the top and the shelf lip is a border. Six PNGs would be six
   requests on a page built around not making them.

   No `opacity` anywhere, on purpose - tests/contrast.test.tsx forbids it
   outright, because an opacity on a text rule lands on top of whatever colour
   the rule already had and is invisible from the palette. Every wash below is
   an rgba() that can be read as a colour. */
export const css = `
    .cabinet{margin:14px 0 0;padding:11px;border-radius:8px;
      background:linear-gradient(150deg,var(--amber) 0%,var(--brass) 22%,var(--brass-lo) 52%,
                                        var(--brass) 78%,var(--amber) 100%);
      box-shadow:0 18px 40px -18px rgba(0,0,0,.85)}
    .interior{position:relative;display:grid;grid-template-columns:repeat(3,1fr);
      border-radius:3px;overflow:hidden;
      background:radial-gradient(120% 90% at 50% 0%,rgba(240,168,60,.10),rgba(240,168,60,0) 62%),
                 linear-gradient(180deg,#101A27 0%,#0B131E 100%);
      box-shadow:inset 0 0 40px 6px rgba(0,0,0,.6)}
    /* The glass: one diagonal band over everything, and it must never eat a
       click or a focus ring. */
    .interior::after{content:"";position:absolute;inset:0;pointer-events:none;
      background:linear-gradient(112deg,rgba(233,238,244,0) 30%,rgba(233,238,244,.05) 38%,
        rgba(233,238,244,.08) 43%,rgba(233,238,244,0) 49%,rgba(233,238,244,0) 66%,
        rgba(233,238,244,.045) 71%,rgba(233,238,244,0) 77%);
      box-shadow:inset 0 0 0 1px rgba(233,238,244,.08)}

    .trophy{position:relative;padding:20px 10px 22px;text-align:center}
    /* The shelf lip, worn by the row rather than the cell: a bright top edge,
       a brass body, and the shadow it casts on what is below it. Only the
       first row of three gets one, which is what makes them read as shelves
       and not as a grid of boxes. */
    .trophy:nth-child(-n+3)::after{content:"";position:absolute;left:0;right:0;bottom:0;height:7px;
      background:linear-gradient(180deg,var(--amber),var(--brass) 40%,var(--brass-lo));
      box-shadow:0 5px 12px -3px rgba(0,0,0,.7)}
    .trophy:not(:nth-child(3n+1)){box-shadow:inset 1px 0 0 rgba(233,238,244,.05)}

    .stand{position:relative;display:flex;flex-direction:column;align-items:center}
    /* a pool of light on the felt behind each one */
    .stand::before{content:"";position:absolute;left:50%;top:-6px;width:112px;height:112px;
      margin-left:-56px;border-radius:50%;
      background:radial-gradient(circle,rgba(240,168,60,.13),rgba(240,168,60,0) 66%)}
    .icon{position:relative;width:68px;height:68px;display:block;
      filter:drop-shadow(0 5px 8px rgba(0,0,0,.55))}
    .plinth{position:relative;display:block;width:50px;height:9px;margin-top:-2px;
      border-radius:2px;
      background:linear-gradient(180deg,var(--amber),var(--brass) 45%,var(--brass-lo));
      box-shadow:0 6px 10px -4px rgba(0,0,0,.8)}
    /* Pinned to the corner rather than stacked above the icon. In the flow it
       pushed its own trophy down by the height of the badge, so the one card
       on the shelf that had news to report was the one standing out of line
       with the rest - the opposite of what a badge is for. */
    .flag{position:absolute;top:6px;right:8px;z-index:2;padding:2px 6px;border-radius:2px;
      font-family:ui-monospace,Menlo,monospace;font-size:9px;letter-spacing:.11em;
      text-transform:uppercase;background:var(--red);color:var(--ink)}

    /* The nameplate. --panel rather than a gradient of its own, so every
       colour on it is one the contrast audit already covers. */
    .plate{position:relative;margin:13px auto 0;max-width:200px;padding:8px 14px 9px;
      border-radius:2px;background:var(--panel);
      box-shadow:inset 0 1px 0 rgba(233,238,244,.09),0 2px 5px rgba(0,0,0,.55)}
    .plate .award{font-family:Georgia,serif;font-size:13px;letter-spacing:.03em;
      color:var(--amber);margin:0}
    .plate .holder{margin:4px 0 0;font-size:14px;font-weight:650;color:var(--chalk)}
    .plate .holder.none{font-size:12.5px;font-weight:400;font-style:italic;color:var(--dim)}
    .plate .figure{margin:2px 0 0;font-size:12px;font-weight:600;color:var(--teal)}
    .plate .detail{margin:4px 0 0;font-size:11px;line-height:1.35;color:var(--dim)}
    .plate .blurb{margin:7px 0 0;font-size:11px;line-height:1.35;color:var(--muted)}
    .plate .next{margin:7px 0 0;padding-top:6px;font-size:11px;color:var(--dim);
      border-top:1px solid var(--rule)}

    @media (max-width:640px){
      .interior{grid-template-columns:repeat(2,1fr)}
      .trophy:nth-child(-n+3)::after{content:none}
      .trophy:nth-child(-n+4)::after{content:"";position:absolute;left:0;right:0;bottom:0;height:7px;
        background:linear-gradient(180deg,var(--amber),var(--brass) 40%,var(--brass-lo));
        box-shadow:0 5px 12px -3px rgba(0,0,0,.7)}
      .trophy:not(:nth-child(3n+1)){box-shadow:none}
      .trophy:nth-child(even){box-shadow:inset 1px 0 0 rgba(233,238,244,.05)}
      .trophy{padding:16px 8px 18px}
      .plate{padding:7px 10px 8px}
    }
    @media (max-width:400px){
      .interior{grid-template-columns:1fr}
      .trophy::after,.trophy:nth-child(-n+4)::after{content:none}
      .trophy:nth-child(even){box-shadow:none}
      .trophy + .trophy{box-shadow:inset 0 1px 0 rgba(233,238,244,.05)}
    }
`;
