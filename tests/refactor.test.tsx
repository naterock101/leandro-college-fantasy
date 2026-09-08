/**
 * The proof that breaking `app/page.tsx` into components changed nothing.
 *
 * Asserting a refactor is safe is not the same as showing it, and a snapshot
 * of only the new page would have been written after the fact and agreed with
 * whatever it found. So the old file is kept alongside the new one for exactly
 * one commit, and both are driven through the same script against the same
 * payload: every tab, both Activity views, a week selected, a row expanded, a
 * dropdown opened, a search typed. After each step the two DOMs are compared
 * character for character.
 *
 * The stylesheet is compared separately and as a set of rules, because the
 * split reorders it: the same declarations arrive in the order the components
 * are composed rather than the order they were written down in one string. A
 * reordering is only safe where no two rules of equal specificity fight over
 * the same element, which is checked here by the rules being identical as a
 * set and reasoned about in components/Style.tsx for the handful of pairs
 * where it matters.
 *
 * This file and app/__legacy_page.tsx are both deleted by the accessibility
 * commit that follows, which changes the markup deliberately.
 */

import { describe, expect, test } from "vitest";
import { act, fireEvent, render } from "@testing-library/react";
import { vi } from "vitest";

import Legacy from "../app/__legacy_page";
import Page from "../app/page";
import { stubFetch, FIXTURE_NOW } from "./helpers";

/* The <style> is compared on its own terms below, so it comes out of the
   markup comparison rather than dominating it. */
const markup = (el: HTMLElement) => el.innerHTML.replace(/<style>[\s\S]*?<\/style>/, "<style/>");

const sheet = (el: HTMLElement) => el.querySelector("style")!.textContent ?? "";

/* Rules as a set of "context selector { declarations }" strings: order
   dropped, whitespace collapsed, and nested at-rules flattened so a rule
   inside `@media (max-width:430px)` is a different rule from the same
   selector outside it. Splitting on `}` instead was the first attempt and it
   is wrong for exactly the case that matters here - the narrow-screen block is
   one block in the old file and two in the new one, so a naive split reports
   a difference in text that has none in effect.

   Comment text is dropped: the comments moved with their rules, which is the
   point of the split, and a comment cannot change a computed style. */
function rules(css: string, context = ""): Set<string> {
  const out = new Set<string>();
  const src = css.replace(/\/\*[\s\S]*?\*\//g, "");
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf("{", i);
    if (open < 0) break;
    let depth = 1;
    let j = open + 1;
    while (j < src.length && depth > 0) {
      if (src[j] === "{") depth++;
      else if (src[j] === "}") depth--;
      j++;
    }
    const head = src.slice(i, open).replace(/\s+/g, " ").trim();
    const body = src.slice(open + 1, j - 1);
    if (head.startsWith("@")) for (const r of rules(body, `${context}${head} `)) out.add(r);
    else out.add(`${context}${head}{${body.replace(/\s+/g, " ").trim()}}`);
    i = j;
  }
  return out;
}

async function mount(Component: () => React.JSX.Element) {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(FIXTURE_NOW);
  stubFetch();
  const view = render(<Component />);
  /* Two awaited ticks: the core fetch, then the lazy file a tab asks for. */
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  return view;
}

/* Every step is driven by what is on screen rather than by a selector, so the
   same script runs against both trees without knowing anything about how
   either is built. */
const script: { name: string; run: (el: HTMLElement) => void }[] = [
  { name: "first paint, leaderboard", run: () => {} },
  {
    name: "week 2 selected",
    run: (el) => fireEvent.click([...el.querySelectorAll(".weeks button")][2]),
  },
  {
    name: "back to live",
    run: (el) => fireEvent.click([...el.querySelectorAll(".weeks button")][0]),
  },
  {
    name: "a manager expanded",
    run: (el) => fireEvent.click(el.querySelectorAll("tbody tr.row")[0]),
  },
  { name: "games of the week, picker open", run: (el) => fireEvent.click(el.querySelector(".dd .ddbtn")!) },
  {
    name: "games of the week filtered to one manager",
    run: (el) => fireEvent.click(el.querySelectorAll(".ddmenu .ddopt input")[1]),
  },
  { name: "all teams", run: (el) => fireEvent.click(el.querySelectorAll(".tabs button")[1]) },
  { name: "all teams, picker open", run: (el) => fireEvent.click(el.querySelector(".dd .ddbtn")!) },
  {
    name: "all teams, one conference",
    run: (el) => fireEvent.click(el.querySelectorAll(".ddmenu .ddopt input")[2]),
  },
  {
    name: "all teams, drafted only",
    run: (el) => fireEvent.click(el.querySelectorAll(".seg button")[1]),
  },
  {
    name: "all teams, searched",
    run: (el) =>
      fireEvent.change(el.querySelector(".search")!, { target: { value: "texas am" } }),
  },
  {
    name: "all teams, search with no hit",
    run: (el) =>
      fireEvent.change(el.querySelector(".search")!, { target: { value: "zzz" } }),
  },
  { name: "activity, head to head", run: (el) => fireEvent.click(el.querySelectorAll(".tabs button")[2]) },
  {
    name: "activity, timeline",
    run: (el) => fireEvent.click(el.querySelectorAll(".seg button")[1]),
  },
  { name: "activity, picker open", run: (el) => fireEvent.click(el.querySelector(".dd .ddbtn")!) },
  {
    name: "activity, timeline filtered",
    run: (el) => fireEvent.click(el.querySelectorAll(".ddmenu .ddopt input")[3]),
  },
  { name: "back to the leaderboard", run: (el) => fireEvent.click(el.querySelectorAll(".tabs button")[0]) },
];

/* One step, then the microtasks it set off. Opening a tab for the first time
   asks for that tab's payload file, and the option list the next step clicks
   into does not exist until that request has resolved. */
async function step_(el: HTMLElement, step: { run: (el: HTMLElement) => void }) {
  await act(async () => {
    step.run(el);
    await vi.advanceTimersByTimeAsync(0);
  });
}

describe("the component split", () => {
  test("renders exactly what the single file rendered, at every step", async () => {
    const before = await mount(Legacy as any);
    const beforeEl = before.container;
    const shots: Record<string, string> = {};
    for (const step of script) {
      await step_(beforeEl, step);
      shots[step.name] = markup(beforeEl);
    }
    const beforeSheet = sheet(beforeEl);
    before.unmount();

    const after = await mount(Page as any);
    const afterEl = after.container;
    for (const step of script) {
      await step_(afterEl, step);
      expect(markup(afterEl), `diverged at: ${step.name}`).toBe(shots[step.name]);
    }

    /* One rule is deliberately not carried over: `.toggle` styled a control
       that no longer exists, and nothing in the page has that class. Dropping
       it changes no computed style, and it is named here rather than quietly
       filtered so that a second orphan cannot join it unnoticed. */
    const was = rules(beforeSheet);
    const is = rules(sheet(afterEl));
    expect([...was].filter((r) => !is.has(r))).toEqual([
      ".toggle{display:flex;gap:7px;align-items:center;font-size:12.5px;color:var(--muted);margin-bottom:4px}",
    ]);
    expect([...is].filter((r) => !was.has(r))).toEqual([]);
  });
});
