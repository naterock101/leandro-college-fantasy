/**
 * The leaderboard's two points columns, and the three records behind them.
 *
 * The board is a points league, so what a manager has scored and what the
 * closing lines said they would have scored by now sit next to each other in
 * the table, and the records - actual, expected, projected - are together in
 * the manager's own dropdown. Both points figures accumulate, and both are
 * read out of the same week the rest of the row is.
 *
 * What is worth testing:
 *
 * 1. **It really accumulates.** Week 2 is week 1 plus week 2, not week 2 on its
 *    own. A column that silently showed one week's expectation against a
 *    season's total would look entirely plausible and be nonsense.
 * 2. **It follows the week strip.** Both columns move together; neither is
 *    pinned to a season-level figure that is right in one view only.
 * 3. **It compares like with like.** The expectation covers the priced games,
 *    so it may only ever be set against the points banked in *those* games.
 *    The season total is the wrong number and is wrong in the flattering
 *    direction.
 * 4. **The column disappears rather than inventing numbers.** Both expectations
 *    postdate the rest of `byWeek`, and the points pair postdates the record
 *    pair, so a browser holding this JS can be handed weeks that carry one,
 *    the other, or neither. The failure that reads as plausible is
 *    `undefined`, or worse `0`, which says "expected to have scored nothing"
 *    in the words of "we cannot say".
 * 5. **The records are still reachable.** They came off the table to stop it
 *    overrunning a phone, not to be deleted.
 * 6. **The footnote states the true denominator.** Announcing a mismatch when
 *    every settled game was priced is wrong in the same way, and just as
 *    loudly, as hiding a real one.
 */

import { describe, expect, test } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";

import { favouriteProbability } from "../lib/winprob.mjs";
import { expStep, Leaderboard, PER_WIN } from "../app/components/Leaderboard";
import { GamesOfWeek } from "../app/components/GamesOfWeek";
import { ViewState } from "../app/hooks/useViewState";
import type { Data } from "../app/types";
import { cap } from "../lib/format.mjs";
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

/** Opens a manager's dropdown and hands back the detail row. */
const open = (root: HTMLElement, manager: string) => {
  const table = within(root).getAllByRole("table")[0];
  fireEvent.click(within(table).getByRole("button", { name: manager }));
  return table.querySelector("tr.detail") as HTMLElement;
};

/** The records in a manager's dropdown, as `{ label: value }`. */
const records = (root: HTMLElement, manager: string) =>
  Object.fromEntries(
    [...open(root, manager).querySelectorAll(".rec")].map((rec) => [
      rec.querySelector(".rl")!.textContent!.trim(),
      rec.querySelector(".rv")!.textContent!.trim(),
    ])
  );

describe("the two points columns", () => {
  test("sit in the order the league reads them, with what was scored first", () => {
    const { container } = board(data);
    expect(headers(container as unknown as HTMLElement)).toEqual([
      "#", "Manager", "Pts", "Exp Pts*", "EoW Proj", "Games left", "Ceil",
    ]);
  });

  test("and the records are not among them", () => {
    /* The table was one column of points and three of W-L, which put the two
       numbers a reader most wants to subtract - scored, and expected to have
       scored - nowhere near each other, and ran the table off the side of a
       phone doing it. */
    const root = board(data).container as unknown as HTMLElement;
    expect(headers(root).filter((h) => /W-L/.test(h))).toEqual([]);
  });

  test("the worked example in the footnote comes out of the model", () => {
    /* It read "about 0.67 of a win" for a 7-point favourite - true at the old
       sigma of 16, and quietly two points wrong after the refit to 14.4, while
       Games of the week went on printing 69% for the same line. A worked
       example of the model that is typed rather than derived goes stale on the
       next change to the model, silently, in the one paragraph whose whole job
       is explaining the number beside it. */
    board(data);
    const p = favouriteProbability(7);
    const shown = screen.getByText(/wins about/i).textContent!;
    expect(shown).toContain(p.toFixed(2));
    /* and the same figure carried through to what the win pays */
    expect(shown).toContain((p * 3).toFixed(2));
    expect(shown, "the pre-refit figure is back").not.toMatch(/\b0\.67\b/);
  });

  test("the stacked headings are still one heading each", () => {
    /* They are drawn on two lines - "EXP" over "PTS*" - and that has to be a
       layout fact and not a content one. A `<br>`, or a block span with no
       space beside it, gives a screen reader "ExpPts*" or two headings where
       the table has one. */
    const root = board(data).container as unknown as HTMLElement;
    const table = within(root).getAllByRole("table")[0];
    const stacked = [...table.querySelectorAll("th")].filter((th) => th.querySelector(".hl"));
    expect(stacked.map((th) => th.textContent!.trim()))
      .toEqual(["Exp Pts*", "EoW Proj", "Games left"]);
    for (const th of stacked) {
      expect(th.textContent, `${th.textContent} lost the space between its lines`)
        .toMatch(/\S \S/);
    }
    /* and the single-word headings are left alone */
    expect(within(table).getByRole("columnheader", { name: "Manager" }).querySelector(".hl"))
      .toBeNull();
  });

  /** The expectation the payload carries for a manager at the end of a week. */
  const weekly = (i: number, manager: string) =>
    data.byWeek[i].cumulative[manager] as {
      points: number; wins: number; losses: number;
      expectedWins: number; expectedLosses: number; priced: number; pricedWins: number;
      expectedPoints: number; pricedPoints: number;
    };

  const lastWeek = data.byWeek.length - 1;

  test("Pts is the season's board and Exp Pts is the accumulated expectation", () => {
    const root = board(data).container as unknown as HTMLElement;
    /* Devish has banked 10 across every settled game and the lines expected 3.9
       from the three of them the books priced, which is exactly the gap this
       column has to survive: an expectation over fewer games than the total
       beside it. */
    const r = row(root, "Devish");
    const standings = data.standings.find((s) => s.manager === "devish")!;
    const c = weekly(lastWeek, "devish");

    expect(r["Pts"]).toBe(String(standings.points));
    expect(r["Exp Pts*"]).toBe(String(c.expectedPoints));
    expect(c.priced, "the fixture stopped exercising the gap")
      .toBeLessThan(standings.wins + standings.losses);
  });

  test("EoW Proj is the weighted projection, not the naive one", () => {
    /* Adam is the manager the two disagree about: every favourite winning puts
       him on 4, and weighting each game by the chance its line gives it puts
       him on 3.1. Showing both was the confusion this replaced - the column
       said one and his own dropdown said the other, with nothing on the page
       connecting them. */
    const root = board(data).container as unknown as HTMLElement;
    const pr = data.projection!.managers["adam"];
    expect(pr.expectedPoints, "the fixture stopped exercising this")
      .not.toBe(pr.points);
    expect(row(root, "Adam")["EoW Proj"]).toBe(`${pr.expectedPoints}–`);
  });

  test("the dropdown and the note fall back with the column, not apart from it", () => {
    /* Five figures used to decide for themselves whether the payload was
       weighted - the column, its arrow, its tooltip, the record and the note -
       and five checks over one payload is five chances to show half of each. A
       weighted record under a naive column is the exact split this replaced. */
    const partial = {
      ...data,
      projection: {
        ...data.projection!,
        managers: Object.fromEntries(Object.entries(data.projection!.managers)
          .map(([m, p]) => {
            const { expectedRankDelta, ...rest } = p as any;
            return [m, rest];
          })),
      },
    } as unknown as Data;
    const root = board(partial).container as unknown as HTMLElement;
    const pr = data.projection!.managers["adam"];

    expect(row(root, "Adam")["EoW Proj"]).toBe(`${pr.points}–`);
    const detail = open(root, "Adam");
    expect(detail.querySelector(".rec:last-child .rv")!.textContent)
      .toBe(`${pr.wins}-${pr.losses}`);
    expect(detail.querySelector(".note"), "a weighted note under a naive column")
      .toBeNull();
  });

  test("a payload with only some weighted fields falls back whole", () => {
    /* All of them or none. A cell reading the weighted points beside a tooltip
       reading the naive gain would describe one projection while showing the
       other, and a payload carrying expectedPoints without expectedGained -
       which is only reachable by a builder half-deployed - printed "undefined
       points" into the tooltip. */
    const partial = {
      ...data,
      projection: {
        ...data.projection!,
        managers: Object.fromEntries(Object.entries(data.projection!.managers)
          .map(([m, p]) => {
            const { expectedGained, ...rest } = p as any;
            return [m, rest];
          })),
      },
    } as unknown as Data;
    const root = board(partial).container as unknown as HTMLElement;
    const pr = data.projection!.managers["adam"];
    expect(row(root, "Adam")["EoW Proj"], "it took half of each projection")
      .toBe(`${pr.points}–`);
    expect(root.textContent).not.toMatch(/undefined/);
  });

  test("and its arrow comes from the same projection the number does", () => {
    /* An arrow taken from the naive ranking under a weighted number is two
       answers to one question: they usually agree, and when they do not there
       is nothing a reader can do about it. */
    const moved = data.standings.map((s) => s.manager);
    const root = board({
      ...data,
      projection: {
        ...data.projection!,
        managers: Object.fromEntries(Object.entries(data.projection!.managers)
          .map(([m, p]) => [m, {
            ...p,
            /* the two rankings pointed opposite ways */
            rankDelta: 2,
            expectedRankDelta: m === moved[0] ? -3 : 0,
          }])),
      },
    } as unknown as Data).container as unknown as HTMLElement;

    const table = within(root).getAllByRole("table")[0];
    const first = within(table).getByText(cap(moved[0])).closest("tr")!;
    expect(first.querySelector(".arrow")!.className).toMatch(/\bdown\b/);
    expect(first.querySelector(".arrow")!.getAttribute("title")).toMatch(/move 3 down/);
  });

  test("the live board reads the last week, which is the season to date", () => {
    /* The one thing that lets a single per-week figure serve both views. If
       byWeek ever stopped ending at the season's totals, the live board would
       quietly show a stale expectation against a current total. */
    for (const s of data.standings) {
      const c = weekly(lastWeek, s.manager);
      expect(c.wins, `${s.manager}'s wins`).toBe(s.wins);
      expect(c.losses, `${s.manager}'s losses`).toBe(s.losses);
      expect(c.points, `${s.manager}'s points`).toBe(s.points);
    }
  });

  test("it accumulates rather than showing one week on its own", () => {
    /* The failure that would look entirely plausible: week 2 showing week 2's
       expectation against week 2's cumulative total. Every week's expectation
       has to be at least the week before's, and somewhere it has to grow. */
    let grew = false;
    for (const m of data.standings.map((s) => s.manager)) {
      for (let i = 1; i <= lastWeek; i++) {
        const prev = weekly(i - 1, m);
        const now = weekly(i, m);
        if (!prev || !now) continue;
        expect(now.expectedWins, `${m} went backwards at week ${i}`)
          .toBeGreaterThanOrEqual(prev.expectedWins);
        expect(now.expectedPoints, `${m}'s expected points went backwards at week ${i}`)
          .toBeGreaterThanOrEqual(prev.expectedPoints);
        expect(now.pricedPoints, `${m}'s banked points went backwards at week ${i}`)
          .toBeGreaterThanOrEqual(prev.pricedPoints);
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
        const rec = c as { expectedWins: number; expectedLosses: number; priced: number;
                           expectedPoints: number; pricedPoints: number };
        expect(Math.round((rec.expectedWins + rec.expectedLosses) * 10) / 10,
          `${m} at ${w.label}`).toBe(rec.priced);
        /* and the points pair is over those same games: nobody can be expected
           more than 3 a game, and nobody can have banked more than they were
           expected to have played for. */
        expect(rec.expectedPoints, `${m}'s expectation at ${w.label} exceeds its slate`)
          .toBeLessThanOrEqual(rec.priced * 3);
        expect(rec.pricedPoints, `${m} banked more than the priced games could pay`)
          .toBeLessThanOrEqual(rec.priced * 3);
      }
    }
  });

  test("the colour compares like with like when games went unpriced", () => {
    /* Devish has banked 10 over the season and 5 over the three games that
       carried a line, against 3.9 expected. That is 1.1 points ahead of the
       market: the faintest step.

       Setting the season total against an expectation over three games scores
       him at +6.1 and paints him the full token - the two unpriced wins
       counted as points the market never got a say on. So the assertion is the
       faint step, and what it is guarding is the two steps of teal the wrong
       numerator invents. */
    const root = board(data).container as unknown as HTMLElement;
    const c = weekly(lastWeek, "devish");
    const season = data.standings.find((s) => s.manager === "devish")!;
    expect(c.priced, "the fixture stopped exercising this").toBe(3);

    expect(expStep(c.pricedPoints - c.expectedPoints, PER_WIN), "devish is a shade ahead").toBe(1);
    expect(expStep(season.points - c.expectedPoints, PER_WIN),
      "the season total no longer paints him the full token").toBe(3);

    const table = within(root).getAllByRole("table")[0];
    const cell = within(table).getByText(String(c.expectedPoints));
    expect(cell.className, `devish: ${cell.className}`).toMatch(/\bhot1\b/);
    expect(cell.getAttribute("title")).toMatch(/banked 5\./);
  });

  test("the colour is graded, so a near-miss and a rout do not look the same", () => {
    /* What the gradient is for. Two rows both behind the market should not be
       painted identically when one is a rout and the other is rounding. The
       steps are the same three judgements as the record's, scaled by what a
       win pays: 0.6, 1.8 and 3.6 points. */
    const at = (expectedPoints: number, pricedPoints: number) =>
      ({ points: 0, wins: 3, losses: 0, priced: 3, pricedWins: 2,
         expectedWins: 2, expectedLosses: 1, expectedPoints, pricedPoints });
    const root = board({
      ...data,
      byWeek: data.byWeek.map((w, i) => i < lastWeek ? w : {
        ...w,
        cumulative: {
          ...w.cumulative,
          /* level, a shade behind, and two wins' worth behind, on one slate */
          nathan: at(6.4, 6.4),
          tconn: at(7.9, 6.4),
          devish: at(10.3, 6.4),
        },
      }),
    } as unknown as Data).container as unknown as HTMLElement;

    const table = within(root).getAllByRole("table")[0];
    const shade = (text: string) =>
      within(table).getByText(text).className.match(/\b(hot|cold)\d\b/)?.[0] ?? "none";

    expect(shade("6.4"), "dead level should carry no colour at all").toBe("none");
    expect(shade("7.9"), "1.5 points behind is the faintest step").toBe("cold1");
    expect(shade("10.3"), "3.9 points behind is the full token").toBe("cold3");
  });

  test("a manager with no priced game reads as a dash, not as 0", () => {
    const root = board(data).container as unknown as HTMLElement;
    /* Leandro's one settled game was never priced. "Nothing to say" and
       "expected to have scored nothing" are different sentences. */
    expect(weekly(lastWeek, "leandro").priced).toBe(0);
    expect(row(root, "Leandro")["Exp Pts*"]).toBe("-");
  });

  test("the games it does not cover are in the summary, not behind the fold", () => {
    board(data);
    /* getByText on the <summary> itself: a reader who never opens the
       disclosure still has to be told the two columns can count different
       games, or the subtraction they do in their head is wrong. */
    const summary = screen.getByText(/Exp Pts is the points the closing lines expected/i);
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
    const summary = screen.getByText(/Exp Pts is the points the closing lines expected/i);
    expect(summary.textContent).not.toMatch(/do not always count the same games/i);
    expect(summary.textContent).toMatch(/exactly the games Pts is/i);
  });
});

describe("the games the projection could not reach", () => {
  /* Only one kind of game is missing from a weighted projection: one nothing
     would price. A pick-em is not - the books priced it and called it even,
     and a game worth half its points to each side is a game in the total. The
     caption used to have to say which of the two had happened, because the
     naive projection skipped both. */
  const withProjection = (over: Record<string, number>) => board({
    ...data,
    projection: { ...data.projection!, ...over },
  } as unknown as Data).container as unknown as HTMLElement;

  const caption = (root: HTMLElement) =>
    root.querySelector(".caption")!.textContent!;

  test("an unpriced game is reported", () => {
    expect(caption(withProjection({ games: 60, unprojected: 2, unpriced: 2, pickems: 0 })))
      .toContain("2 of 60 games have no line at all and are left out");
  });

  test("a pick-em is not, because this projection uses it", () => {
    /* Half a win each side. Calling it left out would be the page describing
       a game it had just counted. */
    const text = caption(withProjection({ games: 60, unprojected: 3, unpriced: 0, pickems: 3 }));
    expect(text, "a game the projection used was reported as missing")
      .not.toMatch(/left out/);
    expect(text).not.toMatch(/pick-em/);
  });

  test("and a week with both counts only the unpriced ones", () => {
    expect(caption(withProjection({ games: 60, unprojected: 3, unpriced: 1, pickems: 2 })))
      .toContain("1 of 60 games has no line at all and is left out");
  });

  test("the verbs agree with the count", () => {
    /* One game is the commonest case there is, and "1 of 60 games have no line
       and are left out" is the sentence a plural-only template writes. */
    const one = caption(withProjection({ games: 60, unprojected: 1, unpriced: 1, pickems: 0 }));
    expect(one).toContain("1 of 60 games has no line at all and is left out");
    expect(one).not.toMatch(/\b1 of 60 games (have|are)\b/);
  });

  test("nothing is said when nothing was left out", () => {
    expect(caption(withProjection({ games: 60, unprojected: 0, unpriced: 0, pickems: 0 })))
      .not.toMatch(/left out/);
  });

  test("a naive fallback reports by the naive rule, not this one", () => {
    /* The counts differ by the pick-ems: this projection uses them, the naive
       one skips them. A page that has fallen back to the naive projection and
       goes on reporting `unpriced` under-reports by exactly the games that
       fallback dropped - "nothing was left out" over a column that left two
       games out. */
    const naive = {
      ...data,
      projection: {
        ...data.projection!,
        games: 60, unprojected: 2, unpriced: 0, pickems: 2,
        managers: Object.fromEntries(Object.entries(data.projection!.managers)
          .map(([m, p]) => {
            const { expectedRankDelta, ...rest } = p as any;
            return [m, rest];
          })),
      },
    } as unknown as Data;
    const text = caption(board(naive).container as unknown as HTMLElement);
    expect(text).toContain("2 of 60 games could not be projected and are left out");
    expect(text, "it reported the weighted count under a naive column")
      .not.toMatch(/no line at all and (is|are) left out/);
  });

  test("a payload predating the split keeps the vaguer sentence", () => {
    /* Its `unprojected` counts by the naive rule, so it may include pick-ems
       this projection did use. It may not be reported as a precise figure it
       is not, and it may not be silently dropped either. */
    const legacy = { ...data.projection!, games: 60, unprojected: 2 } as Record<string, unknown>;
    delete legacy.unpriced;
    delete legacy.pickems;
    const text = caption(board({ ...data, projection: legacy } as unknown as Data)
      .container as unknown as HTMLElement);
    expect(text).toContain("2 of 60 games could not be projected and are left out");
    expect(text).not.toMatch(/undefined/);
  });

  test("a game carried by the model is named, whenever it happens", () => {
    /* Unlike the games left out, this is a number *in* the column rather than
       one missing from it, and a reader comparing two managers is entitled to
       know that one of them is being carried by a forecast. */
    expect(caption(withProjection({ games: 60, unprojected: 0, unpriced: 0,
                                    pickems: 0, modelled: 1 })))
      .toContain("1 game had no line at all and is projected from ESPN's model instead");
    expect(caption(withProjection({ games: 60, unprojected: 0, unpriced: 0,
                                    pickems: 0, modelled: 2 })))
      .toContain("2 games had no line at all and are projected from ESPN's model instead");
  });

  test("and a payload with no such game says nothing about the model", () => {
    expect(caption(withProjection({ games: 60, unprojected: 0, unpriced: 0, pickems: 0 })))
      .not.toMatch(/FPI|ESPN's model/);
  });
});

describe("the records in the dropdown", () => {
  const lastWeek = data.byWeek.length - 1;

  test("hold all three, labelled, on one line each", () => {
    /* They came off the table because eight columns do not fit a phone, not
       because the league stopped caring about them - and a reader who taps a
       manager should not have to know that "Exp" ever meant a record. */
    const root = board(data).container as unknown as HTMLElement;
    const s = data.standings.find((r) => r.manager === "devish")!;
    const c = data.byWeek[lastWeek].cumulative["devish"] as any;
    const pr = data.projection!.managers["devish"];

    expect(records(root, "Devish")).toEqual({
      "Record": `${s.wins}-${s.losses}`,
      "Expected": `${c.expectedWins}-${c.expectedLosses}`,
      [`${data.projection!.label} proj`]: `${pr.expectedWins}-${pr.expectedLosses}`,
    });
  });

  test("the projected record is the weighted one, like the column", () => {
    /* Adam again: 2-2 if every favourite holds, 1.6-2.4 weighted. A dropdown
       showing the naive record beside a column showing the weighted points is
       the same split this change closed, one tap further down. */
    const root = board(data).container as unknown as HTMLElement;
    const pr = data.projection!.managers["adam"];
    expect(`${pr.expectedWins}-${pr.expectedLosses}`,
      "the fixture stopped exercising this").not.toBe(`${pr.wins}-${pr.losses}`);
    expect(records(root, "Adam")[`${data.projection!.label} proj`])
      .toBe(`${pr.expectedWins}-${pr.expectedLosses}`);
  });

  test("and it falls back to the naive record on a payload without one", () => {
    const legacy = {
      ...data,
      projection: {
        ...data.projection!,
        managers: Object.fromEntries(Object.entries(data.projection!.managers)
          .map(([m, p]) => {
            const { expectedWins, expectedLosses, ...rest } = p as any;
            return [m, rest];
          })),
      },
    } as unknown as Data;
    const root = board(legacy).container as unknown as HTMLElement;
    const pr = data.projection!.managers["adam"];
    expect(records(root, "Adam")[`${data.projection!.label} proj`])
      .toBe(`${pr.wins}-${pr.losses}`);
  });

  test("the expected record keeps its own comparison, in wins", () => {
    /* Clint is 0-3 over the season and 0-1 over the one game that carried a
       line, against 0.2 expected. That is a fifth of a win off the market:
       level, and it should carry no colour at all.

       The version that derived his priced wins from the season record scored
       him at -2.2 - it counted his two unpriced games as wins he had failed to
       have - and painted him the coldest row on the board. So the assertion is
       "no colour", and what it is guarding is the two full steps of red the
       arithmetic used to invent. */
    const root = board(data).container as unknown as HTMLElement;
    const c = data.byWeek[lastWeek].cumulative["clint"] as any;
    expect(c.priced, "the fixture stopped exercising this").toBe(1);
    expect(c.pricedWins).toBe(0);

    const played = c.wins + c.losses;
    expect(expStep(c.pricedWins - c.expectedWins), "clint is level").toBe(0);
    expect(expStep(c.wins - (played - c.priced) - c.expectedWins),
      "the old arithmetic no longer paints him the full token").toBe(3);

    const detail = open(root, "Clint");
    const cell = detail.querySelector(".rec .exp")!;
    expect(cell.textContent).toBe(`${c.expectedWins}-${c.expectedLosses}`);
    expect(cell.className, `clint: ${cell.className}`).not.toMatch(/\b(hot|cold)\d\b/);
    expect(cell.closest(".rec")!.getAttribute("title")).toMatch(/went 0-1 in those/);
  });

  test("a manager with no priced game reads as a dash there too", () => {
    const root = board(data).container as unknown as HTMLElement;
    expect(records(root, "Leandro")["Expected"]).toBe("-");
  });

  test("the note says where the projection came from, per manager", () => {
    /* It used to end "for 29.7 in all" under a column reading 33 - two
       projections, inches apart, with nothing on the page connecting them. The
       column is that number now, so the note is its provenance rather than a
       rival to it. */
    const root = board(data).container as unknown as HTMLElement;
    const pr = data.projection!.managers["nathan"];
    const note = open(root, "Nathan").querySelector(".note")!.textContent!;
    expect(note).toContain(`+${pr.expectedGained} points on top of the`);
    expect(note).toContain("every game worth the chance its line gives it");
  });

  test("and it names ESPN's model only for a manager whose week has one", () => {
    /* The clause was league-level: shown to a manager whose ten games all
       carry lines, it named a source that contributed nothing to their number.
       The modelled game belongs to one manager, so the sentence does too. */
    const withModel = (per: Record<string, number>) => ({
      ...data,
      projection: {
        ...data.projection!,
        managers: Object.fromEntries(Object.entries(data.projection!.managers)
          .map(([m, p]) => [m, { ...p, modelled: per[m] ?? 0 }])),
      },
    } as unknown as Data);

    const root = board(withModel({ clint: 1 })).container as unknown as HTMLElement;
    expect(open(root, "Clint").querySelector(".note")!.textContent)
      .toMatch(/for one game no book would price, the chance ESPN's model gives it/);
    expect(open(root, "Nathan").querySelector(".note")!.textContent,
      "a manager with no modelled game was told about one").not.toMatch(/ESPN/);
  });

  test("and the squad's points are still the last thing in each row", () => {
    /* The reason the records moved: the table was wider than a phone, so the
       detail row was too, and the column this dropdown exists to show was the
       one hanging off the right-hand edge. */
    const root = board(data).container as unknown as HTMLElement;
    const detail = open(root, "Devish");
    const teams = [...detail.querySelectorAll(".team")];
    expect(teams.length).toBe(10);
    const s = data.standings.find((r) => r.manager === "devish")!;
    for (const team of teams) {
      const last = team.lastElementChild!;
      expect(last.className).toContain("tp");
      expect(last.textContent).toMatch(/^\d+$/);
    }
    expect(teams.reduce((n, t) => n + Number(t.lastElementChild!.textContent), 0))
      .toBe(s.points);
  });
});

describe("payloads that predate the columns", () => {
  /* The window this is about: a browser holding today's JS, handed weeks the
     bot wrote before the expectation existed. They have cumulative totals, so
     the rows render; every Exp cell would read `undefined`. */
  const strip = (keep: string[]) => ({
    ...data,
    byWeek: data.byWeek.map((w) => ({
      ...w,
      cumulative: Object.fromEntries(
        Object.entries(w.cumulative).map(([m, c]) => {
          const rec = c as any;
          return [m, Object.fromEntries(Object.entries(rec).filter(([k]) =>
            ["points", "wins", "losses"].includes(k) || keep.includes(k)))];
        })
      ),
    })),
  } as unknown as Data);

  test("drop the column rather than printing undefined down it", () => {
    const root = board(strip([])).container as unknown as HTMLElement;
    expect(headers(root)).not.toContain("Exp Pts*");
    expect(root.textContent).not.toMatch(/undefined/);
  });

  test("and take the footnote with them", () => {
    board(strip([]));
    expect(screen.queryByText(/Exp Pts is the points/i)).toBeNull();
  });

  test("the dropdown drops the expected record on the same payload", () => {
    const root = board(strip([])).container as unknown as HTMLElement;
    expect(Object.keys(records(root, "Devish"))).toEqual(["Record", "Week 3 proj"]);
  });

  /* The narrower window, and the reason the two are checked separately: the
     points pair shipped after the record pair, so there is a payload that
     carries the record and not the points. It has to lose the column without
     losing the record in the dropdown. */
  test("a week with the record and not the points keeps the record", () => {
    const only = strip(["expectedWins", "expectedLosses", "priced", "pricedWins"]);
    const root = board(only).container as unknown as HTMLElement;
    expect(headers(root)).not.toContain("Exp Pts*");
    const c = data.byWeek[data.byWeek.length - 1].cumulative["devish"] as any;
    expect(records(root, "Devish")["Expected"])
      .toBe(`${c.expectedWins}-${c.expectedLosses}`);
    expect(root.textContent).not.toMatch(/undefined/);
  });
});

/**
 * The week view, which is a week and not a season cut short at one.
 *
 * The live board accumulates - that is what a season standing is. A week view
 * does not: picking week 2 used to leave every column running (week 1 plus
 * week 2's points, the expectation behind both) and the ceiling frankly
 * season-long, so a manager with one game played in the week read 24 points
 * beside a ceiling of 282 and neither number was about week 2 at all.
 *
 * The awkward cases are the ones that make it worth a block of tests: a
 * manager on a bye has no game in the week and so tops out at what they
 * already have, and a manager whose own two teams meet cannot be paid twice
 * for one game. Both are wrong in the flattering direction when a week
 * borrows the season's arithmetic.
 */
describe("the week strip", () => {
  /** The figures the payload carries for a manager in one week alone. */
  const own = (i: number, manager: string) => data.byWeek[i].weekly![manager];
  /** The running totals at the end of that week, which is what it is not. */
  const upTo = (i: number, manager: string) => data.byWeek[i].cumulative[manager] as any;

  /** Picks a week off the strip. The live button is "Live". */
  const pick = (root: HTMLElement, label: string) =>
    fireEvent.click(within(root).getAllByRole("button", { name: label })[0]);

  /** A payload whose week `i` carries the weekly figures in `over`. */
  const withWeek = (i: number, over: Record<string, Partial<NonNullable<Data["byWeek"][number]["weekly"]>[string]>>) =>
    ({
      ...data,
      byWeek: data.byWeek.map((w, n) => n !== i ? w : {
        ...w,
        weekly: Object.fromEntries(
          Object.entries(w.weekly!).map(([m, k]) => [m, { ...k, ...(over[m] ?? {}) }])
        ),
      }),
    }) as unknown as Data;

  test("shows the week alone, not the season up to it", async () => {
    /* Tconn scored in week 1 and again in week 2, so the week figure and the
       running one are genuinely different numbers - which is what makes this
       an assertion about the view rather than two ways of writing 3. */
    stubFetch();
    const { container } = await renderPage();
    const root = container as unknown as HTMLElement;

    expect(own(1, "tconn").points).toBeLessThan(upTo(1, "tconn").points);
    expect(own(1, "tconn").expectedPoints).toBeLessThan(upTo(1, "tconn").expectedPoints);

    pick(root, "2");
    expect(headers(root), "the column vanished on a week view").toContain("Exp Pts*");
    expect(row(root, "Tconn")["Pts"]).toBe(String(own(1, "tconn").points));
    expect(row(root, "Tconn")["Exp Pts*"]).toBe(String(own(1, "tconn").expectedPoints));
  });

  test("and takes the records in the dropdown with it", async () => {
    /* The dropdown reads the same week as the row it hangs off. A season
       record under a week view is the same bug the columns were built to
       avoid, one tap further down. */
    stubFetch();
    const { container } = await renderPage();
    const root = container as unknown as HTMLElement;
    pick(root, "2");
    const k = own(1, "tconn");
    /* Read once: `records` opens the dropdown, so asking twice shuts it. */
    const shown = records(root, "Tconn");
    expect(shown).toMatchObject({
      "Record": `${k.wins}-${k.losses}`,
      "Expected": `${k.expectedWins}-${k.expectedLosses}`,
    });
    expect(shown["Record"])
      .not.toBe(`${upTo(1, "tconn").wins}-${upTo(1, "tconn").losses}`);
  });

  test("the ceiling is the week's own, not the season's", () => {
    /* The number that was most obviously wrong: a season ceiling sitting in a
       row of week figures, three times the size of anything beside it. Two
       games left at 3 points each on top of 4 banked, and the column beside it
       counts those games - so the headroom is shown rather than asserted. */
    const season = data.standings.find((s) => s.manager === "tconn")!;
    const root = board(withWeek(1, { tconn: { points: 4, remaining: 2, ceiling: 10 } }))
      .container as unknown as HTMLElement;
    fireEvent.click(within(root).getAllByRole("button", { name: "2" })[0]);
    expect(headers(root)).toContain("Games left");
    expect(row(root, "Tconn")).toMatchObject({ "Pts": "4", "Games left": "2", "Ceil": "10" });
    expect(row(root, "Tconn")["Ceil"]).not.toBe(String(season.ceiling));
  });

  test("a bye week tops out at what is already on the board", () => {
    /* Devish has no game at all in week 2 of the fixture. Their ceiling for it
       is what they scored in it - not a season figure, and not a week they
       could still add to - while the manager beside them still has a week to
       play. That contrast is the point: one row of the same column is capped
       and the other is not. */
    expect(own(1, "devish").wins + own(1, "devish").losses + own(1, "devish").remaining,
      "the fixture stopped being a bye").toBe(0);
    const root = board(withWeek(1, { tconn: { points: 4, remaining: 2, ceiling: 10 } }))
      .container as unknown as HTMLElement;
    fireEvent.click(within(root).getAllByRole("button", { name: "2" })[0]);
    expect(row(root, "Devish")).toMatchObject({
      "Pts": String(own(1, "devish").points),
      "Games left": "0",
      "Ceil": String(own(1, "devish").ceiling),
    });
    /* and the expectation has nothing to say about a week with no priced
       game of theirs, which is a dash rather than a nought */
    expect(row(root, "Devish")["Exp Pts*"]).toBe("-");
  });

  test("a week that is played out quotes no ceiling at all", async () => {
    /* Every ceiling in a finished week is the points beside it and every
       "games left" is 0 - two columns saying nothing in the words of
       something, which is the same reason the expectation disappears when no
       game in view was priced. */
    stubFetch();
    const { container } = await renderPage();
    const root = container as unknown as HTMLElement;
    expect(Object.values(data.byWeek[1].weekly!).every((k) => k.remaining === 0),
      "the fixture's week 2 has something left to play").toBe(true);
    pick(root, "2");
    expect(headers(root)).not.toContain("Ceil");
    expect(headers(root)).not.toContain("Games left");
    expect(root.textContent).toMatch(/no ceiling left to quote/i);
  });

  test("an own matchup comes off the week's ceiling and says so", () => {
    /* Two of one manager's teams playing each other in the week pays the
       winner once. The dock is the builder's, and the dropdown names it in
       the week's own words rather than the season's "upcoming". */
    const root = board(withWeek(1, {
      tconn: { points: 4, remaining: 2, collisionLoss: 2, ceiling: 8 },
    })).container as unknown as HTMLElement;
    fireEvent.click(within(root).getAllByRole("button", { name: "2" })[0]);
    expect(row(root, "Tconn")["Ceil"]).toBe("8");
    expect(open(root, "Tconn").textContent)
      .toMatch(/Ceiling docked 2 for games this week between two of your own teams/i);
  });

  test("says in its own heading that it is one week", async () => {
    stubFetch();
    const { container } = await renderPage();
    const root = container as unknown as HTMLElement;
    pick(root, "2");
    /* "As of week 2" was the running-total sentence, and under week figures
       it reads as a claim the columns do not make. */
    expect(root.textContent).toMatch(/Week 2 only/);
    expect(root.textContent).not.toMatch(/As of week 2/i);
    const summary = within(root).getByText(/Exp Pts is the points the closing lines expected/i);
    expect(summary.textContent).toMatch(/week 2 alone/i);
  });

  test("and the squad below it still says which season it is counting", async () => {
    /* The one figure in the view that is still the season's. Per-team weekly
       records are not in the payload - byWeek is refetched by every open tab
       every two minutes - so the honest move is to label them, not to let
       them read as the week. */
    stubFetch();
    const { container } = await renderPage();
    const root = container as unknown as HTMLElement;
    pick(root, "2");
    expect(open(root, "Tconn").textContent)
      .toMatch(/Squad records below are the season’s, not this week’s/);
  });

  test("a weekly block missing a manager is not used at all", () => {
    /* All of it or none of it. A block covering seven managers of eight would
       sort one row's week against another's season, with a season ceiling in
       the rows it missed - the mixed row this whole change removes, put back
       one payload deeper. */
    const partial = {
      ...data,
      byWeek: data.byWeek.map((w, n) => n !== 1 ? w : {
        ...w,
        weekly: Object.fromEntries(
          Object.entries(w.weekly!).filter(([m]) => m !== "devish")
        ),
      }),
    } as unknown as Data;
    const root = board(partial).container as unknown as HTMLElement;
    fireEvent.click(within(root).getAllByRole("button", { name: "2" })[0]);
    expect(headers(root)).toContain("+/-");
    expect(row(root, "Tconn")["Pts"]).toBe(String(upTo(1, "tconn").points));
    expect(root.textContent).toMatch(/As of week 2/i);
  });

  test("a payload with no weekly block still draws the week it always did", () => {
    /* A browser holding this JS can be handed a snapshot written before the
       weekly figures shipped. The running totals are what that payload has,
       and showing them is better than showing blanks - so the view falls back
       whole, +/- column and all, rather than half. */
    const older = {
      ...data,
      byWeek: data.byWeek.map(({ weekly, ...w }) => w),
    } as unknown as Data;
    const root = board(older).container as unknown as HTMLElement;
    fireEvent.click(within(root).getAllByRole("button", { name: "2" })[0]);
    expect(headers(root)).toContain("+/-");
    expect(row(root, "Tconn")["Pts"]).toBe(String(upTo(1, "tconn").points));
    expect(row(root, "Tconn")["Exp Pts*"]).toBe(String(upTo(1, "tconn").expectedPoints));
    expect(root.textContent).toMatch(/As of week 2/i);
    expect(root.textContent).not.toMatch(/undefined/);
  });
});

/**
 * The moneyline row, where it is rendered.
 *
 * It lives in this file rather than one of its own because there is one thing
 * to check on the page and it is a sentence: a price with no spread has to
 * read as the moneyline it is, and the percentage beside it has to be the
 * market's own number rather than the model's guess at what spread would have
 * produced it.
 */
describe("a game the book would not spread", () => {
  /* Troy at -1650 against Alabama State at +950, de-vigged - the real price
     DraftKings had up on 2026-09-12, and the shape lib/lines.mjs stores. */
  const ml = {
    spread: null, favorite: "Troy", formatted: "Troy ML -1650",
    overUnder: 51.5, provider: "DraftKings", probability: 0.9083,
  };

  /* And the price of last resort, for the game no book would touch. */
  const fpi = {
    spread: null, favorite: "Arkansas State", formatted: "Arkansas State FPI",
    overUnder: null, provider: "ESPN FPI", probability: 0.91, model: true,
  };

  const withMoneyline = () => {
    const games = data.gamesOfWeek.games.map((g, i) =>
      i === 0 ? { ...g, spread: ml } : g);
    return { ...data, gamesOfWeek: { ...data.gamesOfWeek, games } } as unknown as Data;
  };

  test("prints the moneyline, and the market's own chance beside it", () => {
    const { container } = render(<GamesOfWeek data={withMoneyline()} />);
    const root = container as unknown as HTMLElement;
    expect(within(root).getByText("Troy ML -1650")).toBeTruthy();
    /* 91%, not the 84% the model gives for the 19-point spread this price is
       worth - the whole point of preferring a probability the book stated. */
    expect(within(root).getByText("91%")).toBeTruthy();
    expect(root.textContent).not.toMatch(/undefined|NaN/);
  });

  test("an FPI row says the model, and does not repeat its own number", () => {
    const games = data.gamesOfWeek.games.map((g, i) => i === 0 ? { ...g, spread: fpi } : g);
    const { container } = render(<GamesOfWeek
      data={{ ...data, gamesOfWeek: { ...data.gamesOfWeek, games } } as unknown as Data} />);
    const root = container as unknown as HTMLElement;

    /* The label carries no percentage: the column beside it already does, and
       "Arkansas State FPI 91% 91%" is what happens when both try. */
    expect(within(root).getByText("Arkansas State FPI")).toBeTruthy();
    expect(within(root).getByText("91%")).toBeTruthy();
    expect(root.textContent).toMatch(/An FPI row is a game no book would price at all/);
    /* and the tooltip does not call a forecast a price */
    expect(within(root).getByText("91%").getAttribute("title"))
      .toMatch(/No book priced this game\. ESPN's FPI gives Arkansas State 91%/);
  });

  test("the model is not listed among the books", () => {
    /* "Lines from DraftKings and ESPNFPI" - a forecast named as a book, and
       mangled by the space-stripping that exists for CFBD's "Draft Kings".
       What an FPI row is has its own sentence; it is not another name in a
       list of the places a price came from. */
    const games = data.gamesOfWeek.games.map((g, i) => i === 0 ? { ...g, spread: fpi } : g);
    const { container } = render(<GamesOfWeek
      data={{ ...data, gamesOfWeek: { ...data.gamesOfWeek, games } } as unknown as Data} />);
    const text = (container as unknown as HTMLElement).textContent!;
    expect(text).toMatch(/Lines from DraftKings, refreshed/);
    expect(text).not.toMatch(/ESPNFPI|and ESPN FPI,/);
  });

  test("and says what an ML row is, but only on a week that has one", () => {
    const { container } = render(<GamesOfWeek data={withMoneyline()} />);
    expect((container as unknown as HTMLElement).textContent)
      .toMatch(/A row marked ML is one the book would not put a spread on/);

    /* A standing sentence about a case that arises on about one game a week
       would be a paragraph the league re-reads all season for nothing. */
    const { container: plain } = render(<GamesOfWeek data={data} />);
    expect((plain as unknown as HTMLElement).textContent)
      .not.toMatch(/A row marked ML/);
  });
});
