/**
 * The ESPN overlay on "On the field".
 *
 * Two things are being tested and they pull in opposite directions. The first
 * is that the overlay works: a live score and a game clock, joined to our own
 * games by id. The second is that it is never load-bearing - ESPN is an
 * undocumented endpoint with no contract, so every way it can fail has to land
 * back on the block as it was drawn before this existed.
 *
 * The degradation cases are therefore not asserted one field at a time. They
 * are asserted as *identity*: unreachable, refused, garbage, reshaped and
 * empty must all produce byte-identical HTML, and that HTML must be the
 * kickoff-time-and-no-score rendering. Asserting "no score is shown" would
 * pass on a block that had lost half its content on the way.
 *
 * Hermetic: fetch is stubbed and the payload is fixtures/espn-scoreboard.json,
 * captured from the live endpoint on 2026-09-08 for the Saturday before.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

import { LIVE_WINDOW_MS } from "../lib/games.mjs";
import { LiveGames } from "../app/components/LiveGames";
import { espnDay, parseScoreboard, POLL_MS } from "../app/hooks/useLiveScores";
import scoreboard from "../fixtures/espn-scoreboard.json" with { type: "json" };
import type { Game } from "../app/types";

/* The fixture's three events. Two were mutated into an in-progress status
   because nothing was live at the moment of capture - a Tuesday - and the
   fields that mutation touches (period, displayClock, type.state) are the
   whole point of the overlay. Everything else, ids and scores and the
   Eastern-day boundary below, is exactly as ESPN returned it. */
const OREGON = "401858433";      // Boise State at Oregon, 19:30Z Sat, Q3 7:42, 17-21
const ASU = "401856774";         // Morgan State at Arizona State, 02:00Z *Sunday*
const MICHIGAN = "401858428";    // Western Michigan at Michigan, real, final at 12-13

/* 20:30Z on the Saturday: an hour into the Oregon game, so it is live by
   lib/games.mjs and the whole block has something to draw. */
const NOW = new Date("2026-09-05T20:30:00.000Z");

const game = (id: string | number, date: string, away: string, home: string): Game => ({
  id,
  date,
  away: { team: away, manager: "nathan", tier: "p4", draft: away },
  home: { team: home, manager: "clint", tier: "p4", draft: home },
  neutral: false, sameManager: false, stakes: 3, h2h: true, spread: null,
} as unknown as Game);

const oregonGame = () => game(OREGON, "2026-09-05T19:30:00.000Z", "Boise State", "Oregon");
/* Same two schools as the fixture's final, a different id. Nothing may join on
   the names: this row must stay exactly as the payload wrote it. */
const michiganByName = () => game(9_000_001, "2026-09-05T19:45:00.000Z", "Western Michigan", "Michigan");
const asuGame = () => game(ASU, "2026-09-06T02:00:00.000Z", "Morgan State", "Arizona State");

type Call = { url: string };

/** Serves the fixture to any scoreboard URL. `mode` picks a way of failing. */
function stubEspn(mode: "ok" | "unreachable" | "refused" | "garbage" | "reshaped" | "empty" = "ok") {
  const calls: Call[] = [];
  const spy = vi.fn((url: string) => {
    calls.push({ url });
    switch (mode) {
      case "unreachable":
        return Promise.reject(new TypeError("Failed to fetch"));
      case "refused":
        return Promise.resolve({ ok: false, status: 429, json: () => Promise.reject(new Error("no")) });
      case "garbage":
        /* An HTML error page with a 200 on it, which is what a CDN in front of
           a broken origin actually serves. */
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.reject(new SyntaxError("Unexpected token <")) });
      case "reshaped":
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ events: { items: [{ gameId: OREGON }] } }) });
      case "empty":
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ events: [] }) });
      default:
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(scoreboard) });
    }
  });
  vi.stubGlobal("fetch", spy);
  return calls;
}

async function draw(games: Game[]) {
  const view = render(<LiveGames games={games} generatedAt="2026-09-05T20:25:00.000Z" />);
  /* The fetch resolves a microtask later; without this every assertion would
     run against the pre-overlay render and the passing ones would pass for
     the wrong reason. */
  await act(async () => {});
  return view;
}

/* A row is addressed by position rather than by the school in it: TeamName
   renders a bare text node with no element of its own, deliberately, so
   getByText has nothing to hand back. */
const rows = (el: ParentNode) => Array.from(el.querySelectorAll(".gow"));
const text = (el: ParentNode, i = 0) => rows(el)[i].textContent ?? "";

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(NOW);
  /* A document left hidden by an earlier test outlives it, and a hook that
     schedules nothing reads as the feature being broken. */
  Object.defineProperty(document, "hidden", { value: false, configurable: true });
});
afterEach(() => { vi.useRealTimers(); });

async function setHidden(hidden: boolean) {
  Object.defineProperty(document, "hidden", { value: hidden, configurable: true });
  await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
}

async function advance(ms: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

/* ------------------------------------------------------------------ */

describe("the join", () => {
  test("is by id, so a live game gets its clock and its score", async () => {
    stubEspn();
    const { container } = await draw([oregonGame()]);
    expect(text(container)).toContain("Q3 7:42");
    /* Away first, which is the order the row reads in and the order the
       builder's own partial score already used. */
    expect(text(container)).toContain("17-21");
  });

  test("is not by name: same two schools, different id, untouched", async () => {
    stubEspn();
    const { container } = await draw([michiganByName()]);
    expect(text(container), "a name match must not be allowed to score a game")
      .not.toContain("12-13");
    expect(text(container)).not.toContain("Final");
  });

  test("leaves a game ESPN has never heard of exactly as the payload wrote it", async () => {
    stubEspn();
    const { container } = await draw([oregonGame(), michiganByName()]);
    expect(text(container, 0)).toContain("Q3 7:42");
    expect(text(container, 1)).toBe(text(await baseline([michiganByName()])));
  });

  test("carries an untouched real event through to the row", async () => {
    /* The other cases lean on the two events whose status was rewritten into
       an in-progress one. This one is exactly as ESPN returned it - a real
       final, a real 12-13 - so the parse is pinned against a payload nobody
       here has had a hand in. */
    stubEspn();
    const { container } = await draw([game(MICHIGAN, "2026-09-05T19:45:00.000Z", "Western Michigan", "Michigan")]);
    expect(text(container)).toContain("Final");
    expect(text(container)).toContain("12-13");
  });

  test("says what ESPN says when the game is not in play", async () => {
    stubEspn();
    /* Halftime: state is still "in" but the clock reads 0:00, so composing
       "Q2 0:00" from the primitives would be wrong where ESPN's own word is
       right.

       An hour into the 02:00Z kickoff, which is the small hours of Sunday in
       UTC and still Saturday night in the east - so this is also the case
       where a UTC-derived date would ask for the wrong day and get nothing. */
    vi.setSystemTime(new Date("2026-09-06T03:00:00.000Z"));
    const calls = stubEspn();
    const { container } = await draw([asuGame()]);
    expect(calls[0].url).toContain("dates=20260905");
    expect(text(container)).toContain("Halftime");
  });
});

/* ------------------------------------------------------------------ */

/** The block as it is drawn with no overlay at all: the thing to fall back to. */
async function baseline(games: Game[]) {
  stubEspn("unreachable");
  const { container } = await draw(games);
  const html = container.innerHTML;
  cleanup();
  const holder = document.createElement("div");
  holder.innerHTML = html;
  return holder;
}

describe("degradation", () => {
  const modes = ["unreachable", "refused", "garbage", "reshaped", "empty"] as const;

  test("every way ESPN can fail draws the same block, and it is today's block", async () => {
    const games = [oregonGame(), asuGame()];
    const rendered: string[] = [];
    for (const mode of modes) {
      stubEspn(mode);
      const { container } = await draw(games);
      rendered.push(container.innerHTML);
      cleanup();
    }
    for (let i = 1; i < rendered.length; i++) {
      expect(rendered[i], `${modes[i]} drew a different block from ${modes[0]}`).toBe(rendered[0]);
    }
    /* And that shared block is the pre-overlay one: two rows, a kickoff time
       each, and nothing from ESPN in any of them.

       "The same as today" was also checked directly while this was written, by
       rendering the component as it stood at 5f4c006 beside this one over the
       same games with fetch rejecting, and diffing the HTML: identical, byte
       for byte. That check cannot be kept - it needs a copy of the old
       component, which would be a second definition of this block sitting in
       the tests waiting to go stale - so what is pinned here is the property
       that outlives it. What the diff caught before it was thrown away was two
       reordered class attributes - invisible on screen, and enough to make a
       byte comparison fail for a reason nobody would have believed. */
    const holder = document.createElement("div");
    holder.innerHTML = rendered[0];
    expect(holder.querySelectorAll(".gow")).toHaveLength(2);
    expect(holder.textContent).toContain("2 games in progress");
    expect(holder.textContent).not.toMatch(/Q\d|Final|Halftime/);
    expect(holder.textContent).not.toContain("17-21");
  });

  test("a payload the page cannot read never throws", async () => {
    stubEspn("reshaped");
    await expect(draw([oregonGame()])).resolves.toBeTruthy();
    expect(screen.getByRole("heading", { name: /on the field/i })).toBeTruthy();
  });

  test("keeps the last good score when a later refresh fails", async () => {
    /* Not the same case as never having had one. A score that arrived and
       then stopped updating is better than a score that vanishes, and the
       block is honest either way because the row still carries the kickoff. */
    stubEspn("ok");
    const { container } = await draw([oregonGame()]);
    expect(text(container)).toContain("17-21");
    stubEspn("unreachable");
    await advance(POLL_MS + 100);
    expect(text(container)).toContain("17-21");
  });
});

/* ------------------------------------------------------------------ */

describe("which dates it asks for", () => {
  test("one date for one Saturday, taken from the kickoffs it was handed", async () => {
    const calls = stubEspn();
    await draw([oregonGame()]);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("dates=20260905");
    expect(calls[0].url).toContain("groups=80");
  });

  test("a Saturday-night game belongs to Saturday, not to the UTC Sunday", async () => {
    /* The fixture proves this rather than assuming it: ESPN returned the
       02:00Z Sunday kickoff under dates=20260905, because the parameter is an
       Eastern calendar day. A UTC window loses every night game. */
    expect(espnDay(Date.parse("2026-09-06T02:00:00.000Z"))).toBe("20260905");
    const calls = stubEspn();
    await draw([oregonGame(), asuGame()]);
    expect(calls.map((c) => c.url).join(" ")).not.toContain("20260906");
    expect(calls, "two games on one Eastern day is one request").toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ */

describe("polling", () => {
  test("keeps up with the game while one is on", async () => {
    const calls = stubEspn();
    await draw([oregonGame()]);
    expect(calls).toHaveLength(1);
    await advance(POLL_MS + 100);
    expect(calls.length).toBe(2);
    await advance(POLL_MS);
    expect(calls.length).toBe(3);
  });

  test("does not start at all when nothing is live", async () => {
    const calls = stubEspn();
    /* Handed a game that kicked off well outside the live window - the state
       lib/games.mjs calls stalled. The page filters those out before this
       component sees them, but the hook may not lean on that: the cost of
       being wrong is a request every thirty seconds forever. */
    const stale = game(OREGON, new Date(NOW.getTime() - LIVE_WINDOW_MS - 60_000).toISOString(),
      "Boise State", "Oregon");
    await draw([stale]);
    expect(calls).toHaveLength(0);
    await advance(POLL_MS * 4);
    expect(calls).toHaveLength(0);
  });

  test("stops in a pocket and catches up on the way back", async () => {
    const calls = stubEspn();
    await draw([oregonGame()]);
    const before = calls.length;

    await setHidden(true);
    await advance(POLL_MS * 6);
    expect(calls.length, "a hidden tab must not poll").toBe(before);

    await setHidden(false);
    expect(calls.length, "a returning reader must see now, not the interval's leftovers")
      .toBe(before + 1);
    await advance(POLL_MS + 100);
    expect(calls.length).toBe(before + 2);
  });

  test("fetches on mount even in a tab that calls itself hidden", async () => {
    /* Phase 3's second bug, in a new place: an occluded window and an
       automated browser both report hidden while being driven, and gating the
       first fetch on visibility is what cost a newly opened tab its only one. */
    const calls = stubEspn();
    Object.defineProperty(document, "hidden", { value: true, configurable: true });
    await draw([oregonGame()]);
    expect(calls).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ */

describe("the parse", () => {
  /* The component tests above cover what happens when ESPN answers oddly. This
     covers the narrower claim the whole thing rests on: nothing that arrives
     at this function can make it throw, whatever it is. A throw here is not a
     missing score, it is a blank page. */
  test("survives anything at all", () => {
    for (const junk of [
      undefined, null, 0, "", "<html>", [], {}, { events: null }, { events: {} },
      { events: [null, 1, "x", {}, { id: "" }] },
      { events: [{ id: "1", competitions: "no" }] },
      { events: [{ id: "1", competitions: [{ competitors: {} }] }] },
    ]) {
      expect(() => parseScoreboard(junk)).not.toThrow();
      expect(Object.keys(parseScoreboard(junk))).toHaveLength(0);
    }
  });

  test("will not invent a 0-0 out of a missing score", () => {
    /* Number(null) and Number("") are both 0, which would put a scoreline on a
       game that reported none - and 0-0 is a plausible-looking lie, which is
       the worst kind of wrong this repo has. */
    const one = (home: unknown, away: unknown) =>
      parseScoreboard({ events: [{
        id: "7", status: { type: { state: "in" }, period: 1, displayClock: "9:00" },
        competitions: [{ competitors: [
          { homeAway: "home", score: home }, { homeAway: "away", score: away },
        ] }],
      }] })["7"];
    expect(one(null, null).score).toBeNull();
    expect(one("", "").score).toBeNull();
    expect(one("x", "3").score).toBeNull();
    expect(one("0", "0").score).toEqual({ home: 0, away: 0 });
    /* And a game with no score at all is still known, because its status is. */
    expect(one(null, null).state).toBe("in");
  });
});
