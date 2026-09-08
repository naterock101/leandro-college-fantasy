import { useMemo } from "react";

import { cap } from "../../lib/format.mjs";
import type { Data } from "../types";

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
   silently stops the test measuring anything. */
export const GEOM = { W: 460, H: 280, padL: 30, padR: 124, padT: 14, padB: 26 };

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
 * Eight series that stay apart without hue doing the work.
 *
 * Four colours, each used twice, and the two that share a colour differ in
 * both stroke pattern and marker shape - so no two series match on all three
 * of colour, dash and marker. The four colours are also four distinct
 * lightnesses (0.85, 0.47, 0.37, 0.26 relative luminance), which is what
 * keeps them apart in greyscale and under the red-green confusions; the
 * end-of-line label is what makes the question moot for a reader who cannot
 * separate two of them at all.
 *
 * Rejected: eight hues. Eight distinguishable hues do not exist on a dark
 * ground for a deuteranope, and generating them from a colour wheel would
 * also abandon the tokens, so half of them would fail the contrast audit the
 * labels have to pass.
 */
const IN = ["var(--amber)", "var(--teal)", "var(--chalk)", "var(--red)"];
const DASH = ["none", "6 4"];

const styleFor = (i: number) => ({
  stroke: IN[i % IN.length],
  dash: DASH[Math.floor(i / IN.length) % DASH.length],
  /* filled circle against hollow square: different silhouette and different
     weight, so the pair reads apart at four pixels across */
  square: Math.floor(i / IN.length) % DASH.length === 1,
});

const shortLabel = (w: Data["byWeek"][number]) =>
  w.seasonType === "postseason" ? `P${w.week}` : `W${w.week}`;

type Series = {
  manager: string;
  /* one entry per week, null before the manager appears in the payload */
  values: (number | null)[];
  coords: [number, number][];
  style: ReturnType<typeof styleFor>;
};

/** Where a value sits vertically, given the top of the axis. */
const yAt = (v: number, top: number) => GEOM.H - GEOM.padB - (v / top) * plotH;

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

    /* The axis tops out at the leader's actual total rather than a rounded-up
       ceiling: rounding puts the leading line short of the top of the plot,
       which reads as everyone having further to go than they do. The floor of
       1 is only there so a league where nobody has scored still divides. */
    const top = Math.max(
      1,
      ...byWeek.flatMap((w) => Object.values(w.cumulative ?? {}).map((c) => c.points))
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
              .map(([v, x]) => [r(xAt(x, byWeek.length)), r(yAt(v as number, top))]);
      return { manager, values, coords, style: styleFor(i) };
    });

    /* Names stack up wherever two managers are level, which after one week is
       most of them. Push them apart from the top down, then lift the whole
       column if it has run off the bottom; the label may end up a few pixels
       off its line, which is what the matching colour and dash are for. */
    const GAP = 17;
    const labels = series
      .filter((s) => s.coords.length)
      .map((s) => ({
        s,
        y: s.coords[s.coords.length - 1][1],
        /* the total the name is standing next to, so the gutter answers "how
           many" as well as "who" and the chart needs no hover */
        points: s.values.filter((v): v is number => v !== null).slice(-1)[0],
      }))
      .sort((a, b) => a.y - b.y);
    let prev = -Infinity;
    for (const l of labels) l.y = prev = Math.max(l.y, prev + GAP);
    const overflow = labels.length
      ? labels[labels.length - 1].y - (GEOM.H - GEOM.padB)
      : 0;
    if (overflow > 0) for (const l of labels) l.y -= overflow;

    return { all, top, series, labels, weeks: byWeek };
  }, [byWeek, managers]);

  if (!byWeek.length) {
    return (
      <p className="caption">
        No week has been scored yet, so there is nothing to chart. The race
        appears as soon as the first Saturday is in.
      </p>
    );
  }

  const { top, series, labels, weeks } = model;
  /* Five gridlines including both ends: enough to read a value off without
     drawing a ruler through eight lines. */
  const ticks = [0, 1, 2, 3, 4].map((k) => (top * k) / 4);
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
          {ticks.map((v, i) => (
            <g key={i}>
              <line
                x1={GEOM.padL}
                x2={gutter}
                y1={r(yAt(v, top))}
                y2={r(yAt(v, top))}
                className="grid"
              />
              <text x={GEOM.padL - 6} y={r(yAt(v, top)) + 3} className="ax r">
                {Math.round(v)}
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
                {s.coords.map(([x, y], i) =>
                  s.style.square ? (
                    <rect
                      key={i}
                      data-marker=""
                      x={r(x - 3)}
                      y={r(y - 3)}
                      width="6"
                      height="6"
                      fill="var(--ink)"
                      stroke={s.style.stroke}
                      strokeWidth="1.6"
                    />
                  ) : (
                    <circle key={i} data-marker="" cx={x} cy={y} r="3.2" fill={s.style.stroke} />
                  )
                )}
              </g>
            );
          })}

          {labels.map(({ s, y, points }) => (
            <g key={s.manager}>
              {/* A sample of the line itself, so the dash pattern is beside
                  the name rather than only out in the plot. */}
              <line
                x1={gutter + 5}
                x2={gutter + 21}
                y1={r(y)}
                y2={r(y)}
                stroke={s.style.stroke}
                strokeDasharray={s.style.dash}
                strokeWidth="2"
              />
              <text x={gutter + 25} y={r(y) + 4} className="nm" fill={s.style.stroke}>
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
    .race .nmp{font-family:ui-monospace,Menlo,monospace;font-size:13px;font-weight:400}
    /* Off the screen but in the accessibility tree, which display:none and
       visibility:hidden are both the wrong side of. The 1px box with a clip on
       it is the standard trick and the reason it is not simply width:0 is that
       some readers skip a zero-sized box entirely. */
    .vh{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;
      clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;border:0}
`;
