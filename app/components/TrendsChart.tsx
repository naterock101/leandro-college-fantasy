import { useMemo } from "react";

import { cap } from "../../lib/format.mjs";
import { VIEWS, axisFor, corners, raceFrames, windowStart } from "../../lib/race.mjs";
import { useViewState } from "../hooks/useViewState";
import type { Data } from "../types";
import { Dropdown } from "./Dropdown";
import { KartIcon, KARTS, type Marker } from "./Karts";

/**
 * The race: every manager's running total, game by game.
 *
 * Hand-rolled SVG. A charting library would be a runtime dependency in a repo
 * whose first ground rule is that there are none, and this chart is one
 * polyline per manager against a linear scale - the library would be several
 * hundred kilobytes to avoid about forty lines of arithmetic.
 *
 * The arithmetic itself lives in `lib/race.mjs`, which is where the tests that
 * matter can reach it without a DOM. What is left here is the drawing and the
 * three controls.
 *
 * It reads `results` where it used to read only `byWeek`. The Trends tab
 * already fetches `results.json` for the head-to-head matrix below, so the
 * finer picture costs no extra request and no extra byte - and until that file
 * lands (or if it never does) the chart falls back to the week-by-week shape
 * it has always drawn, out of the always-fetched core.
 */

/* The drawing surface, in user units rather than pixels: the svg carries a
   viewBox and no width, so this is an aspect ratio and a set of proportions,
   and the browser decides how big it is. `padR` is the wide one because the
   right-hand gutter holds the manager names - a legend would make a reader
   match eight colours to eight names by memory, which is exactly the task
   colour-blindness makes impossible and everyone else finds tedious.

   `H` is 440 rather than the 280 this started at, and the extra 160 units are
   not decoration. A driver is 26 units tall and must not overlap the next one,
   so the height is what decides how close on points two managers can be and
   still each keep their face on their own line.

   `W` is deliberately left alone. The svg is never drawn wider than its own
   units but on a phone it is drawn a good deal narrower, and every unit added
   to the box shrinks the names in the gutter by the same proportion - a wider
   box buys a longer flat line and costs the labels, which is the wrong trade
   in both directions. */
export const GEOM = { W: 460, H: 440, padL: 30, padR: 132, padT: 14, padB: 26 };

/* Derived from the table rather than written out again, so a fourth view is
   one edit in lib/race.mjs and nothing here. */
type ViewId = keyof typeof VIEWS;
const VIEW_IDS = Object.keys(VIEWS) as ViewId[];

const plotW = GEOM.W - GEOM.padL - GEOM.padR;
const plotH = GEOM.H - GEOM.padT - GEOM.padB;

/* A season with one moment in it is a column of dots, not a race, and
   stretching that column across the whole grid draws a chart that looks broken
   rather than early. So the plot collapses to the width of the markers
   themselves. Keyed on how many distinct moments are actually plotted rather
   than on how many weeks are scored: one week used to mean one dot, and now
   means sixty-five games and a genuine line. */
const spanOf = (n: number) => (n <= 1 ? 30 : plotW);

/* Enough precision that inverting a coordinate lands back on the number it
   came from, short enough that the points attribute stays readable. */
const r = (n: number) => Math.round(n * 1000) / 1000;

/** How many weeks the short window covers, when the season is long enough. */
const WINDOW = 4;

/**
 * Series that stay apart without hue doing the work.
 *
 * Each manager in the league has a driver in `Karts.tsx`: a face at the head
 * of their line and a colour taken from it. That is what a reader matches on,
 * and it is a stronger key than any of the three this used to rely on,
 * because it is a picture of a specific thing rather than one value along an
 * axis. The dash pattern comes from the same table and is still doing work -
 * eight distinguishable hues do not exist on a dark ground for a deuteranope,
 * so the pairs that hue does not separate are given different strokes.
 *
 * A manager with no driver - a mid-season addition, or a payload written by a
 * bot that knows a name this build does not - falls back to four tokens used
 * twice over, the pair that shares a colour told apart by stroke pattern and
 * marker shape.
 */
const IN = ["var(--amber)", "var(--teal)", "var(--chalk)", "var(--red)"];
const DASH = ["none", "6 4"];

const styleFor = (manager: string, i: number) => {
  /* `Object.hasOwn`, not `KARTS[manager]`. A manager keyed "constructor" or
     "toString" indexes Object.prototype instead, which is truthy and is not a
     Kart - so the fallback below is skipped, `marker` comes back undefined and
     the markers loop calls `MARKER[undefined]`, which throws and takes the
     whole tab down. The names come off a payload fetched over the network;
     the fallback exists for names this file does not know, and these are
     names it does not know. */
  const kart = Object.hasOwn(KARTS, manager) ? KARTS[manager] : undefined;
  if (kart) {
    return { stroke: kart.color, dash: kart.dash, marker: kart.marker, kart };
  }
  return {
    stroke: IN[i % IN.length],
    dash: DASH[Math.floor(i / IN.length) % DASH.length],
    /* filled circle against filled square: different silhouette and different
       weight, so the pair reads apart at four pixels across */
    marker: (Math.floor(i / IN.length) % DASH.length === 1
      ? "square"
      : "circle") as Marker,
    kart: null,
  };
};

/* One marker, centred, about six units across whatever the shape. Four
   silhouettes rather than two, because the drivers took the colour channel
   away from the accessibility argument and this is the channel that replaces
   it - a shape is a shape in greyscale and under every colour-blindness. */
const MARKER: Record<Marker, (x: number, y: number) => string> = {
  circle: () => "",
  square: (x, y) => `${r(x - 3)},${r(y - 3)} ${r(x + 3)},${r(y - 3)} ${r(x + 3)},${r(y + 3)} ${r(x - 3)},${r(y + 3)}`,
  diamond: (x, y) => `${r(x)},${r(y - 4.2)} ${r(x + 4.2)},${r(y)} ${r(x)},${r(y + 4.2)} ${r(x - 4.2)},${r(y)}`,
  /* sat a shade low so the visual centre of a triangle lands on the point it
     is marking rather than above it */
  triangle: (x, y) => `${r(x)},${r(y - 4)} ${r(x + 3.8)},${r(y + 2.8)} ${r(x - 3.8)},${r(y + 2.8)}`,
};

/* Big enough to be a face and not a blob, small enough that eight of them
   level on a Saturday in September are eight overlapping faces rather than one
   shape. The art is cropped to heads for this reason: a whole Kart render at
   this size is a smudge, and a face is still a face. */
const ICON = 26;

/* Step sizes a reader counts in. 4 is in the list and 3 is not, which is the
   whole point of having a list: the steps people read off an axis without
   thinking are the ones they can add up in their head. */
const STEPS = [1, 2, 4, 5, 10, 20, 25, 50, 100];

/**
 * The gridlines, as values: a round step near a fifth of the range, then every
 * multiple of it the axis actually covers.
 *
 * The alternative - equal slices of whatever the range happens to be - is what
 * this drew first, and on a fitted axis a quarter is almost never a whole
 * number: a league 14 points wide got 10, 14, 17, 21, 24, which are five
 * correct numbers in four different gaps, and a ruler with uneven markings is
 * harder to read than no ruler. Rounding the labels instead is worse again,
 * because then the line is not where its own label says.
 */
const ticksFor = (base: number, top: number) => {
  const step = STEPS.find((v) => (top - base) / v <= 5) ?? Math.ceil((top - base) / 5);
  const out: number[] = [];
  for (let v = Math.ceil(base / step) * step; v <= top; v += step) out.push(v);
  /* An axis with no lines on it at all reads as a chart that failed to draw,
     which is a worse thing to ship than one dead line. */
  return out.length ? out : [base, top];
};

/**
 * The axis the chart has always fitted, kept at its old name and signature
 * because that is what the tests invert coordinates through.
 *
 * Fitted rather than pinned - but be clear about where that still buys
 * anything, because drawing game by game changed the answer. A race that runs
 * from the first kickoff necessarily passes through nought on the way, so on
 * the full-season Total points view the fitted floor *is* nought and the pack
 * gets the thin band this was written to avoid: about 46% of the plot's height
 * on the live payload today, and a quarter of it by December.
 *
 * That is not a bug to be tuned out of the axis, it is the shape of the
 * quantity - the spread between managers grows like the root of the weeks
 * played and everybody's total grows like the weeks played - and it is what
 * the other two views and the window are for. Fitting still earns its keep in
 * exactly those places: inside a window the lowest value is a long way from
 * nought, and on vs Average the floor is negative and must not be clamped.
 */
export const axisOf = (values: number[]) => axisFor(values, { floorAtZero: true });

/** Where a value sits vertically, given the range the axis covers. */
const yOf = (v: number, base: number, top: number, down: boolean) =>
  down
    ? GEOM.padT + ((v - base) / (top - base)) * plotH
    : GEOM.H - GEOM.padB - ((v - base) / (top - base)) * plotH;

export function TrendsChart({
  byWeek,
  managers,
  results = [],
}: {
  byWeek: Data["byWeek"];
  managers: string[];
  results?: NonNullable<Data["results"]>;
}) {
  /* Kept on the shell rather than in this component, like every other control
     on the page: switching to Trophies and back must not throw away the view
     somebody chose. */
  const [view, setView] = useViewState<ViewId>("race.view", "points");
  const [weeksBack, setWeeksBack] = useViewState<number>("race.window", 0);
  /* Empty means everybody, which is the same convention the three other
     dropdowns on this page use - and what keeps "all" stable when a manager
     joins or leaves. */
  const [sel, setSel] = useViewState<string[]>("race.only", []);

  const season = useMemo(
    () => raceFrames(byWeek, results, managers),
    [byWeek, results, managers]
  );

  const model = useMemo(() => {
    const { all, weeks, frames } = season;
    const V = VIEWS[view];
    const firstWeek = windowStart(weeks.length, weeksBack);
    /* Kept by which week a frame belongs to rather than by where it lands on
       the axis, because the two modes do not put their points in the same
       places and a fraction lands between them in one of them. The week
       before the window comes too, where there is one: it carries the level
       everybody entered the window on, and four weeks of movement needs five
       points to draw. */
    const shown = frames.filter(
      (f) => f.wi >= firstWeek || (Boolean(f.week) && f.wi === firstWeek - 1)
    );
    const inWindow = weeks.slice(firstWeek);
    /* The left-hand edge is whatever actually got through, so the plot starts
       on data rather than on the slice boundary it happens to sit after -
       which is what used to leave a quarter of the chart blank. */
    const from = shown.length ? shown[0].x : 0;
    const reach = Math.max(1e-9, (shown.length ? shown[shown.length - 1].x : 1) - from);

    /* Fitted to everybody, not to the selection. Dimming seven managers is a
       way of finding your own line in the pack; if it rescaled the axis it
       would be a different chart each time, and the one thing you could not
       then do is compare yourself to the pack you just hid. */
    const { base, top } = axisFor(
      shown.flatMap((f) => all.map((m) => V.y(f.totals, m))),
      { floorAtZero: V.floorAtZero }
    );

    const xAt = (x: number) => GEOM.padL + ((x - from) / reach) * spanOf(shown.length);
    const yAt = (v: number) => yOf(v, base, top, V.down);

    const series = all.map((manager, i) => {
      const pts: { x: number; y: number; v: number; week: boolean }[] = [];
      for (const f of shown) {
        const v = V.y(f.totals, manager);
        if (typeof v !== "number") continue;
        /* The week before the window closes the lead-in, and it is where the
           line enters rather than a week the chart is showing: the window
           gives it no label and no divider, so a marker on it would be a
           fifth dot in a four week view. It still anchors the line, because
           four weeks of movement needs the level everybody started them on. */
        const owned = Boolean(f.week) && f.wi >= firstWeek;
        pts.push({ x: r(xAt(f.x)), y: r(yAt(v)), v, week: owned });
      }
      /* A vertex is only needed where a line turns, plus every week boundary -
         those are what the hidden table is checked against, and a flat week
         would otherwise lose the marker that says it happened. On the points
         view most frames repeat the one before them, because a total only
         moves on a game its owner won. */
      const keep = corners(pts.map((p) => p.y));
      const coords = pts.filter((p, j) => p.week || keep.has(j));
      /* What the gutter prints. Taken from this manager's own last plotted
         value rather than from the last frame of the season: a manager the
         payload stopped carrying has no value there, and `NaN` in the gutter
         is a worse answer than their last real one. */
      const value = pts.length ? pts[pts.length - 1].v : null;
      return { manager, coords, value, style: styleFor(manager, i) };
    });

    /* Drivers and names stack up wherever two managers are level. Push them
       apart from the top down, then, if the column has run off the bottom,
       push it back up from the bottom - rather than sliding the whole column,
       which just moves the overflow to the other end and paints the leader's
       name over the paragraph above the chart, because the svg is
       `overflow:visible` and nothing clips it.

       The gap wants to be the height of a driver rather than the height of a
       name, because the faces are the thing that must not overlap: two names a
       few units apart are still two names, and two faces a few units apart are
       a pile. Eight of them want 196 of the plot's 400 units, which fits - but
       "fits" is a fact about this league and not about this code, and at ten
       managers the column stops fitting and the passes below clamp the surplus
       onto padT, which draws three names on one coordinate. So the gap is
       whatever the column can actually afford, and only then the height of a
       face. */
    const labels = series
      .filter((s) => s.coords.length)
      .map((s) => {
        const end = s.coords[s.coords.length - 1];
        return {
          s,
          y: end.y,
          /* where the line actually ends, kept because `y` is about to move.
             A driver nudged off its own line is drawn with a leader back down
             to this, so the chart never claims a total it is not showing. */
          at: end.y,
          x: end.x,
          /* the figure the name is standing next to, in whatever the chart is
             currently measuring, so the gutter answers "how many" as well as
             "who" and the chart needs no hover */
          value: s.value as number,
        };
      })
      .sort((a, b) => a.y - b.y);
    const GAP = Math.min(ICON + 2, labels.length > 1 ? plotH / (labels.length - 1) : ICON + 2);
    let prev = -Infinity;
    for (const l of labels) l.y = prev = Math.max(l.y, prev + GAP);
    const bottom = GEOM.H - GEOM.padB;
    if (labels.length && labels[labels.length - 1].y > bottom) {
      let next = bottom + GAP;
      for (let i = labels.length - 1; i >= 0; i--) {
        labels[i].y = next = Math.max(GEOM.padT, Math.min(labels[i].y, next - GAP));
      }
    }

    return { all, base, top, series, labels, weeks: inWindow, xAt, shown, firstWeek };
  }, [season, view, weeksBack]);

  if (!byWeek.length) {
    return (
      <p className="caption">
        No week has been scored yet, so there is nothing to chart. The race
        appears as soon as the first Saturday is in.
      </p>
    );
  }

  const V = VIEWS[view];
  const { all, base, top, series, labels, weeks, xAt, shown, firstWeek } = model;
  const ticks = ticksFor(base, top);
  const span = spanOf(shown.length);
  /* Where the plot stops and the gutter of names starts. */
  const gutter = GEOM.padL + span;
  const box = gutter + GEOM.padR;
  const dim = (m: string) => sel.length > 0 && !sel.includes(m);
  /* Every week label on a short season, every second or third by December:
     twelve labels across 300 units would overlap. */
  const every = Math.ceil(weeks.length / 9);
  const windowed = weeksBack > 0 && season.weeks.length > weeksBack;

  /* A real minus sign rather than a hyphen: these sit in a monospace column
     beside a proportional name, and the hyphen is visibly too short for the
     digits it qualifies. Used by the axis labels as well as the gutter - the
     two have to read as the same number. */
  const signed = (v: number, dp = 0) =>
    `${v < 0 ? "−" : "+"}${Math.abs(v).toFixed(dp)}`;

  /** The number in the gutter, in the unit the chart is currently drawn in. */
  const badge = (v: number) =>
    view === "gap"
      ? /* Never signed. The axis counts downwards and the caption says
           "behind", so a minus here would be a second negative on a number
           that is already a deficit - and the axis labels, which cannot carry
           one, would then disagree with the gutter. The leader is a word
           rather than a nought, because "0 behind" is not how anybody says
           it. */
        v === 0
        ? "leader"
        : String(Math.round(v))
      : view === "avg"
      ? signed(v, 1)
      : String(Math.round(v));

  return (
    <>
      <div className="filters">
        <div className="seg" role="group" aria-label="What the chart measures">
          {VIEW_IDS.map((id) => (
            <button
              key={id}
              type="button"
              className="segbtn"
              aria-pressed={view === id}
              onClick={() => setView(id)}
            >
              {VIEWS[id].label}
            </button>
          ))}
        </div>
        {/* Only once there is a season to cut down. A window wider than the
            league has played is not a choice, it is the same chart twice. */}
        {season.weeks.length > WINDOW && (
          <div className="seg" role="group" aria-label="How much of the season">
            <button
              type="button"
              className="segbtn"
              aria-pressed={weeksBack === 0}
              onClick={() => setWeeksBack(0)}
            >
              Full season
            </button>
            <button
              type="button"
              className="segbtn"
              aria-pressed={weeksBack === WINDOW}
              onClick={() => setWeeksBack(WINDOW)}
            >
              Last {WINDOW} weeks
            </button>
          </div>
        )}
        <Dropdown
          name="race"
          summary={
            sel.length === 0
              ? "All managers"
              : sel.length === 1
              ? cap(sel[0])
              : `${sel.length} managers`
          }
          allLabel="All managers"
          options={all.map((m) => ({
            value: m,
            label: cap(m),
            badge: (
              <span
                className="ddot"
                style={{ background: styleFor(m, all.indexOf(m)).stroke }}
                aria-hidden="true"
              />
            ),
          }))}
          selected={sel}
          onClear={() => setSel([])}
          onToggle={(m) =>
            setSel((v) => (v.includes(m) ? v.filter((x) => x !== m) : [...v, m]))
          }
        />
      </div>

      <p className="asof">
        {V.caption}{" "}
        {windowed ? `The last ${WINDOW} weeks only. ` : ""}
        Names sit at the end of their own line; the number beside each is{" "}
        {V.gutter}.
      </p>

      <div className="race">
        {/* The numbers live in the table below, which is the accessible
            version of this and not a supplement to it. Announcing the svg as
            well would read a second, worse copy of the same data - so the
            drawing is hidden and the table is not. */}
        {/* Never drawn bigger than its own units. The type inside an svg
            scales with the box, so letting a 460-unit chart fill a 732px
            column would render 12px labels at 19px; capping it at 1:1 fixes
            the type at the sizes the rest of the page uses, and a phone gets
            the same chart at about three quarters. */}
        <svg
          viewBox={`0 0 ${box} ${GEOM.H}`}
          style={{ maxWidth: box }}
          aria-hidden="true"
          focusable="false"
        >
          {/* The floor of the plot, drawn as an axis rather than as a
              gridline: it carries no label because the value it sits on is
              the fitted floor, which is a number nobody chose and nobody
              needs. */}
          <line
            x1={GEOM.padL}
            x2={gutter}
            y1={GEOM.H - GEOM.padB}
            y2={GEOM.H - GEOM.padB}
            className="grid"
          />

          {ticks.map((v, i) => {
            const y = r(yOf(v, base, top, V.down));
            return (
              <g key={i}>
                <line x1={GEOM.padL} x2={gutter} y1={y} y2={y}
                      className={view === "avg" && v === 0 ? "grid zero" : "grid"} />
                <text x={GEOM.padL - 6} y={y + 3} className="ax r">
                  {view === "avg" && v !== 0 ? signed(v) : v}
                </text>
              </g>
            );
          })}

          {/* One divider per week, and the name of the week between two of
              them, so the x axis still reads as a calendar even though the
              line inside it moves game by game.

              The dividers are why the name sits in the middle of its week
              rather than under the week's own last point: a week is a band of
              games here, not an instant, and a label centred in a band is how
              every chart with bands labels them. Without the dividers the same
              label just looked half a week adrift of the marker beside it,
              which is what it was before this loop drew anything. */}
          {/* Where the window opens, when it is not the start of the season.
              Without it the lead-in runs into the first week with nothing
              between them, and the first label looks adrift of its own band. */}
          {firstWeek > 0 && weeks.length > 0 && (
            <line
              x1={r(xAt(weeks[0].x0))}
              x2={r(xAt(weeks[0].x0))}
              y1={GEOM.padT}
              y2={GEOM.H - GEOM.padB}
              className="wk"
            />
          )}
          {weeks.map((w, i) => (
            <g key={w.key}>
              {i < weeks.length - 1 && (
                <line
                  x1={r(xAt(w.x1))}
                  x2={r(xAt(w.x1))}
                  y1={GEOM.padT}
                  y2={GEOM.H - GEOM.padB}
                  className="wk"
                />
              )}
              {i % every === 0 && (
                <text
                  x={r(xAt(w.at))}
                  y={GEOM.H - GEOM.padB + 15}
                  className="ax mid"
                >
                  {w.short}
                </text>
              )}
            </g>
          ))}

          {series.map((s) => {
            const pts = s.coords.map((p) => `${p.x},${p.y}`).join(" ");
            return (
              <g
                key={s.manager}
                data-series={s.manager}
                data-points={pts}
                data-week-points={s.coords
                  .filter((p) => p.week)
                  .map((p) => `${p.x},${p.y}`)
                  .join(" ")}
                className={dim(s.manager) ? "off" : undefined}
              >
                {/* One point is a position, not a direction. A polyline
                    through it draws nothing anyway, so this is about not
                    claiming a trend in the markup either. */}
                {s.coords.length > 1 && (
                  <polyline
                    points={pts}
                    fill="none"
                    stroke={s.style.stroke}
                    strokeDasharray={s.style.dash}
                    strokeWidth={sel.includes(s.manager) ? 3 : 2}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                )}
                {/* A dot per week rather than per game: at sixty-five games a
                    Saturday the markers would be a solid bar, and the week is
                    the tick a reader counts in anyway. The head of the line is
                    skipped because it is drawn later as the driver - a
                    3.2-unit dot behind a 26-unit face is invisible when it
                    lands and a smudge on the chin when the face is nudged. */}
                {s.coords.map((p, i) => {
                  if (season.perGame && !p.week) return null;
                  if (s.style.kart && i === s.coords.length - 1) return null;
                  const shape = MARKER[s.style.marker](p.x, p.y);
                  return shape ? (
                    <polygon key={i} data-marker="" points={shape} fill={s.style.stroke} />
                  ) : (
                    <circle key={i} data-marker="" cx={p.x} cy={p.y} r="3.2" fill={s.style.stroke} />
                  );
                })}
              </g>
            );
          })}

          {/* The drivers, after every line rather than inside their own
              series, because a face belongs on top of all eight lines and not
              only on top of the ones drawn before it. They carry `data-marker`
              because that is what they are - each is one series' last point.

              They ride the decluttered y rather than the raw one, and where
              those differ a leader runs back to the line. Left on the raw one
              they simply overlap. */}
          {/* Leaders first and faces second, in two passes rather than one:
              drawn inside each driver's own group, the eighth manager's leader
              is painted across the first manager's face. */}
          {labels.map(({ s, y, at, x }) =>
            s.style.kart && Math.abs(y - at) > 1 ? (
              <line
                key={s.manager}
                x1={x}
                x2={x}
                y1={r(at)}
                y2={r(y)}
                stroke={s.style.stroke}
                strokeWidth="1.5"
                className={dim(s.manager) ? "lead off" : "lead"}
              />
            ) : null
          )}
          {labels.map(({ s, y, x }) =>
            s.style.kart ? (
              <g
                key={s.manager}
                data-marker=""
                data-kart={s.manager}
                className={dim(s.manager) ? "off" : undefined}
              >
                <KartIcon kart={s.style.kart} x={x} y={r(y)} size={ICON} />
              </g>
            ) : null
          )}

          {labels.map(({ s, y, value }) => (
            <g key={s.manager} className={dim(s.manager) ? "off" : undefined}>
              {/* A sample of the line itself, so the dash pattern is beside
                  the name rather than only out in the plot. Clear of the
                  driver, which is centred on the last point and so overhangs
                  the plot by half its own width. It is still here rather than
                  replaced by a second copy of the face: it carries the dash
                  pattern, which is the half of the key a face cannot show. */}
              <line
                x1={gutter + ICON / 2 + 3}
                x2={gutter + ICON / 2 + 17}
                y1={r(y)}
                y2={r(y)}
                stroke={s.style.stroke}
                strokeDasharray={s.style.dash}
                strokeWidth="2"
              />
              <text x={gutter + ICON / 2 + 21} y={r(y) + 4} className="nm" fill={s.style.stroke}>
                {cap(s.manager)}
                <tspan className="nmp"> {badge(value)}</tspan>
              </text>
            </g>
          ))}
        </svg>
      </div>

      {/* The chart, as numbers. This is not a courtesy copy: the svg above is
          aria-hidden, so for a screen reader this table *is* the chart.

          It carries running totals whichever view is on, and it is weekly
          whatever the x axis is doing. Both of those are deliberate. A table
          with nine hundred game columns is not an accessible table, it is a
          punishment; and the three views are three lenses on one set of
          numbers, so printing the totals lets a reader derive any of them
          while switching view does not move the furniture under somebody
          halfway through navigating it. */}
      <table className="vh">
        <caption>
          Points after each week, by manager. The chart above is drawn as{" "}
          {V.label.toLowerCase()}
          {windowed ? `, over the last ${WINDOW} weeks` : ""}.
        </caption>
        <thead>
          <tr>
            <th scope="col">Manager</th>
            {season.weeks.map((w) => (
              <th key={w.key} scope="col">
                {w.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {all.map((m) => (
            <tr key={m}>
              <th scope="row">{cap(m)}</th>
              {season.frames
                .filter((f) => f.week)
                .map((f, i) => (
                  <td key={i}>{f.totals[m] === null ? "—" : f.totals[m]}</td>
                ))}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

export const css = `
    .race{margin-bottom:6px}
    .race svg{width:100%;height:auto;display:block;overflow:visible}
    .race .grid{stroke:var(--rule);stroke-width:1}
    /* The line an average manager is standing on. Brighter than a gridline
       because on that view it is the thing every other line is measured
       against, and a reader who cannot find it cannot read the chart. */
    .race .grid.zero{stroke:var(--dim);stroke-width:1.5}
    /* The line between one week and the next. Dashed and on the rule colour
       because it is furniture rather than data: it has to be findable when you
       look for it and invisible when you are reading a driver's line across
       it. */
    .race .wk{stroke:var(--rule);stroke-width:1;stroke-dasharray:2 5}
    .race .ax{font-family:ui-monospace,Menlo,monospace;font-size:12px;fill:var(--muted)}
    .race .ax.r{text-anchor:end} .race .ax.mid{text-anchor:middle}
    .race .nm{font-size:15px;font-weight:600}
    /* The tie between a driver that has been nudged clear of the pack and the
       point it belongs to. Still lighter than a series - it is a pointer, not
       data - but no longer the 1-unit, 2-2 hairline it was, which on the chart
       that made every driver move was invisible at exactly the moment eight of
       them needed explaining. Dash and width carry that on their own: an
       opacity would dim it below the contrast floor and, worse, do it
       invisibly - see tests/contrast.test.tsx, which is why there is no
       opacity anywhere else in this stylesheet. */
    .race .lead{stroke-dasharray:3 3}
    /* A manager the reader has filtered out. They stay on the chart rather
       than vanishing, because the point of picking your own kart out is
       seeing it against the pack - a pack that disappeared when you looked at
       yourself would answer a different question.

       Dimmed to a token rather than with an "opacity", which is what the
       first cut used and what tests/contrast.test.tsx exists to stop: a name
       at .15 is about 1.1:1 on the ink, unreadable, and invisible from the
       stylesheet. --dim is 5.54:1 and passes AA on its own, so a backgrounded
       manager is quieter without being illegible. The face is the exception
       and it is not text - a greyscale PNG has no contrast floor to fail. */
    .race .off polyline{stroke:var(--dim)}
    .race .off line,.race line.lead.off{stroke:var(--dim)}
    .race .off polygon,.race .off circle{fill:var(--dim)}
    .race .off text{fill:var(--dim)}
    .race .off image{filter:grayscale(1)}
    .race .nmp{font-family:ui-monospace,Menlo,monospace;font-size:13px;font-weight:400}
    /* A segmented control, which is what three mutually exclusive answers to
       one question look like. aria-pressed carries the state; the fill is
       what says it out loud. */
    .seg{display:flex;border:1px solid var(--rule);border-radius:6px;overflow:hidden}
    .segbtn{background:transparent;border:0;border-right:1px solid var(--rule);
      color:var(--muted);font:inherit;font-size:12.5px;padding:7px 11px;cursor:pointer;
      white-space:nowrap}
    .segbtn:last-child{border-right:0}
    .segbtn:hover{color:var(--chalk)}
    .segbtn[aria-pressed="true"]{background:var(--amber);color:var(--ink);font-weight:600}
    /* The series colour beside its name in the picker, so choosing a manager
       is choosing a line rather than reading a name and hunting for it. It
       sits in the Dropdown's existing badge slot and is aria-hidden: the name
       is already the label, and "green" is not a second fact about it. */
    .ddot{width:10px;height:10px;border-radius:50%;flex-shrink:0}
    /* Off the screen but in the accessibility tree, which display:none and
       visibility:hidden are both the wrong side of. The 1px box with a clip on
       it is the standard trick and the reason it is not simply width:0 is that
       some readers skip a zero-sized box entirely. */
    .vh{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;
      clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;border:0}
`;
