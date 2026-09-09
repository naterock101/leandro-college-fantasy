/**
 * A heading sits over its own column, in every table, at every width.
 *
 * The bug this exists for was two rules that disagreed: `.r` right-aligned the
 * cells and `th.r` centred the headings. A column is as wide as whichever of
 * the two is wider, so wherever the heading was the wider one - "PTS" at 30px
 * over "24" at 22px, "CEIL" over "282" - the label floated left of its own
 * numbers and the table read as slightly broken. Right where the numbers were
 * wider, the label drifted the other way. Nothing was wrong with either rule
 * on its own, which is exactly why this needs a test rather than an eye.
 *
 * There is one class per column now, worn by the heading and the cells alike,
 * which is why the check below is about agreement rather than about any
 * particular alignment.
 *
 * There was a second one, older and never noticed: All teams marked `Drafter`
 * with the cells' own class while its cells took their alignment from `.owner`
 * instead, so that heading agreed with its column only because both happened
 * to say right.
 *
 * The check is the invariant rather than the values - it does not care whether
 * a column is centred, left or right, only that its heading and its cells
 * agree. That way it goes on holding if the design changes its mind, and it
 * fails the moment a new column picks an alignment its heading does not share.
 *
 * jsdom has no cascade of its own worth trusting for this, so the sheet is
 * parsed and resolved the same way tests/overflow.test.tsx resolves padding:
 * real selectors matched against the real DOM, highest specificity wins, and
 * source order settles a tie.
 */

import { describe, expect, test } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";

import { sheet } from "../app/components/Style";
import { renderPage, stubFetch } from "./helpers";

type Rule = { selector: string; decls: Record<string, string> };

/* Every rule in the sheet, in source order, media queries included: alignment
   is not something this page changes by width, and a narrow-screen override
   that did would be a thing this test should see rather than skip. */
const parse = (css: string): Rule[] => {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules: Rule[] = [];
  for (const [, selectors, body] of clean.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
    const decls: Record<string, string> = {};
    for (const d of body.split(";")) {
      const i = d.indexOf(":");
      if (i > 0) decls[d.slice(0, i).trim()] = d.slice(i + 1).trim();
    }
    for (const sel of selectors.split(",")) {
      const selector = sel.trim();
      if (selector && !selector.startsWith("@")) rules.push({ selector, decls });
    }
  }
  return rules;
};

const rules = parse(sheet);

/* a, b, c as Selectors 4 counts them; nothing in this sheet carries an id or
   an !important, so this and source order settle every contest. */
const specificity = (sel: string) => {
  const b = (sel.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g) ?? []).length;
  const c = (sel.replace(/:{1,2}[\w-]+(\([^)]*\))?/g, " ").match(/(^|[\s>+~])[a-z][\w-]*/gi) ?? []).length;
  return b * 100 + c;
};

/**
 * The `text-align` that actually applies to `el`.
 *
 * Falls back to the element's own default when no rule matches, which is the
 * one place the user agent has an opinion worth encoding: a `th` centres and a
 * `td` starts. That default is half the bug - an unstyled `th` over unstyled
 * `td`s is centred over left-aligned text and nobody wrote a line of CSS to
 * make it so.
 */
const alignOf = (el: Element): string => {
  let best: string | undefined;
  let bestSpec = -1;
  for (const r of rules) {
    if (!("text-align" in r.decls)) continue;
    let hit = false;
    try {
      hit = el.matches(r.selector);
    } catch {
      continue;
    }
    if (!hit) continue;
    const spec = specificity(r.selector);
    if (spec >= bestSpec) [best, bestSpec] = [r.decls["text-align"], spec];
  }
  if (best) return best;
  return el.tagName === "TH" ? "center" : "left";
};

/* Every table a reader can reach. Activity and Games of the week are not here
   because they are not tables: they are flex rows with no heading row to be
   out of line with, which is tests/overflow.test.tsx's territory instead.
   Trends is, and its head-to-head matrix already agrees with itself - which is
   the point of auditing it rather than the two that were wrong. */
const views = ["Leaderboard", "All teams", "Trends"] as const;

/* A tab whose payload arrives separately has nothing to audit until it lands,
   which is how a sweep like this passes by finding no columns at all. */
const settled: Partial<Record<(typeof views)[number], string>> = {
  "All teams": ".tt td",
  Trends: ".h2hm td",
};

const show = async (view: (typeof views)[number]) => {
  fireEvent.click(within(screen.getByRole("tablist")).getByRole("tab", { name: view }));
  const marker = settled[view];
  if (marker) {
    await waitFor(() => expect(document.querySelectorAll(marker).length).toBeGreaterThan(0));
  }
};

/** Every column of a table as `{ heading, cells }`, by index. */
const columns = (table: HTMLTableElement) => {
  const headings = [...table.querySelectorAll("thead th")];
  return headings.map((th, i) => ({
    index: i,
    label: th.textContent!.trim() || "(unlabelled)",
    heading: th,
    /* A detail row spans the whole table and has no column of its own, so it
       is not one of these cells: colSpan is how it says so. */
    cells: [...table.querySelectorAll("tbody tr")]
      .filter((tr) => !tr.matches(".detail"))
      .map((tr) => tr.children[i])
      .filter((td): td is Element => Boolean(td) && (td as HTMLTableCellElement).colSpan === 1),
  }));
};

describe("every heading is aligned like its own column", () => {
  test.each(views)("%s", async (view) => {
    stubFetch();
    await renderPage();
    await show(view);

    const tables = [...document.querySelectorAll("table")] as HTMLTableElement[];
    expect(tables.length, `${view} rendered no table`).toBeGreaterThan(0);

    /* Counted, and asserted on at the end: every failure mode of this sweep
       ends in "found nothing and passed", and a view whose table rendered
       without a body is one of them. */
    let checked = 0;
    const wrong: string[] = [];
    for (const table of tables) {
      for (const col of columns(table)) {
        if (!col.cells.length) continue;
        checked += 1;
        const heading = alignOf(col.heading);
        const cells = [...new Set(col.cells.map(alignOf))];
        if (cells.length > 1) {
          wrong.push(`${view}: the "${col.label}" column aligns its own cells ${cells.join(" and ")}`);
          continue;
        }
        if (heading !== cells[0]) {
          wrong.push(`${view}: "${col.label}" is ${heading} over cells that are ${cells[0]}`);
        }
      }
    }
    expect([...new Set(wrong)], "a heading does not sit over its column").toEqual([]);
    expect(checked, `${view}: no column had both a heading and cells`).toBeGreaterThan(2);
  });

  test("including the columns that only exist once a manager is open", async () => {
    /* The detail row is skipped by the sweep above - it spans every column -
       so opening one has to leave the header row still describing the table. */
    stubFetch();
    await renderPage();
    fireEvent.click(document.querySelectorAll<HTMLElement>(".rowtoggle")[0]);
    expect(document.querySelector(".detail"), "no dropdown opened").not.toBeNull();

    const table = document.querySelectorAll("table")[0] as HTMLTableElement;
    for (const col of columns(table)) {
      if (!col.cells.length) continue;
      expect(alignOf(col.heading), `"${col.label}" after opening a dropdown`)
        .toBe(alignOf(col.cells[0]));
    }
  });
});
