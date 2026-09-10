/**
 * The Trophies tab.
 *
 * Six cards drawn from `awards` in the always-fetched core, so unlike All
 * teams and Activity this tab has nothing to wait for and no lazy-file note.
 * What it does have is three shapes of plate - one holder, several, none - and
 * a payload that may not carry the key at all, which is the window where a
 * browser holds JS from after this shipped and the bot has not caught up.
 */

import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { buildAwards, markChanges } from "../lib/awards.mjs";
import { payload, renderPage, stubFetch } from "./helpers";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

/** Opens the tab and waits for the case to be on screen. */
const openCase = async () => {
  fireEvent.click(within(screen.getByRole("tablist")).getByRole("tab", { name: "Trophies" }));
  await waitFor(() => expect(document.querySelectorAll(".trophy").length).toBeGreaterThan(0));
};

/** The card for one award, found by the name engraved on its plate. */
const card = (label: string) => {
  const plate = screen.getByText(label);
  return plate.closest(".trophy") as HTMLElement;
};

/* A payload with `awards` replaced, so a test can put a shape on screen that
   the fixture does not happen to contain. Everything else stays real. */
const withAwards = (awards: any) => ({ ...payload, awards });

describe("the case as the fixture builds it", () => {
  test("six trophies, each with the name the builder engraved on it", async () => {
    stubFetch();
    await renderPage();
    await openCase();
    expect(document.querySelectorAll(".trophy").length).toBe(6);
    for (const a of payload.awards) {
      expect(card(a.label), `${a.id} has no card`).not.toBeNull();
    }
  });

  test("every trophy shows an icon that is not read out twice", async () => {
    /* The plate already names the award in text, so the drawing beside it is
       decoration and must be hidden from a screen reader rather than given a
       label that repeats the heading under it. */
    stubFetch();
    await renderPage();
    await openCase();
    for (const t of document.querySelectorAll(".trophy")) {
      const svg = t.querySelector("svg");
      expect(svg, "a trophy with no icon").not.toBeNull();
      expect(svg!.getAttribute("aria-hidden")).toBe("true");
    }
  });

  test("a chance reads as a percentage and a cover does not", async () => {
    /* The same number formatted by its own unit. 0.431 is a probability and
       must never appear as "0.431"; a cover is points and must never appear
       as a percentage. */
    const blowout = payload.awards.find((a: any) => a.id === "blowout");
    stubFetch();
    await renderPage();
    await openCase();
    expect(within(card("Biggest Upset")).getByText(/43%/)).toBeTruthy();
    const text = card("Blowout").textContent!;
    expect(text).toContain(`${blowout.holders[0].value} on the line`);
    expect(text).not.toMatch(new RegExp(`${blowout.holders[0].value}%`));
  });

  test("the blowout card carries both numbers a cover is made of", async () => {
    /* The score and the line it beat. One without the other asks the reader
       to take the subtraction on trust.

       Read off the payload rather than written out, because this holder is
       exactly the one that moves when the definition changes - naming the
       fixture's current winner here is how a test comes to assert last
       month's rule. */
    const blowout = payload.awards.find((a: any) => a.id === "blowout");
    const [score] = blowout.holders[0].detail.match(/\d+-\d+/)!;
    const [line] = blowout.holders[0].detail.match(/· ([^,]+),/)!.slice(1);
    stubFetch();
    await renderPage();
    await openCase();
    const text = card("Blowout").textContent!;
    expect(text, "the score is not on the card").toContain(score);
    expect(text, "the line it beat is not on the card").toContain(line.trim());
  });
});

describe("the three shapes a plate has to take", () => {
  const one = payload.awards.find((a: any) => a.holders.length === 1);
  const many = payload.awards.find((a: any) => a.holders.length > 1);

  test("a joint trophy names both holders", async () => {
    /* The fixture produces this on its own - two managers tied on the
       heartbreaker - so the joint path is exercised by real output and not
       only by a shape invented here. */
    expect(many, "the fixture no longer contains a tie").toBeTruthy();
    stubFetch();
    await renderPage();
    await openCase();
    for (const h of many.holders) {
      expect(card(many.label).textContent, `${h.manager} is not on the plate`)
        .toContain(h.manager);
    }
  });

  test("three or more holders name two and count the rest", async () => {
    /* A plate is 210px wide. Eight names on it is not a plate. */
    const awards = payload.awards.map((a: any) =>
      a.id === one.id
        ? { ...a, holders: ["ann", "bob", "cat"].map((manager, i) => ({
            manager, value: a.holders[0].value, detail: a.holders[0].detail })) }
        : a);
    stubFetch();
    vi.stubGlobal("fetch", vi.fn(() =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(withAwards(awards)) })));
    await renderPage();
    await openCase();
    const text = card(one.label).textContent!;
    expect(text).toContain("ann");
    expect(text).toContain("bob");
    expect(text).toContain("+1");
    expect(text).not.toContain("cat");
  });

  test("a trophy nobody holds says so, and shows no number", async () => {
    const awards = payload.awards.map((a: any) =>
      a.id === one.id ? { ...a, holders: [], runnerUp: null } : a);
    vi.stubGlobal("fetch", vi.fn(() =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(withAwards(awards)) })));
    await renderPage();
    await openCase();
    const text = card(one.label).textContent!;
    expect(text).toMatch(/Not awarded yet/i);
    /* The absence has to read as an absence. A zero here would be a claim. */
    expect(text).not.toMatch(/\b0\b/);
  });
});

describe("the badge, which is the point of the feature", () => {
  test("a trophy that changed hands is flagged and one that did not is not", async () => {
    const awards = payload.awards.map((a: any, i: number) => ({ ...a, changed: i === 0 }));
    vi.stubGlobal("fetch", vi.fn(() =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(withAwards(awards)) })));
    await renderPage();
    await openCase();
    expect(card(awards[0].label).querySelector(".flag")).not.toBeNull();
    expect(card(awards[1].label).querySelector(".flag")).toBeNull();
  });

  test("the flag says what it means to somebody who cannot see it", async () => {
    /* "NEW" beside a name is not a sentence. The accessible name has to be. */
    const awards = payload.awards.map((a: any, i: number) => ({ ...a, changed: i === 0 }));
    vi.stubGlobal("fetch", vi.fn(() =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(withAwards(awards)) })));
    await renderPage();
    await openCase();
    const flag = card(awards[0].label).querySelector(".flag")!;
    expect(flag.getAttribute("title")).toMatch(/changed hands/i);
  });
});

describe("the runner-up, which is what makes the case worth reloading", () => {
  test("the next manager down is named under the holder", async () => {
    const withNext = payload.awards.find((a: any) => a.runnerUp);
    expect(withNext, "the fixture has no runner-up to show").toBeTruthy();
    stubFetch();
    await renderPage();
    await openCase();
    expect(card(withNext.label).textContent).toContain(withNext.runnerUp.manager);
  });

  test("a trophy with nobody chasing it shows no runner-up line", async () => {
    const awards = payload.awards.map((a: any) => ({ ...a, runnerUp: null }));
    vi.stubGlobal("fetch", vi.fn(() =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(withAwards(awards)) })));
    await renderPage();
    await openCase();
    expect(document.querySelectorAll(".next").length).toBe(0);
  });
});

describe("a payload from before the trophy case shipped", () => {
  test("the tab renders its own sentence rather than throwing", async () => {
    /* The window this is for: a browser holding JS from after this deployed,
       against a payload the bot wrote before it. `awards` is simply absent,
       and an absent key must not reach a `.map`. */
    const { awards, ...older } = payload as any;
    vi.stubGlobal("fetch", vi.fn(() =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(older) })));
    await renderPage();
    fireEvent.click(within(screen.getByRole("tablist")).getByRole("tab", { name: "Trophies" }));
    expect(await screen.findByText(/no trophies in this update/i)).toBeTruthy();
    expect(document.querySelectorAll(".trophy").length).toBe(0);
  });
});

describe("the case fits the phone it is read on", () => {
  test("no plate is wider than the room a 375px screen leaves", async () => {
    /* The overflow suite audits table padding, and this tab has no tables, so
       its one width risk - a plate of fixed width beside two others - is
       asserted here instead. 375 less the wrap's 14px each side. */
    stubFetch();
    await renderPage();
    await openCase();
    const sheet = document.querySelector("style")!.textContent!;
    const fixed = [...sheet.matchAll(/\.(trophy|plate|icon)[^{]*\{([^}]*)\}/g)]
      .flatMap(([, sel, body]) => (body.match(/(?:^|;)\s*(?:min-)?width:\s*(\d+)px/g) ?? [])
        .map((d) => ({ sel, px: Number(d.match(/(\d+)px/)![1]) })))
      .filter(({ px }) => px > 375 - 28);
    expect(fixed, "a fixed width in the case is wider than a phone").toEqual([]);
  });
});

describe("the tab agrees with the library", () => {
  test("what the fixture shows is what buildAwards produces from it", async () => {
    /* The page renders the payload, and the payload is the builder's output.
       Restating the identity here means a component that started deriving its
       own holders - from `results`, say - would be caught by this file rather
       than by a season where the card and the run log disagree. */
    expect(payload.awards).toEqual(
      markChanges(buildAwards(payload),
                  buildAwards({ ...payload, through: payload.byWeek.length - 1 })));
  });
});
