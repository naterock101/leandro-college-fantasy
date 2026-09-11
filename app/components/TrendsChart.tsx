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
   in both directions. */
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

    return { all, base, top, series, labels, weeks: byWeek };
  }, [byWeek, managers]);

  if (!byWeek.length) {
    return (
      <p className="caption">
        No week has been scored yet, so there is nothing to chart. The race
        appears as soon as the first Saturday is in.
      </p>
    );
  }

  const { base, top, series, labels, weeks } = model;
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
                {/* Every point but the head of the line, which is drawn in a
                    later pass as the driver. Skipping it here rather than
                    drawing a dot underneath is deliberate: a 3.2-unit dot
                    behind a 17-unit face is invisible when it lands and a
                    smudge on the chin when the face is a few units off. */}
                {s.coords.map(([x, y], i) => {
                  if (s.style.kart && i === s.coords.length - 1) return null;
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
              only on top of the ones drawn before it. They carry `data-marker`
              because that is what they are - each is one series' last point -
              so a one-week season is eight faces on a start line rather than a
              chart with no markers at all.

              They ride the decluttered y rather than the raw one, and where
              those differ a leader runs back to the line. Left on the raw one
              they simply overlap: this season opened with all eight managers
              inside twelve points of each other, which is 120 units of chart
              for 208 units of face. */}
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
                className="lead"
              />
            ) : null
          )}
          {labels.map(({ s, y, x }) =>
            s.style.kart ? (
              <g key={s.manager} data-marker="" data-kart={s.manager}>
                <KartIcon kart={s.style.kart} x={x} y={r(y)} size={ICON} />
              </g>
            ) : null
          )}

          {labels.map(({ s, y, points }) => (
            <g key={s.manager}>
              {/* A sample of the line itself, so the dash pattern is beside
                  the name rather than only out in the plot. */}
              {/* Clear of the driver, which is centred on the last point and
                  so overhangs the plot by half its own width. The sample is
                  still here rather than replaced by a second copy of the face:
                  it carries the dash pattern, which is the half of the key
                  that a face cannot show. */}
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

      {/* The axis does not start at zero, so it has to say so. Everything
          else on this chart is a comparison between managers and survives a
          truncated scale intact; the one reading it breaks is "how big is the
          gap", which is exactly what a reader estimates off the height of the
          gap between two lines. One sentence is cheaper than the alternative,
          which is a chart that quietly doubles every lead. Only rendered when
          it is true - an early-season chart that does start at zero should not
          be apologising for a scale it is not using.

          Hidden from the accessibility tree for the same reason the svg above
          it is: the chart a screen reader gets is the table below, which is
          exact numbers with no scale, no lines and no gaps to misjudge. Read
          out there, this sentence is a caveat about a picture that is not in
          the room. */}
      {base > 0 && (
        <p className="caption" aria-hidden="true">
          The scale starts at {base} rather than zero, so the pack has room to
          spread out. Gaps between lines are differences in points, not
          proportions.
        </p>
      )}

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
