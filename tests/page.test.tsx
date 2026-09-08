/**
 * The fetch layer, rendered.
 *
 * This replaces the two source-text assertions `tests/page.test.mjs` carried,
 * which said in their own header that they existed only because there was no
 * DOM runner and should become a render and a spy on fetch when there was one.
 * There is one now.
 *
 * Testing the source text was never the point; the point was that both of
 * these are cases where the *wrong* code looks more correct than the right
 * code, so a regression arrives as a tidy-up nobody questions. That is still
 * the reason each assertion below is here, and now the assertion is about
 * behaviour rather than about a regex over a string.
 */

import { describe, expect, test } from "vitest";
import { fireEvent, screen } from "@testing-library/react";

import { LIVE_WINDOW_MS } from "../lib/games.mjs";
import { advance, FIXTURE_NOW, renderPage, setHidden, stubFetch } from "./helpers";

describe("the fetch layer", () => {
  test("asks for a stable URL, so the CDN's ETag can match", async () => {
    const calls = stubFetch();
    await renderPage();
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(c.url, "a cache-busting query string is back in the fetch layer")
        .not.toMatch(/[?&]t=/);
      expect(c.url).toMatch(/\/standings\.json$|\/results\.json$|\/teams\.json$/);
    }
  });

  test("revalidates rather than throwing its validators away", async () => {
    /* The trap: `no-store` reads as the stronger of the two and is the wrong
       one. It tells the browser not to consult *or populate* its cache, so
       there is no stored entry to build an If-None-Match from and every poll
       pulls the whole body - the same waste a cache-buster causes, arrived at
       from the other direction. `no-cache` still goes to the network every
       single time, but it goes conditionally. */
    const calls = stubFetch();
    await renderPage();
    for (const c of calls) expect(c.init?.cache).toBe("no-cache");
  });

  test("falls back to the copy bundled with the deploy", async () => {
    /* The whole cutover story, and the only thing standing between a
       raw.githubusercontent outage and a blank page. */
    const calls = stubFetch({ remoteDown: true });
    await renderPage();
    expect(calls.map((c) => c.url)).toContain("/standings.json");
    expect(await screen.findByText(/Austin College Football Fantasy League/)).toBeTruthy();
  });

  test("polls on the live cadence while a game is on, and stops when hidden", async () => {
    const calls = stubFetch();
    await renderPage();
    const first = calls.length;
    await advance(61_000);
    expect(calls.length, "a minute with a game on should have polled").toBeGreaterThan(first);

    const during = calls.length;
    await setHidden(true);
    await advance(10 * 60_000);
    expect(calls.length, "a hidden tab must not poll").toBe(during);
  });
});

describe("what counts as live", () => {
  /* The dead-week bug was the page and the builder disagreeing about what
     "live" meant, and the fix was for both to ask lib/games.mjs. Asserting on
     the rendered block is what pins that: the page's own arithmetic and the
     shared classifier give the same answer only by accident until one of them
     changes.

     The fixture's week 3 kicks off at 16:00, 20:00 and 23:30 Z, so "nothing is
     live" holds only before the first of those and after the last has run out
     of window. That is why the stalled case is pinned past the third kickoff
     and not the first - pinning it past the first is what the initial draft of
     this test did, and the block it was asserting had gone was the 20:00 game,
     an hour and a half into its own window. */
  const kickoff = new Date("2026-09-12T16:00:00.000Z").getTime();
  const lastKickoff = new Date("2026-09-12T23:30:00.000Z").getTime();
  const onTheField = () => screen.queryByRole("heading", { name: /on the field/i });

  test("a game that kicked off an hour ago is on the field", async () => {
    stubFetch();
    await renderPage(new Date(kickoff + 60 * 60 * 1000));
    expect(onTheField()).not.toBeNull();
    expect(screen.getByText("1 game")).toBeTruthy();
  });

  test("a game past the live window is not", async () => {
    stubFetch();
    await renderPage(new Date(lastKickoff + LIVE_WINDOW_MS + 1000));
    expect(onTheField()).toBeNull();
  });

  test("a game a millisecond before kickoff is not", async () => {
    stubFetch();
    await renderPage(new Date(kickoff - 1));
    expect(onTheField()).toBeNull();
  });
});

describe("a lazy file that never arrives", () => {
  test("says so, rather than showing an empty tab", async () => {
    stubFetch({ missing: ["results"] });
    await renderPage(FIXTURE_NOW);
    fireEvent.click(screen.getByText("Activity"));
    expect(await screen.findByText(/did not load/)).toBeTruthy();
  });
});
