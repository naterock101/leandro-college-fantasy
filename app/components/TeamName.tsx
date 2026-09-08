import { cap } from "../../lib/format.mjs";
import logos from "../../data/logos.json" with { type: "json" };
import type { ScoredSide } from "../types";

/* 18px, at the bottom of the 18-20 the plan asks for. The rows this sits in
   are 13px text on 8px padding, and 20px is taller than the line it labels. */
const PX = 18;

/* 40 and not 18: a phone draws two device pixels per CSS pixel, so 36 is the
   floor and 40 is the round number above it that ESPN already has cached. */
const THUMB = 40;

/**
 * The same logo, asked for at the size it is actually drawn.
 *
 * This is the difference between the All teams table costing 270KB of images
 * and costing 5.9MB. The map stores the canonical URL, which is the 500px PNG
 * both feeds hand out - median 36KB, worst case 119KB, and 136 of them on that
 * one table. Measured, not estimated. ESPN's own resizer takes the same path
 * and returns a median of 1.5KB, which is what a crest drawn 18px wide is
 * worth.
 *
 * The resize lives here rather than in `data/logos.json` on purpose: the file
 * records what the feed says, and 40px is a decision this component makes
 * because it is the component that picked 18. If the resizer ever goes away,
 * one line here goes back to `entry.logo` and the file needs no rebuild.
 *
 * All 186 URLs in the map were checked to return 200 through it. A miss would
 * be an image that fails to load, which - with `alt=""` and a fixed box - is
 * blank space and never a broken-image glyph.
 */
export const thumb = (url: string) => {
  const path = url.replace(/^https:\/\/a\.espncdn\.com/, "");
  if (path === url) return url;
  return `https://a.espncdn.com/combiner/i?img=${path}&w=${THUMB}&h=${THUMB}`;
};

/* Resolved once at import rather than per render. The All teams table redraws
   on every keystroke in its search box, with up to 136 of these in it. */
const map: Record<string, string> = Object.fromEntries(
  Object.entries((logos as { teams: Record<string, { logo: string }> }).teams).map(
    ([school, entry]) => [school, thumb(entry.logo)]
  )
);

/* Inline rather than a `css` export in Style.tsx, and the reason is the
   parallel work rather than taste: every other component's rules reach the
   page through one shared array in Style.tsx, and four agents appending to
   that array at once is four conflicts in one file. Three declarations on a
   decorative box is a cheap thing to keep local. If a later pass wants it in
   the sheet, it is a `css` export and one import line. */
const slot = {
  display: "inline-block",
  width: PX,
  height: PX,
  /* The box is fixed in both dimensions here and again in the width/height
     attributes below. The attributes reserve it before the stylesheet is
     parsed; these hold it whatever the file's intrinsic size turns out to be,
     and `contain` is what stops a non-square crest being stretched to fit. */
  objectFit: "contain",
  marginRight: 5,
  /* Every row this appears in is baseline-aligned, so a logo hung from the
     baseline would sit too high against 13px text. */
  verticalAlign: "-4px",
  flexShrink: 0,
} as const;

/**
 * The crest beside a school, or the space where one would be.
 *
 * A school with no entry renders no `<img>` at all - not a broken-image glyph,
 * and not an `<img>` with an empty `src`, which some browsers resolve against
 * the page URL and then fail on. What it does render is an empty box of
 * exactly the same size, because the alternative is worse than the gap: in the
 * All teams table one row's name would start 23px to the left of every other
 * row's, which reads as a rendering fault rather than as a missing logo.
 *
 * `alt=""` and not `alt="Miami"`. The logo labels the name printed
 * immediately beside it, so a caption would make a screen reader say the
 * school twice. Empty rather than absent: a missing `alt` sends some readers
 * to the file name, which here is a numeric ESPN id.
 */
function Logo({ team }: { team: string }) {
  /* Exact equality on the CFBD school string, which is what plain property
     access gives and is the whole reason the map is keyed this way. `Miami`
     and `Miami (OH)` are two teams; so are `Ohio` and `Ohio State`, and
     `Louisiana` and `Louisiana Tech`. Nothing here trims, lowercases or
     prefix-matches, because each of those would silently hand one manager
     another manager's crest. */
  const src = Object.prototype.hasOwnProperty.call(map, team) ? map[team] : undefined;

  if (!src) return <span data-logo="" aria-hidden="true" style={slot} />;

  return (
    <img
      data-logo=""
      src={src}
      alt=""
      width={PX}
      height={PX}
      /* ~136 of these land on the All teams table at once. Lazy is what keeps
         that a handful of requests for the rows on screen rather than 136 on
         first paint; async decoding keeps the ones that do load off the
         critical path. */
      loading="lazy"
      decoding="async"
      style={slot}
    />
  );
}

/**
 * The single place a school is turned into something on screen.
 *
 * Before the split there were three of these, one inlined into each block
 * that renders a game, and they had already drifted: one wrapped the school in
 * a span so the favourite could be coloured and two did not. Anything that
 * wants to change how a team is drawn - a logo, a rank, a colour - now has one
 * file to change, and every block gets it. The logo is the first thing to
 * actually collect on that, which is why this phase is one component and no
 * caller changed.
 *
 * `team` is the canonical CFBD school string and is what anything keyed on a
 * team should join on; `label` is what the reader sees, which for a drafted
 * team is the roster's own wording ("Arizona State Sun Devils") rather than
 * the school. They are different strings and the difference matters: the
 * spread names a favourite by `team`, and the leaderboard names a pick by
 * `label`. The logo joins on `team` for exactly that reason - `label` is a
 * draft board's wording and is not in any feed.
 */
export function TeamName({
  team,
  label,
  className,
}: {
  team: string;
  label?: string;
  className?: string;
}) {
  const text = label ?? team;
  /* Games of the week needs a class on the school itself, to colour the
     favourite and the dog. The other callers have nothing to hang there, and
     wrapping them in an empty span for symmetry would be markup that exists
     to please the abstraction rather than the page. The logo goes outside that
     span either way: it is not text, and it must not inherit the colour the
     class exists to set. */
  return className === undefined ? (
    <>
      <Logo team={team} />
      {text}
    </>
  ) : (
    <>
      <Logo team={team} />
      <span className={className}>{text}</span>
    </>
  );
}

/**
 * "Adam's Buffalo", or the bare school when nobody drafted it. Undrafted sides
 * are the common case in the timeline, so they are labelled rather than left
 * sitting next to an owned team looking like missing data.
 */
export function Owned({ side }: { side: ScoredSide }) {
  return side.manager ? (
    <>
      <b>{cap(side.manager)}</b>&rsquo;s <TeamName team={side.team} />
    </>
  ) : (
    <>
      <TeamName team={side.team} />
      <span className="undr"> undrafted</span>
    </>
  );
}
