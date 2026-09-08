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

import { describe, expect, test } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

import { cap } from "../lib/format.mjs";
import { GEOM } from "../app/components/TrendsChart";
import { TrendsChart } from "../app/components/TrendsChart";
import { TrendsMatrix } from "../app/components/TrendsMatrix";
import { payload, renderPage, stubFetch } from "./helpers";

const managers: string[] = payload.standings.map((r: any) => r.manager);
const byWeek: any[] = payload.byWeek;

/* The top of the y axis is the leader's running total, so the inversion below
   needs no knowledge of any rounding rule - there is deliberately not one. */
const topOfAxis = Math.max(
  1,
  ...byWeek.flatMap((w) => Object.values(w.cumulative).map((c: any) => c.points))
);

const plotH = GEOM.H - GEOM.padT - GEOM.padB;

/** A drawn point, turned back into the number it claims to be showing. */
const valueAt = (y: number) => ((GEOM.H - GEOM.padB - y) / plotH) * topOfAxis;

const seriesOf = (root: HTMLElement, manager: string) => {
  const g = root.querySelector(`[data-series="${manager}"]`);
  if (!g) throw new Error(`no plotted series for ${manager}`);
  return (g.getAttribute("data-points") ?? "")
    .split(" ")
    .filter(Boolean)
    .map((p) => p.split(",").map(Number) as [number, number]);
};

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
  return view;
}

describe("the race chart", () => {
  test("plots every manager across every week", async () => {
    stubFetch();
    const { container } = await openTrends();

    for (const m of managers) {
      expect(
        seriesOf(container as unknown as HTMLElement, m).length,
        `${m} should have a point in each of the ${byWeek.length} scored weeks`
      ).toBe(byWeek.length);
    }
  });

  test("the hidden table carries the same numbers the lines do", async () => {
    stubFetch();
    const { container } = await openTrends();
    const root = container as unknown as HTMLElement;
    const table = hiddenTable(root);

    for (const m of managers) {
      const drawn = seriesOf(root, m).map(([, y]) => valueAt(y));
      const stated = table[cap(m)];
      expect(stated, `${m} is plotted but missing from the hidden table`).toBeTruthy();

      /* The table may carry gaps the line cannot - a manager absent from an
         early week is a hole in the row and a shorter line, not a zero. */
      const present = stated.filter((v): v is number => v !== null);
      expect(drawn.length, `${m}: ${drawn.length} points against ${present.length} cells`)
        .toBe(present.length);
      drawn.forEach((v, i) => {
        expect(v, `${m}, week ${i + 1}`).toBeCloseTo(present[i], 6);
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
