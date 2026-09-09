/**
 * The leaderboard's two records, and the window between them.
 *
 * Both columns accumulate, and both are read out of the same week. Act W-L is
 * every settled game up to the week on screen; Exp W-L is what the closing
 * lines expected of week 1, plus week 2, and so on to that same week - over
 * whichever of those games carried a line, which may or may not be all of them
 * (the fixture leaves eight unpriced, the live season currently leaves none).
 *
 * What is worth testing:
 *
 * 1. **It really accumulates.** Week 2 is week 1 plus week 2, not week 2 on its
 *    own. A column that silently showed one week's expectation against a
 *    season's record would look entirely plausible and be nonsense.
 * 2. **It follows the week strip.** Both records move together; neither is
 *    pinned to a season-level figure that is right in one view only.
 * 3. **The column disappears rather than inventing numbers.** The expectation
 *    postdates the rest of `byWeek`, so a browser holding this JS can be handed
 *    weeks that have cumulative totals and none of it. The failure that reads
 *    as plausible is `undefined-undefined`, or worse `0-0`, which says
 *    "expected to have played nothing" in the words of "we cannot say".
 * 4. **The footnote states the true denominator.** Announcing a mismatch when
 *    every settled game was priced is wrong in the same way, and just as
 *    loudly, as hiding a real one.
 */

import { describe, expect, test } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";

import { expStep, Leaderboard } from "../app/components/Leaderboard";
import { ViewState } from "../app/hooks/useViewState";
import type { Data } from "../app/types";
import { payload, renderPage, stubFetch } from "./helpers";
import { render } from "@testing-library/react";

const data = payload as unknown as Data;

const board = (d: Data) =>
  render(
    <ViewState>
      <Leaderboard data={d} />
    </ViewState>
  );

/** The header cells, in the order the table declares them. */
const headers = (root: HTMLElement) =>
  within(within(root).getAllByRole("table")[0])
    .getAllByRole("columnheader")
    .map((th) => th.textContent!.trim());

/** One manager's row, as `{ header: text }`.
 *  Scoped to the leaderboard's own table: on the full page a manager's name
 *  also appears in games of the week, and an unscoped lookup finds both. */
const row = (root: HTMLElement, manager: string) => {
  const cols = headers(root);
  const table = within(root).getAllByRole("table")[0];
  const cell = within(table).getByText(manager).closest("tr")!;
  const out: Record<string, string> = {};
  [...cell.querySelectorAll("td")].forEach((td, i) => {
    out[cols[i]] = td.textContent!.trim();
  });
  return out;
};

describe("the two records", () => {
  test("sit in the order the league reads them, with points first", () => {
    const { container } = board(data);
    expect(headers(container as unknown as HTMLElement)).toEqual([
      "#", "Manager", "Pts", "Act W-L", "Exp W-L*", "Proj", "Left", "Ceil",
    ]);
  });

  /** The expectation the payload carries for a manager at the end of a week. */
  const weekly = (i: number, manager: string) =>
    data.byWeek[i].cumulative[manager] as {
      points: number; wins: number; losses: number;
      expectedWins: number; expectedLosses: number; priced: number; pricedWins: number;
    };

  const lastWeek = data.byWeek.length - 1;

  test("Act W-L is the season's record and Exp W-L is the accumulated expectation", () => {
    const root = board(data).container as unknown as HTMLElement;
    /* Devish is 4-1 across every settled game and the lines expected 1.5-1.5
       from the three of them the books priced, which is exactly the gap this
       column has to survive: an expectation over fewer games than the record
       beside it. */
    const r = row(root, "Devish");
    const standings = data.standings.find((s) => s.manager === "devish")!;
    const c = weekly(lastWeek, "devish");

    expect(r["Act W-L"]).toBe(`${standings.wins}-${standings.losses}`);
    expect(r["Exp W-L*"]).toBe(`${c.expectedWins}-${c.expectedLosses}`);
    expect(c.priced, "the fixture stopped exercising the gap")
      .toBeLessThan(standings.wins + standings.losses);
  });

  test("the live board reads the last week, which is the season to date", () => {
    /* The one thing that lets a single per-week figure serve both views. If
       byWeek ever stopped ending at the season's totals, the live board would
       quietly show a stale expectation against a current record. */
    for (const s of data.standings) {
      const c = weekly(lastWeek, s.manager);
      expect(c.wins, `${s.manager}'s wins`).toBe(s.wins);
      expect(c.losses, `${s.manager}'s losses`).toBe(s.losses);
      expect(c.points, `${s.manager}'s points`).toBe(s.points);
    }
  });

  test("it accumulates rather than showing one week on its own", () => {
    /* The failure that would look entirely plausible: week 2 showing week 2's
       expectation against week 2's cumulative record. Every week's expectation
       has to be at least the week before's, and somewhere it has to grow. */
    let grew = false;
    for (const m of data.standings.map((s) => s.manager)) {
      for (let i = 1; i <= lastWeek; i++) {
        const prev = weekly(i - 1, m);
        const now = weekly(i, m);
        if (!prev || !now) continue;
        expect(now.expectedWins, `${m} went backwards at week ${i}`)
          .toBeGreaterThanOrEqual(prev.expectedWins);
        expect(now.priced, `${m}'s denominator shrank at week ${i}`)
          .toBeGreaterThanOrEqual(prev.priced);
        if (now.priced > prev.priced) grew = true;
      }
    }
    expect(grew, "no manager's expectation grew, so this measured nothing").toBe(true);
  });

  test("and the published pair always adds back to its own denominator", () => {
    /* Rounding a running total is how a twelve-week column comes to say
       1.5-1.6 of three games. The losses are derived from the published wins
       for exactly this reason. */
    for (const w of data.byWeek) {
      for (const [m, c] of Object.entries(w.cumulative)) {
        const rec = c as { expectedWins: number; expectedLosses: number; priced: number };
        expect(Math.round((rec.expectedWins + rec.expectedLosses) * 10) / 10,
          `${m} at ${w.label}`).toBe(rec.priced);
      }
    }
  });

  test("the colour compares like with like when games went unpriced", () => {
    /* Clint is 0-3 over the season and 0-1 over the one game that carried a
       line, against 0.2 expected. That is a fifth of a win off the market:
       level, and it should carry no colour at all.

       The version that derived his priced wins from the season record scored
       him at -2.2 - it counted his two unpriced games as wins he had failed to
       have - and painted him the coldest row on the board. So the assertion is
       "no colour", and what it is guarding is the two full steps of red the
       arithmetic used to invent. */
    const root = board(data).container as unknown as HTMLElement;
    const c = weekly(lastWeek, "clint");
    expect(c.priced, "the fixture stopped exercising this").toBe(1);
    expect(c.pricedWins).toBe(0);

    const played = c.wins + c.losses;
    expect(expStep(c.pricedWins - c.expectedWins), "clint is level").toBe(0);
    expect(expStep(c.wins - (played - c.priced) - c.expectedWins),
      "the old arithmetic no longer paints him the full token").toBe(3);

    const table = within(root).getAllByRole("table")[0];
    const cell = within(table).getByText(`${c.expectedWins}-${c.expectedLosses}`);
    expect(cell.className, `clint: ${cell.className}`).not.toMatch(/\b(hot|cold)\d\b/);
    expect(cell.getAttribute("title")).toMatch(/went 0-1 in those/);
  });

  test("the colour is graded, so a near-miss and a rout do not look the same", () => {
    /* What the gradient is for. Two rows both behind the market should not be
       painted identically when one is a rout and the other is rounding. */
    const root = board({
      ...data,
      byWeek: data.byWeek.map((w, i) => i < lastWeek ? w : {
        ...w,
        cumulative: {
          ...w.cumulative,
          /* level, a shade behind, and two wins behind, on the same slate */
          nathan: { points: 0, wins: 3, losses: 0, priced: 3, pricedWins: 2,
                    expectedWins: 2, expectedLosses: 1 },
          tconn: { points: 0, wins: 3, losses: 0, priced: 3, pricedWins: 2,
                   expectedWins: 2.6, expectedLosses: 0.4 },
          devish: { points: 0, wins: 3, losses: 0, priced: 3, pricedWins: 1,
                    expectedWins: 2.9, expectedLosses: 0.1 },
        },
      }),
    } as unknown as Data).container as unknown as HTMLElement;

    const table = within(root).getAllByRole("table")[0];
    const shade = (text: string) =>
      within(table).getByText(text).className.match(/\b(hot|cold)\d\b/)?.[0] ?? "none";

    expect(shade("2-1"), "dead level should carry no colour at all").toBe("none");
    expect(shade("2.6-0.4"), "0.6 behind is the faintest step").toBe("cold1");
    expect(shade("2.9-0.1"), "1.9 behind is the full token").toBe("cold3");
  });

  test("a manager with no priced game reads as a dash, not as 0-0", () => {
    const root = board(data).container as unknown as HTMLElement;
    /* Leandro's one settled game was never priced. "Nothing to say" and
       "expected to be level at nothing" are different sentences. */
    expect(weekly(lastWeek, "leandro").priced).toBe(0);
    expect(row(root, "Leandro")["Exp W-L*"]).toBe("-");
  });

  test("the games it does not cover are in the summary, not behind the fold", () => {
    board(data);
    /* getByText on the <summary> itself: a reader who never opens the
       disclosure still has to be told the two columns can count different
       games, or the subtraction they do in their head is wrong. */
    const summary = screen.getByText(/Exp W-L is the record the closing lines expected/i);
    expect(summary.tagName).toBe("SUMMARY");
    const mismatched = Object.values(data.byWeek[lastWeek].cumulative).some((c) => {
      const rec = c as { wins: number; losses: number; priced: number };
      return rec.wins + rec.losses > rec.priced;
    });
    expect(mismatched, "the fixture stopped exercising the mismatch").toBe(true);
    expect(summary.textContent).toMatch(/do not always count the same games/i);
  });

  test("and it does not claim a mismatch when there is not one", () => {
    /* The live payload today is 65 settled games with a line and none without,
       so the two columns cover exactly the same games. A footnote insisting
       otherwise would be the most confident wrong sentence on the page - which
       is the thing this column's whole small print exists to avoid. */
    const allPriced = {
      ...data,
      byWeek: data.byWeek.map((w) => ({
        ...w,
        cumulative: Object.fromEntries(
          Object.entries(w.cumulative).map(([m, c]) => {
            const rec = c as any;
            return [m, { ...rec, priced: rec.wins + rec.losses }];
          })
        ),
      })),
    } as unknown as Data;
    board(allPriced);
    const summary = screen.getByText(/Exp W-L is the record the closing lines expected/i);
    expect(summary.textContent).not.toMatch(/do not always count the same games/i);
    expect(summary.textContent).toMatch(/exactly the games Act W-L is/i);
  });
});

describe("payloads that predate the column", () => {
  /* The window this is about: a browser holding today's JS, handed weeks the
     bot wrote before the expectation existed. They have cumulative totals, so
     the rows render; every Exp cell would read "undefined-undefined". */
  const legacy = {
    ...data,
    byWeek: data.byWeek.map((w) => ({
      ...w,
      cumulative: Object.fromEntries(
        Object.entries(w.cumulative).map(([m, c]) => {
          const rec = c as any;
          return [m, { points: rec.points, wins: rec.wins, losses: rec.losses }];
        })
      ),
    })),
  } as unknown as Data;

  test("drop the column rather than printing undefined down it", () => {
    const root = board(legacy).container as unknown as HTMLElement;
    expect(headers(root)).not.toContain("Exp W-L*");
    expect(root.textContent).not.toMatch(/undefined/);
  });

  test("and take the footnote with them", () => {
    board(legacy);
    expect(screen.queryByText(/Exp W-L is the record/i)).toBeNull();
  });
});

describe("the week strip", () => {
  test("moves both records together", async () => {
    /* The point of reading the expectation out of the selected week rather
       than out of one season-level figure: pick week 1 and both columns are
       week 1's, not week 1's record against the season's expectation. */
    stubFetch();
    const { container } = await renderPage();
    const root = container as unknown as HTMLElement;
    const lastWeek = data.byWeek.length - 1;
    const at = (i: number, m: string) => data.byWeek[i].cumulative[m] as any;

    expect(headers(root)).toContain("Exp W-L*");
    expect(row(root, "Nathan")["Exp W-L*"])
      .toBe(`${at(lastWeek, "nathan").expectedWins}-${at(lastWeek, "nathan").expectedLosses}`);

    fireEvent.click(within(root).getAllByRole("button", { name: "1" })[0]);
    expect(headers(root), "the column vanished on a week view").toContain("Exp W-L*");
    expect(row(root, "Nathan")["Act W-L"])
      .toBe(`${at(0, "nathan").wins}-${at(0, "nathan").losses}`);
    expect(row(root, "Nathan")["Exp W-L*"])
      .toBe(`${at(0, "nathan").expectedWins}-${at(0, "nathan").expectedLosses}`);

    /* And week 1's expectation is genuinely smaller than the season's, which
       is what makes the assertion above about accumulation and not about two
       ways of writing the same number. */
    expect(at(0, "nathan").expectedWins).toBeLessThan(at(lastWeek, "nathan").expectedWins);
  });

  test("names the week the expectation has run to", async () => {
    stubFetch();
    const { container } = await renderPage();
    const root = container as unknown as HTMLElement;
    fireEvent.click(within(root).getAllByRole("button", { name: "1" })[0]);
    const summary = within(root).getByText(/Exp W-L is the record the closing lines expected/i);
    expect(summary.textContent).toMatch(/week 1/i);
  });
});
