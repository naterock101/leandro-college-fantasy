import { useMemo } from "react";

import { cap } from "../../lib/format.mjs";
import type { Data } from "../types";
import { KartIcon, KARTS, type Marker } from "./Karts";

/**
 * The race: every manager's running points total, week by week.
 *
 * Hand-rolled SVG. A charting library would be a runtime dependency in a repo
 * whose first ground rule is that there are none, and this chart is one
 * polyline per manager against a linear scale - the library would be several
 * hundred kilobytes to avoid about forty lines of arithmetic.
 *
 * Everything it draws comes from `byWeek[].cumulative`, which is in the
 * always-fetched core file, so the chart is on screen the moment the tab
 * opens rather than after a second request.
 */

/* The drawing surface, in user units rather than pixels: the svg carries a
   viewBox and no width, so this is an aspect ratio and a set of proportions,
   and the browser decides how big it is. `padR` is the wide one because the
   right-hand gutter holds the manager names - a legend would make a reader
   match eight colours to eight names by memory, which is exactly the task
   colour-blindness makes impossible and everyone else finds tedious.

   The vertical half is fixed and the horizontal half is not: `W` is the width
   of a season with weeks in it, and a single scored week draws a much narrower
   box instead. Only the height and the vertical padding are load-bearing for
   the tests, which invert a plotted y back into points to check it against the
   hidden table - hard-coding those in the test would mean a change here
   silently stops the test measuring anything.

   `H` is 440 rather than the 280 this started at, and the extra 160 units are
   not decoration. A driver is 26 units tall and must not overlap the next one,
   so the height is what decides how close on points two managers can be and
   still each keep their face on their own line. The arithmetic that picked the
   number: the axis below fits the plot to the spread of the pack, this league
   opened about 14 points wide, and 440 leaves 400 units of plot - which is
   about 28 units for every point of difference between two managers. One point
   apart is therefore still two lanes rather than a pile. At 280 it was 17, and
   the whole grid had to be shoved apart to be read at all.

   `W` is deliberately left alone. The svg is never drawn wider than its own
   units but on a phone it is drawn a good deal narrower, and every unit added
   to the box shrinks the names in the gutter by the same proportion - a wider
   box buys a longer flat line and costs the labels, which is the wrong trade
   in both directions. It did grow to 500 for one commit, to make room for a
   column of drivers standing in the gutter, and came back the moment the
   drivers went out onto the plot instead: the gutter holds names, and the
   space to separate eight faces was in the chart all along. */
export const GEOM = { W: 460, H: 440, padL: 30, padR: 132, padT: 14, padB: 26 };

const plotW = GEOM.W - GEOM.padL - GEOM.padR;
const plotH = GEOM.H - GEOM.padT - GEOM.padB;

/* One week is a column of dots, not a race, and stretching that column across
   580 units of empty grid draws a chart that looks broken rather than early.
   So the plot collapses to the width of the markers themselves and the svg
   goes with it - which turns the one-week case into the dot plot it actually
   is, and turns back into a race the moment a second Saturday lands. Worth
   the special case because the league spends the first week of every season
   looking at it, and this season is there now. */
const spanOf = (n: number) => (n <= 1 ? 30 : plotW);

/* Enough precision that inverting a coordinate lands back on the integer it
   came from, short enough that the points attribute stays readable. */
const r = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Series that stay apart without hue doing the work.
 *
 * Each manager in the league has a driver in `Karts.tsx`: a face at the head
 * of their line and a colour taken from it. That is what a reader matches on,
 * and it is a stronger key than any of the three this used to rely on,
 * because it is a picture of a specific thing rather than one value along an
 * axis. The dash pattern comes from the same table and is still doing work -
 * eight distinguishable hues do not exist on a dark ground for a deuteranope,
 * so the pairs that hue does not separate are given different strokes. See
 * the grid in Karts.tsx for which pairs and why.
 *
 * A manager with no driver - a mid-season addition, or a payload written by a
 * bot that knows a name this build does not - falls back to what the chart did
 * before: four tokens used twice over, the pair that shares a colour told
 * apart by stroke pattern and marker shape. It is the same fallback the rest
 * of this file uses for a manager who is in one list and not the other, and
 * for the same reason: a name nobody has drawn yet should cost a plain line
 * and nothing else.
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

/**
 * The rail: where the drivers stand, now that they stand off the plot.
 *
 * They used to be centred on the last point of their own line, which made the
 * end of a season a pile of three things on one coordinate - a face, the dot
 * it was covering, and whatever the next manager's line was doing underneath.
 * The dot lost every time, so a chart about where eight people finished was
 * drawing seven of the eight finishing marks and hiding them.
 *
 * So the dots come back and the faces go somewhere else. Stacking them in the
 * gutter instead was the first answer and it was only half of one: eight heads
 * in a 60-unit column is still a column, and shifting them ten units apart
 * read as a wobble rather than as eight separate things.
 *
 * What actually separates them is the chart's own width. A season is already
 * a few hundred units of horizontal space with eight lines drawn across it,
 * so each face rides its own line at its own week: first place somewhere near
 * the opening Saturday, last place near the one before the finish, everybody
 * else spread evenly between. Nothing has to be nudged off its line to fit,
 * because the spacing is horizontal and the faces are 26 units wide - thirty
 * units apart on this season's chart, which is clearance by construction
 * rather than by a declutter pass.
 *
 * It also puts every face back on the thing it labels. A face in the gutter
 * was a legend entry that needed a leader line drawn to the point it stood
 * for; a face on the line is standing on its own evidence.
 *
 * The rail stops a week short of the end on purpose. That is the whole reason
 * any of this moved: the last point of each line is where a reader looks, and
 * it is the one point nothing is allowed to cover.
 */
const RIDE = { FROM: 0, TO: -2 } as const;

/* Early seasons have no room to spread into - two Saturdays is one gap, and
   three is two gaps shared between eight faces, which is closer together than
   a face is wide. Those weeks fall back to a staggered column, still set back
   from the finish so the dots survive, but a column: not as good, and better
   than a pile. The switch is a measurement rather than a week number, so a
   bigger league simply stays in the column longer.

   It leans back into the plot rather than out into the gutter, which is the
   same direction the spread goes and the reason the gutter is still only wide
   enough for names. On a one-week chart the lanes run off the left of a
   30-unit plot, so the column is clamped to half a face inside the axis and
   collapses to roughly one x - which for eight managers on one Saturday is
   the honest picture anyway. */
const RAIL = { LANES: 3, LANE: 10, X0: ICON / 2 + 6 };

/* Which lane a driver stands in, by its place down the column rather than by
   anything about the manager - the staircase only has to separate neighbours,
   and neighbours are whoever is next in the column. */
const railX = (i: number) => RAIL.X0 + (i % RAIL.LANES) * RAIL.LANE;

/**
 * Where a manager's line is at some x between two of its weeks.
 *
 * The faces sit at evenly spaced x positions, and even spacing almost never
 * lands on a Saturday - so this walks the drawn coordinates and interpolates
 * between the pair that straddle the x, which puts the face on the segment a
 * reader can see rather than near it.
 *
 * A manager who joined mid-season has no line out at the left-hand end, and
 * the x is clamped into the stretch they do have. That moves them off their
 * allotted slot and, with two late joiners, could in principle crowd one - but
 * the alternative is a face hanging in space to the left of its own line,
 * which is a chart that lies rather than one that is tight.
 */
const rideAt = (coords: [number, number][], x: number): [number, number] => {
  if (x <= coords[0][0]) return coords[0];
  const last = coords[coords.length - 1];
  if (x >= last[0]) return last;
  for (let i = 1; i < coords.length; i++) {
    const [x0, y0] = coords[i - 1];
    const [x1, y1] = coords[i];
    if (x <= x1) return [x, y0 + ((x - x0) / (x1 - x0)) * (y1 - y0)];
  }
  return last;
};

const shortLabel = (w: Data["byWeek"][number]) =>
  w.seasonType === "postseason" ? `P${w.week}` : `W${w.week}`;

type Series = {
  manager: string;
  /* one entry per week, null before the manager appears in the payload */
  values: (number | null)[];
  coords: [number, number][];
  style: ReturnType<typeof styleFor>;
};

/* Step sizes a reader counts in. 4 is in the list and 3 is not, which is the
   whole point of having a list: the steps people read off an axis without
   thinking are the ones they can add up in their head. */
const STEPS = [1, 2, 4, 5, 10, 20, 25, 50, 100];

/**
 * The gridlines, as values: a round step near a quarter of the range, then
 * every multiple of it the axis actually covers.
 *
 * The alternative - four equal slices of whatever the range happens to be -
 * is what this drew first, and on a fitted axis a quarter is almost never a
 * whole number: a league 14 points wide got 10, 14, 17, 21, 24, which are
 * five correct numbers in four different gaps, and a ruler with uneven
 * markings is harder to read than no ruler. Rounding the labels instead is
 * worse again, because then the line is not where its own label says.
 *
 * The leader's total may not land on one of these, and that is fine: their
 * name and their number are in the gutter at the end of their line, which is
 * where this chart answers "how many" anyway.
 */
const ticksFor = (base: number, top: number) => {
  const step = STEPS.find((v) => (top - base) / v <= 5) ?? Math.ceil((top - base) / 5);
  const out: number[] = [];
  for (let v = Math.ceil(base / step) * step; v <= top; v += step) out.push(v);
  /* Unreachable from `axisOf`, which hands over a whole-number floor and a
     top at least one above it - and a step is never wider than the range, so
     a multiple always lands inside. Kept because `ticksFor` is arithmetic on
     two numbers and nothing in its signature promises where they came from:
     an axis with no lines on it at all reads as a chart that failed to draw,
     which is a worse thing to ship than one dead line. */
  return out.length ? out : [base, top];
};

/**
 * The slice of the scoreboard the plot covers.
 *
 * Not zero-based, and that is the point. Cumulative points only ever go up,
 * so a zero-based axis spends most of its height on the stretch of the season
 * everybody has already driven through: by the second Saturday the whole
 * league lived in the top half of this chart as one band, every driver had to
 * be shoved off its own line to be legible, and the picture answered "who is
 * ahead" with eight faces in a column that were no longer standing on
 * anything. Fitting the axis to the pack spends the plot on the difference
 * between managers, which is the only thing this chart is read for.
 *
 * The top stays the leader's exact total rather than a rounded-up ceiling:
 * rounding puts the leading line short of the top of the plot, which reads as
 * everyone having further to go than they do.
 *
 * The floor is the back of the pack less a tenth of the spread, so the last
 * manager's line is not drawn along the axis itself and mistaken for zero,
 * and never less than a whole point below them - which is also what keeps a
 * league where everybody is level from dividing by nothing. It is clamped at
 * zero because a negative total is not a thing and an axis that starts at -1
 * says it might be.
 *
 * There is no sentence under the chart saying the scale is truncated; there
 * was one and it was cut, because it explained a convention the numbers
 * already carry. What carries it instead is the gutter, which prints every
 * manager's total beside their name, and the labelled gridlines, whose lowest
 * is plainly not zero. Nothing on this chart is read as a proportion of the
 * plot's height - it is read as an order, and an order survives a floor.
 */
export const axisOf = (values: number[]) => {
  const hi = values.length ? Math.max(...values) : 1;
  const lo = values.length ? Math.min(...values) : 0;
  const base = Math.max(0, Math.floor(lo - Math.max(1, (hi - lo) / 10)));
  return { base, top: Math.max(hi, base + 1) };
};

/** Where a value sits vertically, given the range the axis covers. */
const yAt = (v: number, base: number, top: number) =>
  GEOM.H - GEOM.padB - ((v - base) / (top - base)) * plotH;

const xAt = (i: number, n: number) =>
  GEOM.padL + (n <= 1 ? spanOf(n) : (i / (n - 1)) * plotW);

export function TrendsChart({
  byWeek,
  managers,
}: {
  byWeek: Data["byWeek"];
  managers: string[];
}) {
  const model = useMemo(() => {
    /* The union, not the standings list. A manager can be in one and not the
       other in both directions - the bot writes a week before a late joiner
       is in the league, and a payload written by an older bot can carry a
       manager the current standings have dropped - and a chart that silently
       omitted either would be wrong in the way nobody checks. */
    const all = [
      ...new Set([...managers, ...byWeek.flatMap((w) => Object.keys(w.cumulative ?? {}))]),
    ].sort();

    /* Every number that will be plotted, which is what the axis is fitted to
       - not just the last week's, because an early week below the floor would
       be drawn off the bottom of its own chart. */
    const { base, top } = axisOf(
      byWeek.flatMap((w) => Object.values(w.cumulative ?? {}).map((c) => c.points))
    );

    const series: Series[] = all.map((manager, i) => {
      const values = byWeek.map((w) => w.cumulative?.[manager]?.points ?? null);
      /* A manager absent from an early week did not score nothing that week -
         they were not in the payload. Backfilling a zero would draw a flat
         line along the bottom that says they played and lost, so the line
         starts at the first week they exist and the table leaves a gap. */
      const from = values.findIndex((v) => v !== null);
      const coords: [number, number][] =
        from < 0
          ? []
          : values
              .map((v, x) => [v, x] as const)
              .filter(([v, x]) => v !== null && x >= from)
              .map(([v, x]) => [r(xAt(x, byWeek.length)), r(yAt(v as number, base, top))]);
      return { manager, values, coords, style: styleFor(manager, i) };
    });

    /* Drivers and names stack up wherever two managers are level, which after
       one week is most of them and in the first week of this season was all
       eight. Push them apart from the top down, then, if the column has run
       off the bottom, push it back up from the bottom - rather than sliding
       the whole column, which just moves the overflow to the other end and
       paints the leader's name over the paragraph above the chart, because
       the svg is `overflow:visible` and nothing clips it.

       The gap wants to be the height of a driver rather than the height of a
       name, because the faces are the thing that must not overlap: two names a
       few units apart are still two names, and two faces a few units apart are
       a pile. Eight of them want 196 of the plot's 240 units, which fits - but
       "fits" is a fact about this league and not about this code, and at ten
       managers the column stops fitting and the passes below clamp the surplus
       onto padT, which draws three names on one coordinate. So the gap is
       whatever the column can actually afford, and only then the height of a
       face. Crowding faces is a worse chart; stacking names is a broken one. */
    const labels = series
      .filter((s) => s.coords.length)
      .map((s) => ({
        s,
        y: s.coords[s.coords.length - 1][1],
        /* where the line actually ends, kept because `y` is about to move.
           A driver that has been nudged off its own line is drawn with a
           leader back down to this, so the chart never claims a total it is
           not showing. */
        at: s.coords[s.coords.length - 1][1],
        x: s.coords[s.coords.length - 1][0],
        /* the total the name is standing next to, so the gutter answers "how
           many" as well as "who" and the chart needs no hover */
        points: s.values.filter((v): v is number => v !== null).slice(-1)[0],
      }))
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

    /* The drivers, placed. Taken off `labels` so they inherit its order -
       top of the gutter is first place - and so a manager with no driver is
       already filtered out. The y the face uses is its own, from the line or
       from the decluttered column, and never the other one's. */
    const racing = labels.filter((l) => l.s.style.kart);
    const n = byWeek.length;
    /* The stretch the rail is allowed: the first week to the one before the
       last, which is what keeps every finishing dot in the clear. */
    /* Half a face inside the opening week, so the leader's head sits on the
       plot rather than half over the y-axis labels. Still week one - the face
       starts where the week does instead of straddling it. */
    const from = xAt(RIDE.FROM, n) + ICON / 2;
    const to = xAt(Math.max(RIDE.FROM, n + RIDE.TO), n);
    const room = to - from;
    /* Spread only when the spread is worth having. A gap narrower than a face
       is two faces touching, which is the thing the gutter column was already
       doing in less space - so below that line, stay in the gutter. */
    const ride = racing.length > 1 ? room / (racing.length - 1) >= ICON : room > 0;
    const gutterX = GEOM.padL + spanOf(n);
    const drivers = racing.map((l, i) => {
      if (!ride) {
        const x = Math.max(GEOM.padL + ICON / 2, gutterX - railX(i));
        return { s: l.s, x, y: l.y, from: [l.x, l.at] as const };
      }
      const slot = racing.length > 1 ? from + (i / (racing.length - 1)) * room : from;
      const [x, y] = rideAt(l.s.coords, slot);
      /* No leader: the face is standing on the line, so there is nothing to
         tie it back to. */
      return { s: l.s, x, y, from: null };
    });

    return { all, base, top, series, labels, drivers, weeks: byWeek };
  }, [byWeek, managers]);

  if (!byWeek.length) {
    return (
      <p className="caption">
        No week has been scored yet, so there is nothing to chart. The race
        appears as soon as the first Saturday is in.
      </p>
    );
  }

  const { base, top, series, labels, drivers, weeks } = model;
  const ticks = ticksFor(base, top);
  /* Every week label at four weeks, every second or third by December: twelve
     labels across 306 units would overlap. The last week is labelled too, but
     only when it is a full step clear of the previous one - at twelve weeks
     and a step of two, W12 lands one unit from W11 and the pair reads as a
     smudge, and the gutter already says where the season has got to. */
  const every = Math.ceil(weeks.length / 9);
  const lastTick = Math.floor((weeks.length - 1) / every) * every;
  const tick = (i: number) =>
    i % every === 0 || (i === weeks.length - 1 && weeks.length - 1 - lastTick >= every);
  const span = spanOf(weeks.length);
  /* Where the plot stops and the gutter of names starts. */
  const gutter = GEOM.padL + span;

  const box = gutter + GEOM.padR;

  return (
    <>
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
              needs. It exists because the gridlines are now on round
              multiples and the lowest of them is usually a little way up the
              chart - which left the bottom of the plot as open space, the
              week labels floating under nothing, and the whole drawing
              looking like it had been cut off. */}
          <line
            x1={GEOM.padL}
            x2={gutter}
            y1={GEOM.H - GEOM.padB}
            y2={GEOM.H - GEOM.padB}
            className="grid"
          />

          {ticks.map((v, i) => (
            <g key={i}>
              <line
                x1={GEOM.padL}
                x2={gutter}
                y1={r(yAt(v, base, top))}
                y2={r(yAt(v, base, top))}
                className="grid"
              />
              <text x={GEOM.padL - 6} y={r(yAt(v, base, top)) + 3} className="ax r">
                {v}
              </text>
            </g>
          ))}

          {weeks.map((w, i) =>
            tick(i) ? (
              <text
                key={w.key}
                x={r(xAt(i, weeks.length))}
                y={GEOM.H - GEOM.padB + 15}
                className="ax mid"
              >
                {shortLabel(w)}
              </text>
            ) : null
          )}

          {series.map((s) => {
            const pts = s.coords.map(([x, y]) => `${x},${y}`).join(" ");
            return (
              <g key={s.manager} data-series={s.manager} data-points={pts}>
                {/* One point is a position, not a direction. A polyline
                    through it draws nothing anyway, so this is about not
                    claiming a trend in the markup either. */}
                {s.coords.length > 1 && (
                  <polyline
                    points={pts}
                    fill="none"
                    stroke={s.style.stroke}
                    strokeDasharray={s.style.dash}
                    strokeWidth="2"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                )}
                {/* Every point, the last one included. It used to be skipped
                    for anyone with a driver, because a 3.2-unit dot under a
                    26-unit face is either invisible or a smudge on the chin -
                    but that was an argument about a face parked on top of it,
                    and the faces have moved to the rail. The finishing mark is
                    the one point on each line a reader is actually looking
                    for, so it is drawn like all the others. */}
                {s.coords.map(([x, y], i) => {
                  const pts = MARKER[s.style.marker](x, y);
                  return pts ? (
                    <polygon key={i} data-marker="" points={pts} fill={s.style.stroke} />
                  ) : (
                    <circle key={i} data-marker="" cx={x} cy={y} r="3.2" fill={s.style.stroke} />
                  );
                })}
              </g>
            );
          })}

          {/* The drivers, after every line rather than inside their own
              series, because a face belongs on top of all eight lines and not
              only on top of the ones drawn before it.

              They no longer carry `data-marker`, and that is the whole move:
              a face is a label now, not a plotted point. The point it labels
              is drawn back on the line in its own colour, which is what the
              count in the markers pass is counting.

              Where they stand is decided above: out along their own line at
              their own week when the season is wide enough to spread them,
              and in a staggered gutter column when it is not. Only the second
              needs a leader, because only the second has moved a face off the
              coordinate it is standing for. */}
          {/* Leaders first and faces second, in two passes rather than one:
              drawn inside each driver's own group, the eighth manager's leader
              is painted across the first manager's face. */}
          {drivers.map(({ s, x, y, from }) =>
            from ? (
              <line
                key={s.manager}
                x1={from[0]}
                x2={r(x + ICON / 2 + 2)}
                y1={r(from[1])}
                y2={r(y)}
                stroke={s.style.stroke}
                strokeWidth="1.5"
                className="lead"
              />
            ) : null
          )}
          {drivers.map(({ s, x, y }) => (
            <g key={s.manager} data-kart={s.manager}>
              <KartIcon kart={s.style.kart!} x={r(x)} y={r(y)} size={ICON} />
            </g>
          ))}

          {labels.map(({ s, y, points }) => (
            <g key={s.manager}>
              {/* A sample of the line itself, so the dash pattern is beside
                  the name rather than only out in the plot. */}
              {/* Clear of the finishing dot and of nothing else, because
                  nothing else is out here any more - the drivers are back on
                  the plot. The sample carries the dash pattern, which is the
                  half of the key that a face cannot show, and is the only
                  thing in the gutter that is not a name. */}
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
                <tspan className="nmp"> {points}</tspan>
              </text>
            </g>
          ))}
        </svg>
      </div>

      {/* The chart, as numbers. This is not a courtesy copy: the svg above is
          aria-hidden, so for a screen reader this table *is* the chart, and
          the test that keeps the two saying the same thing inverts the drawn
          coordinates rather than comparing two variables. */}
      <table className="vh">
        <caption>Points after each week, by manager</caption>
        <thead>
          <tr>
            <th scope="col">Manager</th>
            {weeks.map((w) => (
              <th key={w.key} scope="col">
                {w.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {series.map((s) => (
            <tr key={s.manager}>
              <th scope="row">{cap(s.manager)}</th>
              {s.values.map((v, i) => (
                <td key={i}>{v === null ? "—" : v}</td>
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
       opacity anywhere in this stylesheet. */
    .race .lead{stroke-dasharray:3 3}
    .race .nmp{font-family:ui-monospace,Menlo,monospace;font-size:13px;font-weight:400}
    /* Off the screen but in the accessibility tree, which display:none and
       visibility:hidden are both the wrong side of. The 1px box with a clip on
       it is the standard trick and the reason it is not simply width:0 is that
       some readers skip a zero-sized box entirely. */
    .vh{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;
      clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;border:0}
`;
