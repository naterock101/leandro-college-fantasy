/**
 * The horizontal overflow audit, resolved rather than eyeballed.
 *
 * At 375px the page scrolled sideways in four places, and every one of them
 * was invisible from the rule that caused it. The All teams table was 402px
 * wide because a narrow-screen `td{padding-left:2px}` was quietly outranked by
 * `.tt td{padding:8px 5px}` - the same declaration, one class more specific,
 * so source order never got a say. The three game rows overran for the same
 * underlying reason from two directions: `.mu` is the only child of `.gow`
 * that can give ground, and both times something stopped it. In the two
 * Activity lists an `.upset` marker reading "upset · Western Kentucky -1.5"
 * was `white-space:nowrap`, which put a 216px floor under a column with 198px
 * to spend. In games of the week a spread that does not shrink took the room
 * first, leaving 59px for a column that could not go below 75. Every one of
 * these is a rule on screen that is not the rule in the file, which is why
 * this is a resolver and not a grep: the sheet is parsed, the cascade is run
 * against the real DOM at a phone width, and the assertions are about the
 * declaration that actually wins.
 *
 * The fifth was the manager dropdown, found later and by the same means:
 * `.detail td` writes its own padding and so was never reached by the
 * narrow-screen `td` rule, and the squad's points - the column the dropdown
 * exists to show - sat off the right-hand edge. It is audited here now, which
 * needs a row opened first: a dropdown nobody has clicked renders no markup to
 * measure, and a suite that only walks the closed table cannot see it.
 *
 * The numbers below were measured in Chrome at 375px before the fix - table
 * 402.3px against 347px of room, `.stakes` at x=377.6, `.score` at x=379.8 -
 * and the character bound in the last suite is a proxy for that measurement,
 * not a second guess at it. jsdom has no layout engine, so what it can check
 * is which rule applies to which element and what text that element holds;
 * the widths themselves stay the browser's job.
 */

import { describe, expect, test } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";

import { sheet } from "../app/components/Style";
import { renderPage, stubFetch } from "./helpers";

/* The viewport the league actually reads this on, and the frame it leaves for
   content: `.wrap` spends 14px a side on padding. */
const PHONE = 375;
const ROOM = PHONE - 28;

/* What `.mu` needs to hold a wrapped school name. The longest single word in
   the fixture is "International" at 13px, which Chrome measures at 75px; this
   is that with room to spare, because the floor is set by whatever word the
   next draft brings rather than by the ones already here. */
const MU_MIN = 96;

/* An unbreakable run is only a problem when it is wider than the column has
   to give, so the bound is MU_MIN rather than a number of its own: the marker
   text is 11px, which Chrome measures at a shade under 6px a character. That
   fails "upset · Western Kentucky -1.5" at 216px and passes " undrafted" and
   " own goal", which is the line the browser drew. */
const NOWRAP_MAX = Math.floor(MU_MIN / 6);

type Rule = { selector: string; decls: Record<string, string>; narrow: boolean };

/* `padding` and `flex` are the two shorthands this sheet writes and this file
   asks about, and a shorthand that is never expanded is a rule the resolver
   cannot see - which is the exact blindness the padding bug lived in. */
const expand = (prop: string, value: string): Record<string, string> => {
  if (prop === "padding") {
    const p = value.split(/\s+/);
    const [t, r, b, l] = [p[0], p[1] ?? p[0], p[2] ?? p[0], p[3] ?? p[1] ?? p[0]];
    return { "padding-top": t, "padding-right": r, "padding-bottom": b, "padding-left": l };
  }
  if (prop === "flex") {
    const p = value.split(/\s+/);
    return p.length === 1 && /^\d+$/.test(p[0])
      ? { "flex-grow": p[0], "flex-shrink": "1", "flex-basis": "0%" }
      : { "flex-grow": p[0], "flex-shrink": p[1] ?? "1", "flex-basis": p[2] ?? "0%" };
  }
  return { [prop]: value };
};

/**
 * Every rule in the sheet, in source order, with the ones inside a media query
 * that holds at 375px marked. A query that does not hold at this width is
 * dropped, and so is every other at-rule - `@keyframes` has no cascade to
 * take part in.
 */
const parse = (css: string): Rule[] => {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules: Rule[] = [];
  const emit = (text: string, narrow: boolean) => {
    for (const [, selectors, body] of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const decls: Record<string, string> = {};
      for (const d of body.split(";")) {
        const i = d.indexOf(":");
        if (i > 0) Object.assign(decls, expand(d.slice(0, i).trim(), d.slice(i + 1).trim()));
      }
      for (const sel of selectors.split(",")) rules.push({ selector: sel.trim(), decls, narrow });
    }
  };
  let i = 0;
  while (i < clean.length) {
    const at = clean.indexOf("@", i);
    emit(clean.slice(i, at < 0 ? clean.length : at), false);
    if (at < 0) break;
    const open = clean.indexOf("{", at);
    let depth = 1;
    let j = open + 1;
    for (; j < clean.length && depth > 0; j++) {
      if (clean[j] === "{") depth += 1;
      else if (clean[j] === "}") depth -= 1;
    }
    const held = clean.slice(at, open).match(/^@media[^{]*max-width:\s*(\d+)px/);
    if (held && PHONE <= Number(held[1])) emit(clean.slice(open + 1, j - 1), true);
    i = j;
  }
  return rules;
};

const rules = parse(sheet);

/* a, b, c as CSS Selectors 4 counts them. Nothing here carries an id or an
   !important, so this and source order settle every contest in the sheet. */
const specificity = (sel: string) => {
  const b = (sel.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g) ?? []).length;
  const c = (sel.replace(/:{1,2}[\w-]+(\([^)]*\))?/g, " ").match(/(^|[\s>+~])[a-z][\w-]*/gi) ?? []).length;
  return b * 100 + c;
};

/**
 * The declaration that wins for `prop` on `el` at 375px: highest specificity,
 * and among equals the last one written. jsdom does the matching, which is
 * what makes this the real cascade over the real markup rather than a reading
 * of the selectors.
 */
const winner = (el: Element, prop: string): Rule | undefined => {
  let best: Rule | undefined;
  let bestSpec = -1;
  for (const r of rules) {
    if (!(prop in r.decls)) continue;
    let hit = false;
    try {
      hit = el.matches(r.selector);
    } catch {
      continue;
    }
    if (!hit) continue;
    const spec = specificity(r.selector);
    if (spec >= bestSpec) [best, bestSpec] = [r, spec];
  }
  return best;
};

const px = (v: string | undefined) => (v && /^-?[\d.]+px$/.test(v) ? parseFloat(v) : undefined);
const value = (el: Element, prop: string) => winner(el, prop)?.decls[prop];

/* The four things a reader can have on screen. Every one of them was over. */
const views = ["Leaderboard", "All teams", "Activity", "Activity timeline"] as const;

/* All teams and Activity live in payload files the page fetches only once the
   tab is asked for, so a switch that is not waited on leaves an empty section
   and an audit with nothing to audit - which is how two of these suites
   passed against the very markup they were written to fail on. */
const show = async (view: (typeof views)[number]) => {
  const tab = view === "Activity timeline" ? "Activity" : view;
  fireEvent.click(within(screen.getByRole("tablist")).getByRole("tab", { name: tab }));
  if (view === "Activity timeline") {
    fireEvent.click(await screen.findByRole("button", { name: "Timeline" }));
  }
  const rows = view === "All teams" ? ".tt td" : ".gow";
  await waitFor(() => expect(document.querySelectorAll(rows).length).toBeGreaterThan(0));
};

describe("the narrow-screen padding reaches every table", () => {
  /* The All teams table rendered 402.3px into 347px of room and cut the
     Drafter and Pts columns off the right-hand edge. The narrow-screen rule
     that was supposed to prevent it was written for `td` and lost to a `.tt
     td` written for a font size, which had no opinion about padding at all -
     it just happened to restate it. */
  test("no cell keeps its full-width padding at 375px", async () => {
    stubFetch();
    await renderPage();

    const wide: string[] = [];
    for (const view of views) {
      await show(view);
      for (const cell of document.querySelectorAll("td")) {
        for (const side of ["padding-left", "padding-right"]) {
          const rule = winner(cell, side);
          if (!rule?.narrow) {
            wide.push(`${view}: ${rule?.selector ?? "?"} sets ${side} on .${cell.className || "td"}`);
          }
        }
      }
    }
    expect(
      [...new Set(wide)],
      "a more specific rule is outranking the narrow-screen padding"
    ).toEqual([]);
  });
});

describe("a manager's dropdown fits the phone it is read on", () => {
  /* The failure this is about was invisible from the sheet in the same way
     the All teams one was, and for the same reason: `.detail td` sets its own
     padding, which is one class more specific than the narrow-screen `td`
     rule, so the dropdown kept its full-width padding inside a table that had
     already given its up. Sitting inside a table wider than the screen, the
     column the dropdown exists to show - what each of your teams has scored -
     was the one hanging off the right-hand edge. */
  const dropdown = async () => {
    stubFetch();
    await renderPage();
    fireEvent.click(document.querySelectorAll<HTMLElement>(".rowtoggle")[0]);
    const cell = document.querySelector(".detail td");
    expect(cell, "no manager dropdown opened").not.toBeNull();
    return cell as HTMLElement;
  };

  /* A fixed column's width, from the sheet or from the inline style the logo
     carries - the crest is sized in the component rather than the stylesheet,
     and a resolver that only reads the sheet would call it unbounded. */
  const fixed = (el: Element) =>
    px((el as HTMLElement).style.width || undefined) ?? px(value(el, "width"));

  test("its cell gives up the padding every other cell gives up", async () => {
    const cell = await dropdown();
    for (const side of ["padding-left", "padding-right"]) {
      const rule = winner(cell, side);
      expect(rule?.narrow,
        `${rule?.selector} is outranking the narrow-screen ${side} on the dropdown`)
        .toBe(true);
    }
  });

  test("the squad's points stay on screen", async () => {
    const cell = await dropdown();
    const room = ROOM - (px(value(cell, "padding-left")) ?? 0)
                      - (px(value(cell, "padding-right")) ?? 0);
    const tight: string[] = [];
    for (const team of cell.querySelectorAll(".team")) {
      const gap = px(value(team, "gap")) ?? 0;
      let taken = 0;
      let columns = 0;
      for (const child of team.children) {
        columns += 1;
        /* the school name is the one thing here that may shrink and wrap */
        if (child.matches(".tn")) continue;
        const w = fixed(child);
        if (w === undefined) {
          tight.push(
            `.${child.className.split(" ").pop()} has no width and does not shrink, ` +
              `so "${child.textContent?.trim().slice(0, 30)}" sets its own`
          );
          continue;
        }
        taken += w;
      }
      const left = room - taken - gap * Math.max(0, columns - 1);
      if (left < MU_MIN) {
        tight.push(`the fixed columns leave the team name ${left}px, under ${MU_MIN}`);
      }
    }
    expect([...new Set(tight)], "this squad row cannot fit 375px").toEqual([]);
  });

  test("nothing in a squad row is both unbreakable and long", async () => {
    /* The failure the widths above cannot see, and the one that actually
       shipped: the school was `white-space:nowrap` with an ellipsis, so its
       min-content was the whole of "Middle Tennessee Blue Raiders". Inside a
       table that is not one row overflowing - the detail cell spans every
       column, so its floor is the *table's* floor, and the leaderboard came
       out 27px wider than the phone with the squad's points hanging off the
       edge. Which is why the bound is a character count and not a width:
       jsdom cannot lay the row out, but it can see that a rule which forbids
       wrapping is sitting on a string far too long to fit. */
    const cell = await dropdown();
    const unbreakable: string[] = [];
    for (const row of cell.querySelectorAll(".team")) {
      for (const part of row.querySelectorAll("*")) {
        if (value(part, "white-space") !== "nowrap") continue;
        const text = part.textContent ?? "";
        if (text.length > NOWRAP_MAX) {
          unbreakable.push(
            `.${part.className} holds ${text.length} unbreakable characters, "${text.trim()}"`
          );
        }
      }
    }
    expect(
      [...new Set(unbreakable)],
      "let this wrap at 430px, or the table cannot shrink past it"
    ).toEqual([]);
  });

  test("and the three records wrap rather than pushing the line wider", async () => {
    /* Three labelled records is more than a 375px line holds. They are allowed
       to take two lines; what they may not do is set a floor under the width
       of a row inside a table that has none to give. */
    const cell = await dropdown();
    const recs = cell.querySelector(".recs")!;
    expect(value(recs, "flex-wrap"), "the records cannot wrap").toBe("wrap");
  });
});

describe("a game row fits the phone it is read on", () => {
  /* `.gow` is one flex line: a date, the matchup, and some number of fixed
     columns. Only `.mu` grows and shrinks, so every pixel the fixed columns
     take is a pixel it does not have - and when the fixed columns take too
     many, nothing gives and the page scrolls. */
  test("the fixed columns leave the matchup room to sit in", async () => {
    stubFetch();
    await renderPage();

    const tight: string[] = [];
    for (const view of views) {
      await show(view);
      for (const row of document.querySelectorAll(".gow")) {
        const gap = px(value(row, "gap")) ?? 0;
        let fixed = 0;
        let columns = 0;
        for (const child of row.children) {
          /* A child given the whole line at this width has left the row and
             is not competing for it. That is how the spread gets to keep its
             own words on a phone. */
          if (value(child, "flex-basis") === "100%") continue;
          columns += 1;
          if (child.matches(".mu")) continue;
          const w = px(value(child, "width"));
          if (w === undefined) {
            tight.push(
              `${view}: .${child.className.split(" ").pop()} has no width and does not shrink, ` +
                `so "${child.textContent?.trim().slice(0, 30)}" sets its own`
            );
            continue;
          }
          fixed += w;
        }
        const left = ROOM - fixed - gap * Math.max(0, columns - 1);
        if (left < MU_MIN) {
          tight.push(`${view}: fixed columns leave the matchup ${left}px, under ${MU_MIN}`);
        }
      }
    }
    expect([...new Set(tight)], "this row cannot fit 375px").toEqual([]);
  });

  /* The failure the widths above cannot see. `.mu` is allowed to wrap, so its
     floor is its longest unbreakable run - and a `white-space:nowrap` on
     something inside it makes that run as long as the sentence. The upset
     marker was 29 characters, which Chrome measured at 216px against the
     198px the column had, and both Activity views scrolled sideways for it. */
  test("nothing inside the matchup is both unbreakable and long", async () => {
    stubFetch();
    await renderPage();

    const unbreakable: string[] = [];
    for (const view of views) {
      await show(view);
      for (const mu of document.querySelectorAll(".gow .mu")) {
        for (const part of mu.querySelectorAll("*")) {
          if (value(part, "white-space") !== "nowrap") continue;
          const text = part.textContent ?? "";
          if (text.length > NOWRAP_MAX) {
            unbreakable.push(
              `${view}: .${part.className} holds ${text.length} unbreakable characters, "${text.trim()}"`
            );
          }
        }
      }
    }
    expect(
      [...new Set(unbreakable)],
      "let this wrap at 430px, or the matchup column cannot shrink past it"
    ).toEqual([]);
  });
});
