/**
 * The Trends tab: a race chart nobody can read without a screen, and a
 * head-to-head matrix that is the league tiebreaker.
 *
 * Two things are worth testing here and one thing is not. The one that is not
 * is whether the chart looks right - that is a screenshot's job. The two that
 * are:
 *
 * 1. **The hidden table and the drawn line are the same numbers.** A chart
 *    with an alternative text description has two sources of truth by
 *    construction, and the failure mode is that one of them silently stops
 *    tracking the other - which nobody sighted would ever notice, because the
 *    half that broke is the half they cannot see. So the assertion inverts the
 *    plotted geometry back into points and compares it to the table, rather
 *    than checking that both were built from the same variable.
 *
 * 2. **Each pair of cells in the matrix mirrors.** The matrix is 64 cells
 *    derived from one flat list, and a transposed index reads as plausible
 *    from every angle except the one that matters: it would tell a manager
 *    they lost a tiebreaker they won.
 *
 * The rest is the degradation the payload split forces: `headToHead` lives in
 * the lazily fetched `results.json`, so the tab has to open before that file
 * exists, and go on rendering if it never does.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

import { cap } from "../lib/format.mjs";
import { VIEWS, axisFor, raceFrames } from "../lib/race.mjs";
import { KARTS } from "../app/components/Karts";
import { axisOf, GEOM } from "../app/components/TrendsChart";
import { TrendsChart } from "../app/components/TrendsChart";
import { TrendsMatrix } from "../app/components/TrendsMatrix";
import { advance, payload, renderPage, stubFetch } from "./helpers";

const managers: string[] = payload.standings.map((r: any) => r.manager);
const byWeek: any[] = payload.byWeek;

/* The axis is fitted to the data rather than pinned to zero, so the inversion
   needs the floor as well as the top. Both come from the chart's own `axisOf`
   and not from a second copy of the rule: a test that re-derived the range
   here would keep passing after the chart changed how it picks one, and would
   be checking its own arithmetic rather than the drawing. */
const axis = axisOf(
  byWeek.flatMap((w) => Object.values(w.cumulative).map((c: any) => c.points))
);

const plotH = GEOM.H - GEOM.padT - GEOM.padB;

/** A drawn point, turned back into the number it claims to be showing. */
const valueAt = (y: number) =>
  axis.base + ((GEOM.H - GEOM.padB - y) / plotH) * (axis.top - axis.base);

const seriesOf = (root: HTMLElement, manager: string) => {
  const g = root.querySelector(`[data-series="${manager}"]`);
  if (!g) throw new Error(`no plotted series for ${manager}`);
  return (g.getAttribute("data-points") ?? "")
    .split(" ")
    .filter(Boolean)
    .map((p) => p.split(",").map(Number) as [number, number]);
};

/**
 * The same series, but only where a week closes.
 *
 * The line moves game by game now and the hidden table is still weekly - nine
 * hundred game columns is not an accessible table - so the two meet at the
 * week boundaries, and this is the attribute that names them.
 */
const weeksOf = (root: HTMLElement, manager: string) => {
  const g = root.querySelector(`[data-series="${manager}"]`);
  if (!g) throw new Error(`no plotted series for ${manager}`);
  return (g.getAttribute("data-week-points") ?? "")
    .split(" ")
    .filter(Boolean)
    .map((p) => p.split(",").map(Number) as [number, number]);
};

/** The axis the chart fits for a given view, from the chart's own rule. */
const axisOfView = (view: keyof typeof VIEWS, results: any[]) => {
  const { all, frames } = raceFrames(byWeek, results, managers);
  return axisFor(
    frames.flatMap((f) => all.map((m) => VIEWS[view].y(f.totals, m))),
    { floorAtZero: VIEWS[view].floorAtZero }
  );
};

/** A drawn y, turned back into the number the given view claims it shows. */
const invert = (y: number, view: keyof typeof VIEWS, ax: { base: number; top: number }) =>
  VIEWS[view].down
    ? ax.base + ((y - GEOM.padT) / plotH) * (ax.top - ax.base)
    : ax.base + ((GEOM.H - GEOM.padB - y) / plotH) * (ax.top - ax.base);

/** The visually hidden table, as `{ manager: [points per week] }`, gaps kept. */
const hiddenTable = (root: HTMLElement) => {
  const table = within(root).getByRole("table", { name: /points after each week/i });
  const out: Record<string, (number | null)[]> = {};
  for (const row of within(table).getAllByRole("row").slice(1)) {
    const head = within(row).getByRole("rowheader").textContent!.trim();
    out[head] = [...row.querySelectorAll("td")].map((td) => {
      const t = td.textContent!.trim();
      return t === "" || /^[—-]$/.test(t) ? null : Number(t);
    });
  }
  return out;
};

async function openTrends() {
  const view = await renderPage();
  fireEvent.click(screen.getByRole("tab", { name: "Trends" }));
  /* Opening the tab is what asks for results.json, and the answer arrives a
     microtask later. Without this every matrix assertion runs against the
     loading state, which passes the "does not throw" test and nothing else. */
  await advance(0);
  return view;
}

describe("the race chart", () => {
  test("plots every manager at every week, and in between", async () => {
    stubFetch();
    const { container } = await openTrends();
    const root = container as unknown as HTMLElement;

    for (const m of managers) {
      expect(
        weeksOf(root, m).length,
        `${m} should close each of the ${byWeek.length} scored weeks`
      ).toBe(byWeek.length);
    }
    /* And the point of the change: the line says more than the weeks do. A
       week is not a tidy slice of anything - the live season's first bucket
       holds 65 games across ten days - so drawing one dot for it throws away
       every lead change inside it. */
    const drawn = managers.reduce((n, m) => n + seriesOf(root, m).length, 0);
    const weekly = managers.reduce((n, m) => n + weeksOf(root, m).length, 0);
    expect(drawn, "the chart is still only drawing week ends").toBeGreaterThan(weekly);
  });

  test("the hidden table carries the same numbers the lines do", async () => {
    stubFetch();
    const { container } = await openTrends();
    const root = container as unknown as HTMLElement;
    const table = hiddenTable(root);

    for (const m of managers) {
      const drawn = weeksOf(root, m).map(([, y]) => valueAt(y));
      const stated = table[cap(m)];
      expect(stated, `${m} is plotted but missing from the hidden table`).toBeTruthy();

      /* The table may carry gaps the line cannot - a manager absent from an
         early week is a hole in the row and a shorter line, not a zero. */
      const present = stated.filter((v): v is number => v !== null);
      expect(drawn.length, `${m}: ${drawn.length} points against ${present.length} cells`)
        .toBe(present.length);
      /* Three decimal places of slack, because the coordinates are rounded to
         three before they go into the attribute - that is worth about a
         ten-thousandth of a point once inverted, and the numbers being
         compared are whole points, so an off-by-one still fails loudly. */
      drawn.forEach((v, i) => {
        expect(v, `${m}, week ${i + 1}`).toBeCloseTo(present[i], 3);
      });
    }
  });

  test("the drawn line is the same array as the one that was measured", async () => {
    /* data-points is what the assertions above read; the polyline is what a
       reader sees. Nothing stops those diverging except this. */
    stubFetch();
    const { container } = await openTrends();
    for (const g of container.querySelectorAll("[data-series]")) {
      const line = g.querySelector("polyline");
      if (line) expect(line.getAttribute("points")).toBe(g.getAttribute("data-points"));
    }
  });

  test("one week is points, not a trend", () => {
    /* A polyline through a single point draws nothing, so it would not be
       wrong on screen - but a chart that claims a line after one Saturday is
       claiming a direction it cannot know. */
    const one = byWeek.slice(0, 1);
    const { container } = render(<TrendsChart byWeek={one} managers={managers} />);
    expect(container.querySelectorAll("[data-series]").length).toBe(managers.length);
    expect(container.querySelector("polyline"), "no line through one point").toBeNull();
    expect(container.querySelectorAll("[data-marker]").length).toBe(managers.length);
  });

  /** Where a manager's driver is drawn, from the `<image>` box. */
  const driverAt = (root: HTMLElement, manager: string) => {
    const g = root.querySelector(`[data-kart="${manager}"]`);
    if (!g) throw new Error(`no driver for ${manager}`);
    const img = g.querySelector("image")!;
    const n = (a: string) => Number(img.getAttribute(a));
    return {
      x: n("x") + n("width") / 2,
      y: n("y") + n("height") / 2,
      size: n("width"),
      href: img.getAttribute("href")!,
    };
  };

  test("every manager's line ends in their own driver", async () => {
    /* What makes it a race rather than a chart. The face is on the end of the
       line horizontally - it moves along with the season rather than sitting
       pinned in the gutter, which would be a legend with a picture in it. */
    stubFetch();
    const { container } = await openTrends();
    const root = container as unknown as HTMLElement;

    for (const m of managers) {
      const [x] = seriesOf(root, m).slice(-1)[0];
      const d = driverAt(root, m);
      expect(d.x, `${m}'s driver is not at the end of their line`).toBeCloseTo(x, 3);
      expect(d.href, `${m} is drawn as somebody else`).toBe(`/karts/${KARTS[m].file}.png`);
    }
  });

  test("a driver nudged off its own line is tied back to it", async () => {
    /* Faces are 26 units across and this league opened with all eight managers
       inside twelve points of each other, so they have to be pushed apart or
       they are one pile. A face that has moved is then making a claim about a
       total it is not standing next to, and the leader is what stops that
       being silent. */
    stubFetch();
    const { container } = await openTrends();
    const root = container as unknown as HTMLElement;
    const leaders = [...root.querySelectorAll("line.lead")];

    let nudged = 0;
    for (const m of managers) {
      const [x, y] = seriesOf(root, m).slice(-1)[0];
      const d = driverAt(root, m);
      if (Math.abs(d.y - y) <= 1) continue;
      nudged++;
      const tie = leaders.find(
        (l) =>
          Math.abs(Number(l.getAttribute("x1")) - x) < 0.01 &&
          Math.abs(Number(l.getAttribute("y1")) - y) < 0.01 &&
          Math.abs(Number(l.getAttribute("y2")) - d.y) < 0.01
      );
      expect(tie, `${m}'s driver moved ${(d.y - y).toFixed(1)} units with no leader`).toBeTruthy();
    }
    expect(nudged, "nothing was nudged, so this test measured nothing")
      .toBeGreaterThan(0);
  });

  test("no two drivers overlap", async () => {
    /* The reason the gap is the height of a face rather than the height of a
       name. Two names a few units apart are two names; two faces a few units
       apart are a pile with one face in it. */
    stubFetch();
    const { container } = await openTrends();
    const root = container as unknown as HTMLElement;
    const placed = managers
      .map((m) => ({ m, ...driverAt(root, m) }))
      .sort((a, b) => a.y - b.y);
    for (let i = 1; i < placed.length; i++) {
      const gap = placed[i].y - placed[i - 1].y;
      expect(gap, `${placed[i - 1].m} and ${placed[i].m} are ${gap} apart`)
        .toBeGreaterThanOrEqual(placed[i].size);
    }
  });

  test("a window is where the fitted floor still earns its keep", () => {
    /* Drawing game by game means the season starts at nought, so on the full
       Total points view the fitted floor is nought and the pack is a band -
       the trade the three views and this window exist to answer. Inside the
       window the lowest number on the chart is a long way above zero again,
       and the floor has to follow it or the window buys nothing. */
    const weeks = Array.from({ length: 9 }, (_, i) => ({
      ...byWeek[byWeek.length - 1],
      key: `0|0${i}`,
      label: `Week ${i + 1}`,
      week: i + 1,
      seasonType: "regular",
      cumulative: Object.fromEntries(
        managers.map((m, j) => [m, { points: 10 * (i + 1) + j, wins: 1, losses: 0 }])
      ),
    }));
    const { container } = render(
      <TrendsChart byWeek={weeks} managers={managers} results={[]} />
    );
    const root = container as unknown as HTMLElement;
    /* The floor itself, read back off a gridline rather than guessed: invert
       the lowest label's own y and the axis says where it starts. */
    const lowestTick = () =>
      Math.min(...[...root.querySelectorAll("text.ax.r")].map((t) => Number(t.textContent)));
    const spread = () => {
      const ends = managers.map((m) => seriesOf(root, m).slice(-1)[0][1]);
      return Math.max(...ends) - Math.min(...ends);
    };

    const wholeSeason = { tick: lowestTick(), spread: spread() };
    fireEvent.click(within(root).getByRole("button", { name: /last 4 weeks/i }));

    expect(lowestTick(), "the window did not refit the floor to its own pack")
      .toBeGreaterThan(wholeSeason.tick);
    /* And the payoff: the same eight managers, further apart on the screen. */
    expect(spread(), "the window bought the pack no room")
      .toBeGreaterThan(wholeSeason.spread);
  });

  test("a week's dot is drawn under its own label", async () => {
    /* The fallback draws one dot per week and the label is the middle of the
       week, so a dot on the week boundary sits half a week to the right of
       its own name - and the left of the plot goes blank. */
    const { container } = render(
      <TrendsChart byWeek={byWeek} managers={managers} results={[]} />
    );
    const root = container as unknown as HTMLElement;
    const xs = seriesOf(root, managers[0]).map(([x]) => x);
    const labels = [...root.querySelectorAll("text.ax.mid")].map((t) =>
      Number(t.getAttribute("x"))
    );
    expect(labels.length).toBe(xs.length);
    labels.forEach((lx, i) => expect(lx, `week ${i + 1}`).toBeCloseTo(xs[i], 3));
    /* and the line uses the width it was given rather than starting a quarter
       of the way in */
    expect(xs[0]).toBeCloseTo(GEOM.padL, 3);
  });

  test("the weeks are divided, which is what lets the labels sit in the middle", async () => {
    /* A name centred in a band needs the band drawn, or it just looks half a
       week adrift of the marker beside it. One divider between each pair of
       weeks - not after the last one, where the plot already ends. */
    stubFetch();
    const { container } = await openTrends();
    const root = container as unknown as HTMLElement;
    const rules = [...root.querySelectorAll("line.wk")];
    expect(rules.length, "one divider between each pair of weeks")
      .toBe(byWeek.length - 1);
    /* vertical, and spanning the plot rather than floating in it */
    for (const l of rules) {
      expect(l.getAttribute("x1")).toBe(l.getAttribute("x2"));
      expect(Number(l.getAttribute("y1"))).toBe(GEOM.padT);
      expect(Number(l.getAttribute("y2"))).toBe(GEOM.H - GEOM.padB);
    }
    /* each one between the labels it separates */
    const labels = [...root.querySelectorAll("text.ax.mid")].map((t) =>
      Number(t.getAttribute("x"))
    );
    rules.forEach((l, i) => {
      const x = Number(l.getAttribute("x1"));
      expect(x, `divider ${i} is not after week ${i + 1}`).toBeGreaterThan(labels[i]);
      expect(x, `divider ${i} is not before week ${i + 2}`).toBeLessThan(labels[i + 1]);
    });
  });

  test("a pack nowhere near zero gets the plot to itself", () => {
    /* The reason the axis is fitted rather than pinned to zero, and the case
       the golden fixture cannot make: four of its managers are on nought, so
       the fitted floor and the zero floor are the same number and this whole
       branch goes untested. These are the real totals from the second
       Saturday of 2026 - eight managers inside twelve points, all of them a
       long way above zero, which on a zero-based axis was one band in the top
       half with every driver shoved off its own line. */
    const totals: Record<string, number> = {
      adam: 24, charlie: 22, devish: 21, tconn: 18,
      nathan: 17, steve: 16, leandro: 15, clint: 13,
    };
    const names = Object.keys(totals);
    const weeks = byWeek.slice(0, 2).map((w, i) => ({
      ...w,
      cumulative: Object.fromEntries(
        names.map((m) => [m, { points: totals[m] - (i === 0 ? 1 : 0), wins: 1, losses: 0 }])
      ),
    }));
    const { container } = render(<TrendsChart byWeek={weeks} managers={names} />);
    const root = container as unknown as HTMLElement;

    /* Gridlines sit on round multiples inside the axis, so the lowest of them
       is at or above the floor rather than on it - which is enough to say the
       axis is no longer pinned to zero. */
    const lowest = Math.min(
      ...[...root.querySelectorAll("text.ax.r")].map((t) => Number(t.textContent))
    );
    expect(lowest, "the axis is still pinned to zero").toBeGreaterThan(0);

    /* And the payoff: with the plot spent on the spread, every face is
       standing on the end of its own line rather than in a column beside it. */
    for (const m of names) {
      const [, y] = seriesOf(root, m).slice(-1)[0];
      const moved = Math.abs(driverAt(root, m).y - y);
      expect(moved, `${m} was still nudged ${moved.toFixed(1)} units`).toBeLessThanOrEqual(1);
    }
  });

  test("gridlines are drawn where their own labels say they are", () => {
    /* A fitted axis rarely divides into four round numbers, and the failure
       is silent: a line drawn at 17.5 under a label reading 18 is a ruler
       that is wrong by half a point everywhere. The labels are rounded, so
       the lines have to move to them rather than the other way round. */
    const { container } = render(<TrendsChart byWeek={byWeek} managers={managers} />);
    const root = container as unknown as HTMLElement;
    const rows = [...root.querySelectorAll("text.ax.r")];
    expect(rows.length).toBeGreaterThan(1);
    for (const t of rows) {
      const stated = Number(t.textContent);
      expect(Number.isInteger(stated), `gridline labelled ${t.textContent}`).toBe(true);
      /* the label is offset three units below its own line - see the chart */
      expect(valueAt(Number(t.getAttribute("y")) - 3)).toBeCloseTo(stated, 3);
    }
  });

  test("every week still has a marker, driver or not", async () => {
    /* The driver replaces the last marker rather than sitting on top of one,
       so the count is the thing to hold: one per week, however it is drawn.
       Per week and not per game on purpose - at sixty-five games a Saturday
       the markers are a solid bar, and the week is the tick a reader counts
       in anyway. */
    stubFetch();
    const { container } = await openTrends();
    const root = container as unknown as HTMLElement;
    const weekly = managers.reduce((n, m) => n + weeksOf(root, m).length, 0);
    expect(root.querySelectorAll("[data-marker]").length).toBe(weekly);
  });

  /* ------------------------------------------------------------------ */
  /* the three views, the window, and the filter                          */
  /* ------------------------------------------------------------------ */

  const press = (root: HTMLElement, name: string) =>
    fireEvent.click(within(root).getByRole("button", { name }));

  test("each view draws what it says it is measuring", async () => {
    /* The three are lenses on one set of numbers, and the hidden table prints
       those numbers whichever is on. So the table is the fixed point: derive
       the view from it and the drawn line has to land on the answer. */
    stubFetch();
    const { container } = await openTrends();
    const root = container as unknown as HTMLElement;
    const table = hiddenTable(root);

    for (const view of ["points", "gap", "avg"] as const) {
      press(root, VIEWS[view].label);
      const ax = axisOfView(view, payload.results);
      /* the totals the table states at the end of the season */
      const totals = Object.fromEntries(
        managers.map((m) => [m, table[cap(m)].filter((v) => v !== null).at(-1)!])
      );
      for (const m of managers) {
        const drawn = invert(weeksOf(root, m).at(-1)![1], view, ax);
        expect(drawn, `${m} on the ${view} view`).toBeCloseTo(VIEWS[view].y(totals, m), 2);
      }
    }
  });

  test("behind-leader puts the leader on nought and nobody above them", async () => {
    stubFetch();
    const { container } = await openTrends();
    const root = container as unknown as HTMLElement;
    press(root, "Behind leader");

    const ax = axisOfView("gap", payload.results);
    const ends = managers.map((m) => invert(weeksOf(root, m).at(-1)![1], "gap", ax));
    expect(Math.min(...ends), "nobody is the leader").toBeCloseTo(0, 3);
    for (const v of ends) expect(v, "somebody is ahead of the leader").toBeGreaterThan(-0.01);
    /* and the gutter says so in words rather than as a nought */
    expect(within(root).getByText("leader")).toBeTruthy();
  });

  test("the average view is centred on nothing", async () => {
    stubFetch();
    const { container } = await openTrends();
    const root = container as unknown as HTMLElement;
    press(root, "vs Average");

    const ax = axisOfView("avg", payload.results);
    const ends = managers.map((m) => invert(weeksOf(root, m).at(-1)![1], "avg", ax));
    expect(ends.reduce((a, b) => a + b, 0), "the deviations do not cancel").toBeCloseTo(0, 1);
    expect(Math.min(...ends), "nobody is below average").toBeLessThan(0);
    expect(Math.max(...ends), "nobody is above average").toBeGreaterThan(0);
  });

  test("the hidden table stays weekly totals, and says which view is drawn", async () => {
    /* Switching view must not move the furniture under somebody halfway
       through navigating the table - and totals are the one set of numbers
       every view can be derived from. */
    stubFetch();
    const { container } = await openTrends();
    const root = container as unknown as HTMLElement;
    const before = hiddenTable(root);

    press(root, "Behind leader");
    expect(hiddenTable(root)).toEqual(before);
    expect(
      within(root).getByRole("table", { name: /drawn as behind leader/i }),
      "the table does not say what the chart is showing"
    ).toBeTruthy();
  });

  test("filtering dims the others without moving the chart", async () => {
    /* The point of picking your own kart out is seeing it against the pack.
       A filter that rescaled the axis would answer a different question, and
       the one thing you could not then do is compare yourself to what you
       just hid. */
    stubFetch();
    const { container } = await openTrends();
    const root = container as unknown as HTMLElement;
    const mine = managers[0];
    const before = seriesOf(root, mine).at(-1)!;

    press(root, "All managers");
    fireEvent.click(within(root).getByRole("checkbox", { name: cap(mine) }));

    expect(seriesOf(root, mine).at(-1), "the axis moved").toEqual(before);
    const off = [...root.querySelectorAll("[data-series]")].filter((g) =>
      g.classList.contains("off")
    );
    expect(off.length, "the rest of the pack did not dim").toBe(managers.length - 1);
    expect(
      off.some((g) => g.getAttribute("data-series") === mine),
      "dimmed the manager that was picked"
    ).toBe(false);
    /* Dimmed, not dropped: every name and number is still on the chart. */
    expect(root.querySelectorAll("[data-series]").length).toBe(managers.length);
  });

  test("there is no window button until there is a season to cut down", () => {
    /* The league spends the first month of every year on too few weeks for
       "last four" to mean anything, and it is there now, on one scored week.
       A control that silently does nothing is worse than no control. */
    const short = render(
      <TrendsChart byWeek={byWeek.slice(0, 1)} managers={managers} results={[]} />
    );
    expect(short.queryByRole("button", { name: /last 4 weeks/i })).toBeNull();

    const long = render(
      <TrendsChart
        byWeek={Array.from({ length: 9 }, (_, i) => ({
          ...byWeek[byWeek.length - 1],
          key: `0|0${i}`,
          label: `Week ${i + 1}`,
          week: i + 1,
          seasonType: "regular",
        }))}
        managers={managers}
        results={[]}
      />
    );
    expect(long.getByRole("button", { name: /last 4 weeks/i })).toBeTruthy();
  });

  test("the window shortens the season without changing the totals", async () => {
    stubFetch();
    const weeks = Array.from({ length: 9 }, (_, i) => ({
      ...byWeek[byWeek.length - 1],
      key: `0|0${i}`,
      label: `Week ${i + 1}`,
      week: i + 1,
      seasonType: "regular",
      cumulative: Object.fromEntries(
        managers.map((m, j) => [m, { points: (i + 1) * (j + 2), wins: 1, losses: 0 }])
      ),
    }));
    const { container } = render(
      <TrendsChart byWeek={weeks} managers={managers} results={[]} />
    );
    const root = container as unknown as HTMLElement;
    const full = hiddenTable(root);

    fireEvent.click(within(root).getByRole("button", { name: /last 4 weeks/i }));
    /* Fewer columns on the chart, every column still in the table: the window
       is what is drawn, not what is known. */
    const labels = [...root.querySelectorAll("text.ax.mid")].map((t) => t.textContent);
    expect(labels.length).toBeLessThan(weeks.length);
    expect(hiddenTable(root), "the window rewrote the season").toEqual(full);
  });

  test("a crowded chart keeps every name apart and inside the plot", () => {
    /* The gap used to be a fixed 28 units - the height of a face - which fits
       eight managers and not twelve. Past that the declutter clamped the
       surplus onto the top of the plot and drew three names on one coordinate.
       Sixteen managers all level on points is the worst case there is. */
    const many = Array.from({ length: 16 }, (_, i) => `m${String(i).padStart(2, "0")}`);
    const weeks = byWeek.map((w) => ({
      ...w,
      cumulative: Object.fromEntries(many.map((m) => [m, { points: 5, wins: 1, losses: 0 }])),
    }));
    const { container } = render(<TrendsChart byWeek={weeks} managers={many} />);
    const root = container as unknown as HTMLElement;

    const ys = [...root.querySelectorAll("text.nm")]
      .map((t) => Number(t.getAttribute("y")))
      .sort((a, b) => a - b);
    expect(ys.length).toBe(many.length);
    for (let i = 1; i < ys.length; i++) {
      expect(ys[i] - ys[i - 1], `two names ${ys[i] - ys[i - 1]} units apart`)
        .toBeGreaterThan(0);
    }
    /* And still on the chart. The svg is overflow:visible, so a name pushed
       past either end is not clipped - it is painted over the prose. */
    expect(ys[0]).toBeGreaterThanOrEqual(GEOM.padT);
    expect(ys[ys.length - 1]).toBeLessThanOrEqual(GEOM.H - GEOM.padB + 4);
  });

  test("a manager named after an Object.prototype key does not take the tab down", () => {
    /* `KARTS[manager]` on a plain object returns Object.prototype.constructor
       for a manager called "constructor" - truthy, not a Kart - which skipped
       the fallback, left the marker undefined and threw out of the render.
       The names come off a payload fetched over the network. */
    const odd = ["constructor", "toString", "valueOf"];
    const weeks = byWeek.map((w) => ({
      ...w,
      cumulative: { ...w.cumulative, ...Object.fromEntries(odd.map((m) => [m, { points: 3, wins: 1, losses: 1 }])) },
    }));
    const { container } = render(
      <TrendsChart byWeek={weeks} managers={[...managers, ...odd]} />
    );
    const root = container as unknown as HTMLElement;
    for (const m of odd) {
      expect(seriesOf(root, m).length, `${m} was dropped`).toBe(byWeek.length);
      expect(root.querySelector(`[data-kart="${m}"]`), `${m} was given a driver`).toBeNull();
    }
  });

  test("a manager with no driver still gets a line", () => {
    /* The draft changes and this file does not. An unknown name should cost a
       plain line off the old token palette, not a crash and not a gap. */
    const late = "newcomer";
    expect(KARTS[late]).toBeUndefined();
    const weeks = byWeek.map((w) => ({
      ...w,
      cumulative: { ...w.cumulative, [late]: { points: 4, wins: 2, losses: 0 } },
    }));
    const { container } = render(
      <TrendsChart byWeek={weeks} managers={[...managers, late]} />
    );
    const root = container as unknown as HTMLElement;
    expect(seriesOf(root, late).length).toBe(byWeek.length);
    expect(root.querySelector(`[data-kart="${late}"]`), "invented a driver").toBeNull();
    /* Twice over: once in the gutter and once in the hidden table, which is
       the pair every other name on this chart appears as. */
    expect(within(root).getAllByText(cap(late)).length).toBe(2);
  });

  test("zero weeks says so rather than dividing by nothing", () => {
    const { container } = render(<TrendsChart byWeek={[]} managers={managers} />);
    expect(container.querySelector("svg"), "nothing to draw").toBeNull();
    expect(screen.getByText(/no week/i)).toBeTruthy();
  });

  test("a manager who joined the payload late starts where they appear", () => {
    /* The bot has written weeks that predate a manager being in the league,
       and a backfilled zero is a claim - it says they played and scored
       nothing. The line starts at their first week instead. */
    const late = "newcomer";
    const weeks = byWeek.map((w, i) => ({
      ...w,
      cumulative: i === 0 ? w.cumulative : { ...w.cumulative, [late]: { points: 4, wins: 2, losses: 0 } },
    }));
    const { container } = render(
      <TrendsChart byWeek={weeks} managers={[...managers, late]} />
    );
    const root = container as unknown as HTMLElement;
    expect(seriesOf(root, late).length).toBe(byWeek.length - 1);
    expect(hiddenTable(root)[cap(late)][0], "the week before they existed is a gap").toBeNull();
  });
});

describe("the drivers' art", () => {
  test("every driver names a file that is actually there", () => {
    /* A missing PNG is not a crash and not a warning: it is an empty square at
       the head of somebody's line, on a tab nobody opens every visit. The file
       names are also the one thing `scripts/build-karts.mjs` and this component
       have to agree about, and they are agreed by hand. */
    for (const [manager, kart] of Object.entries(KARTS)) {
      const file = join(process.cwd(), "public/karts", `${kart.file}.png`);
      expect(existsSync(file), `${manager} is ${kart.driver}, and ${file} is missing`)
        .toBe(true);
    }
  });

  test("every manager in the roster has a driver", () => {
    /* The fallback keeps an unknown name on the chart, but silently: a manager
       who joins and never gets a face would go unnoticed until somebody asked
       why their line was grey. */
    for (const m of managers) {
      expect(KARTS[m], `${m} has no driver`).toBeTruthy();
    }
  });

  test("no two managers drive the same character", () => {
    const files = Object.values(KARTS).map((k) => k.file);
    expect(new Set(files).size).toBe(files.length);
  });
});

describe("the head-to-head matrix", () => {
  const grid = (root: HTMLElement) => {
    const table = within(root).getByRole("table", { name: /head to head/i });
    const rows = within(table).getAllByRole("row");
    const cols = within(rows[0]).getAllByRole("columnheader").slice(1).map((th) => th.textContent!.trim());
    const cells: Record<string, Record<string, string>> = {};
    for (const row of rows.slice(1)) {
      const head = within(row).getByRole("rowheader").textContent!.trim();
      cells[head] = {};
      [...row.querySelectorAll("td")].forEach((td, i) => {
        cells[head][cols[i]] = td.textContent!.trim();
      });
    }
    return { cols, cells };
  };

  test("every pair of cells is a mirror image", async () => {
    stubFetch();
    const { container } = await openTrends();
    const { cols, cells } = grid(container as unknown as HTMLElement);

    for (const a of cols) {
      for (const b of cols) {
        if (a === b) continue;
        const there = cells[a][b];
        const back = cells[b][a];
        if (there === "—") {
          expect(back, `${a} v ${b} is empty one way and not the other`).toBe("—");
          continue;
        }
        const [w, l] = there.split("-");
        expect(back, `${a} beat ${b} ${there}, so ${b} v ${a} must read ${l}-${w}`).toBe(`${l}-${w}`);
      }
    }
  });

  test("the diagonal is own goals and nothing else", async () => {
    stubFetch();
    const { container } = await openTrends();
    const { cols, cells } = grid(container as unknown as HTMLElement);

    const own: Record<string, number> = {};
    for (const h of payload.headToHead) {
      if (h.sameManager) own[cap(h.winner.manager)] = (own[cap(h.winner.manager)] ?? 0) + 1;
    }
    /* The fixture has one: Adam's North Dakota State beat Adam's
       Jacksonville State. A manager's own two teams meeting is the only way a
       cell on the diagonal can be anything but empty. */
    expect(Object.keys(own).length).toBeGreaterThan(0);

    for (const m of cols) {
      const n = own[m] ?? 0;
      expect(cells[m][m], `${m}'s own cell`).toBe(n === 0 ? "—" : String(n));
    }
  });

  test("counts a real record off the fixture", async () => {
    stubFetch();
    const { cells } = grid((await openTrends()).container as unknown as HTMLElement);
    /* Devish beat Clint once and Clint has never beaten Devish. */
    expect(cells.Devish.Clint).toBe("1-0");
    /* Nathan and Tconn have beaten each other once each - the case where a
       transposed index would look entirely reasonable. */
    expect(cells.Nathan.Tconn).toBe("1-1");
  });

  test("scrolls inside its own container rather than widening the page", async () => {
    stubFetch();
    const { container } = await openTrends();
    const scroller = container.querySelector(".mx");
    expect(scroller, "the matrix needs a scroll container of its own").not.toBeNull();
    /* Keyboard readers cannot scroll a region they cannot focus, and a table
       that only opens with a swipe is a table half the league cannot read. */
    expect(scroller!.getAttribute("tabindex")).toBe("0");
    expect(scroller!.getAttribute("role")).toBe("region");
    expect(scroller!.getAttribute("aria-label")).toBeTruthy();
  });
});

describe("results.json never arriving", () => {
  test("renders the chart and an explanation, and does not throw", async () => {
    /* The entire cutover window, and any raw.githubusercontent outage after
       it. The chart is core-file data so it must still be there; the matrix
       is not, so it has to say why it is not rather than show an 8x8 grid of
       dashes that reads as "nobody has played anybody". */
    stubFetch({ missing: ["results"] });
    const { container } = await openTrends();
    expect(await screen.findByText(/did not load/)).toBeTruthy();
    expect(container.querySelectorAll("[data-series]").length).toBe(managers.length);
    expect(within(container as unknown as HTMLElement).queryByRole("table", { name: /head to head/i }))
      .toBeNull();
  });

  test("an empty payload is a sentence, not an empty grid", () => {
    render(<TrendsMatrix games={[]} managers={managers} note={null} />);
    expect(screen.getByText(/no game between two drafted teams/i)).toBeTruthy();
  });
});
