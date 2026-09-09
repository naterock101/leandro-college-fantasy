/**
 * The leaderboard's two records, and the window between them.
 *
 * Act W-L is every settled game. Exp W-L is what the closing lines expected
 * over the settled games that had a line - a subset, which may or may not be a
 * proper one: the fixture leaves eight games unpriced and the live season
 * currently leaves none. Every assertion here is about that gap being handled
 * honestly in both directions:
 *
 * 1. **The column disappears rather than inventing numbers.** The record
 *    fields postdate the luck block, so a browser holding this JS can be
 *    handed a payload that has `luck` and none of them. The failure that
 *    reads as plausible is a column of `undefined-undefined`, or worse `0-0`,
 *    which says "expected to have played nothing" in the words of "we have
 *    nothing to say".
 * 2. **A manager with no priced game gets a dash, not a nought.** Same
 *    sentence, one row down.
 * 3. **The denominator is on screen.** Not in a tooltip, not behind the
 *    disclosure's fold: in the summary a reader sees without clicking.
 * 4. **And it is the true denominator.** A footnote that announces a mismatch
 *    when every settled game was priced is wrong in the same way and just as
 *    loudly as one that hides a real mismatch.
 */

import { describe, expect, test } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";

import { Leaderboard } from "../app/components/Leaderboard";
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

/** One manager's row, as `{ header: text }`. */
const row = (root: HTMLElement, manager: string) => {
  const cols = headers(root);
  const cell = within(root).getByText(manager).closest("tr")!;
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

  test("Act W-L is the standings record and Exp W-L is the ledger's", () => {
    const root = board(data).container as unknown as HTMLElement;
    /* Devish is 4-1 across every settled game and 2-1 across the three of them
       the books priced, which is exactly the gap this column has to survive:
       an expected record that adds up to fewer games than the actual one. */
    const r = row(root, "Devish");
    const standings = data.standings.find((s) => s.manager === "devish")!;
    const ledger = data.luck!.managers.devish;

    expect(r["Act W-L"]).toBe(`${standings.wins}-${standings.losses}`);
    expect(r["Exp W-L*"]).toBe(`${ledger.expectedWins}-${ledger.expectedLosses}`);
    expect(ledger.games, "the fixture stopped exercising the gap")
      .toBeLessThan(standings.wins + standings.losses);
  });

  test("a manager with no priced game reads as a dash, not as 0-0", () => {
    const root = board(data).container as unknown as HTMLElement;
    /* Leandro's one settled game was never priced. "Nothing to say" and
       "expected to be level at nothing" are different sentences. */
    expect(data.luck!.managers.leandro.games).toBe(0);
    expect(row(root, "Leandro")["Exp W-L*"]).toBe("-");
  });

  test("the games it does not cover are in the summary, not behind the fold", () => {
    board(data);
    /* getByText on the <summary> itself: a reader who never opens the
       disclosure still has to be told the two columns count different games,
       or the subtraction they do in their head is wrong. */
    const summary = screen.getByText(/Exp W-L is the record the closing lines expected/i);
    expect(summary.tagName).toBe("SUMMARY");
    expect(data.luck!.unpriced, "the fixture stopped exercising the mismatch")
      .toBeGreaterThan(0);
    expect(summary.textContent).toMatch(
      new RegExp(`${data.luck!.unpriced} settled games? had no line`)
    );
    expect(summary.textContent).toMatch(/not the same set as Act W-L/i);
  });

  test("and it does not claim a mismatch when there is not one", () => {
    /* The live payload today is 65 settled games with a line and none without,
       so the two columns cover exactly the same games and print the same
       denominators. A footnote insisting otherwise would be the most confident
       wrong sentence on the page - which is the thing this column's whole
       small print exists to avoid. */
    const priced = {
      ...data,
      luck: { ...data.luck!, unpriced: 0 },
    } as unknown as Data;
    board(priced);
    const summary = screen.getByText(/Exp W-L is the record the closing lines expected/i);
    expect(summary.textContent).not.toMatch(/not the same set/i);
    expect(summary.textContent).not.toMatch(/had no line/i);
    expect(summary.textContent).toMatch(/exactly the games Act W-L is/i);
  });
});

describe("payloads that predate the column", () => {
  /* The window this is about: a browser holding today's JS, handed a payload
     the bot wrote before the record fields existed. It has `luck`, so the old
     gate would have shown the column, and every cell would have read
     "undefined-undefined". */
  const legacy = {
    ...data,
    luck: {
      ...data.luck!,
      managers: Object.fromEntries(
        Object.entries(data.luck!.managers).map(([m, l]) => [
          m,
          { games: l.games, actual: l.actual, expected: l.expected, delta: l.delta },
        ])
      ),
    },
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

describe("a past week", () => {
  test("has no expected record, because byWeek carries no ledger", async () => {
    stubFetch();
    const { container } = await renderPage();
    const root = container as unknown as HTMLElement;
    expect(headers(root)).toContain("Exp W-L*");

    /* The week strip: "Live" and then one button per scored week. Picking a
       week replaces the live totals with that week's snapshot, and the ledger
       does not follow - so the column has to go rather than keep showing a
       season-to-date number against a one-week record. */
    fireEvent.click(within(root).getAllByRole("button", { name: "1" })[0]);
    expect(headers(root)).not.toContain("Exp W-L*");
    expect(headers(root)).toContain("Act W-L");
  });

  test("and drops the sentence that says Act W-L is the whole season", async () => {
    /* Under a week snapshot the column is that week's cumulative record, so
       "Act W-L is every settled game" is simply false - and with no Exp column
       beside it, the sentence has nothing left to distinguish anyway. */
    stubFetch();
    const { container } = await renderPage();
    const root = container as unknown as HTMLElement;
    expect(within(root).getByText(/Act W-L is every settled game/i)).toBeTruthy();

    fireEvent.click(within(root).getAllByRole("button", { name: "1" })[0]);
    expect(within(root).queryByText(/Act W-L is every settled game/i)).toBeNull();
    /* the rest of the caption is still there */
    expect(within(root).getByText(/Ceiling is current points/i)).toBeTruthy();
  });
});
