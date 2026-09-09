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

  test("EoW Proj is points, which is what its arrow is computed from", () => {
    /* It showed W-L beside an arrow taken from the projected *points* table.
       The two usually agree and are not the same sentence, and the column that
       has to match the arrow is the one the sort is on. */
    const root = board(data).container as unknown as HTMLElement;
    const pr = data.projection!.managers["nathan"];
    expect(row(root, "Nathan")["EoW Proj"]).toBe(`${pr.points}–`);
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

describe("the games the projection could not project", () => {
  /* "Have no line" was the whole sentence, and it is true of only one of the
     two reasons a game is left out. A pick-em has a line - the books priced it
     and called it even - and the weighted expectation in the row's own tooltip
     uses it, at half a win a side. So the page was calling a game unpriced in
     one place and pricing it in another. */
  const withProjection = (over: Record<string, number>) => board({
    ...data,
    projection: { ...data.projection!, ...over },
  } as unknown as Data).container as unknown as HTMLElement;

  const caption = (root: HTMLElement) =>
    root.querySelector(".caption")!.textContent!;

  test("an unpriced game is called unpriced", () => {
    expect(caption(withProjection({ games: 60, unprojected: 2, unpriced: 2, pickems: 0 })))
      .toContain("2 of 60 games have no line and are left out");
  });

  test("a pick-em is not", () => {
    const text = caption(withProjection({ games: 60, unprojected: 1, unpriced: 0, pickems: 1 }));
    expect(text).toContain("1 of 60 games is a pick-em with no favourite, and is left out");
    expect(text, "a priced game must not be reported as unpriced")
      .not.toMatch(/ha(s|ve) no line/);
  });

  test("and the verbs agree with the count", () => {
    /* One game is the commonest case there is, and "1 of 60 games have no line
       and are left out" is the sentence a plural-only template writes. */
    expect(caption(withProjection({ games: 60, unprojected: 1, unpriced: 1, pickems: 0 })))
      .toContain("1 of 60 games has no line and is left out");
    for (const over of [{ unprojected: 1, unpriced: 1, pickems: 0 },
                        { unprojected: 1, unpriced: 0, pickems: 1 },
                        /* halves that do not add back to their total, which
                           is a payload from a version this page cannot read */
                        { unprojected: 1, unpriced: 0, pickems: 0 }]) {
      const text = caption(withProjection({ games: 60, ...over }));
      expect(text, JSON.stringify(over)).not.toMatch(/\b1 of 60 games (have|are)\b/);
    }
  });

  test("and a week with both says which is which", () => {
    expect(caption(withProjection({ games: 60, unprojected: 3, unpriced: 2, pickems: 1 })))
      .toContain("3 of 60 games are left out: 2 with no line, and 1 that is a pick-em");
  });

  test("nothing is said when nothing was left out", () => {
    expect(caption(withProjection({ games: 60, unprojected: 0, unpriced: 0, pickems: 0 })))
      .not.toMatch(/left out/);
  });

  test("halves that do not add up fall back rather than under-report", () => {
    /* The sentence reads the two counts as a complete account of the total, so
       a payload where they are not one would say "0 of 60 games have no line"
       while a game really was left out. */
    expect(caption(withProjection({ games: 60, unprojected: 2, unpriced: 0, pickems: 0 })))
      .toContain("2 of 60 games could not be projected and are left out");
  });

  test("a payload predating the split keeps the vaguer sentence", () => {
    /* It may not guess which half its total was, and it may not go on claiming
       the commoner one. */
    const legacy = { ...data.projection!, games: 60, unprojected: 2 } as Record<string, unknown>;
    delete legacy.unpriced;
    delete legacy.pickems;
    const root = board({ ...data, projection: legacy } as unknown as Data)
      .container as unknown as HTMLElement;
    const text = caption(root);
    expect(text).toContain("2 of 60 games could not be projected and are left out");
    expect(text).not.toMatch(/undefined/);
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
      [`${data.projection!.label} proj`]: `${pr.wins}-${pr.losses}`,
    });
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

describe("the week strip", () => {
  test("moves both columns together", async () => {
    /* The point of reading the expectation out of the selected week rather
       than out of one season-level figure: pick week 1 and both columns are
       week 1's, not week 1's total against the season's expectation. */
    stubFetch();
    const { container } = await renderPage();
    const root = container as unknown as HTMLElement;
    const lastWeek = data.byWeek.length - 1;
    const at = (i: number, m: string) => data.byWeek[i].cumulative[m] as any;

    expect(headers(root)).toContain("Exp Pts*");
    expect(row(root, "Nathan")["Exp Pts*"]).toBe(String(at(lastWeek, "nathan").expectedPoints));

    fireEvent.click(within(root).getAllByRole("button", { name: "1" })[0]);
    expect(headers(root), "the column vanished on a week view").toContain("Exp Pts*");
    expect(row(root, "Nathan")["Pts"]).toBe(String(at(0, "nathan").points));
    expect(row(root, "Nathan")["Exp Pts*"]).toBe(String(at(0, "nathan").expectedPoints));

    /* And week 1's expectation is genuinely smaller than the season's, which
       is what makes the assertion above about accumulation and not about two
       ways of writing the same number. */
    expect(at(0, "nathan").expectedPoints).toBeLessThan(at(lastWeek, "nathan").expectedPoints);
  });

  test("and takes the records in the dropdown with it", async () => {
    /* The dropdown reads the same week as the row it hangs off. A record
       pinned to the season under a week view would be the same bug the
       columns were built to avoid, one tap further down. */
    stubFetch();
    const { container } = await renderPage();
    const root = container as unknown as HTMLElement;
    fireEvent.click(within(root).getAllByRole("button", { name: "1" })[0]);
    const at = data.byWeek[0].cumulative["nathan"] as any;
    expect(records(root, "Nathan")).toMatchObject({
      "Record": `${at.wins}-${at.losses}`,
      "Expected": `${at.expectedWins}-${at.expectedLosses}`,
    });
  });

  test("names the week the expectation has run to", async () => {
    stubFetch();
    const { container } = await renderPage();
    const root = container as unknown as HTMLElement;
    fireEvent.click(within(root).getAllByRole("button", { name: "1" })[0]);
    const summary = within(root).getByText(/Exp Pts is the points the closing lines expected/i);
    expect(summary.textContent).toMatch(/week 1/i);
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
