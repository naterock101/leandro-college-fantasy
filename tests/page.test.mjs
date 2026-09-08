/**
 * The two things about the page's fetch layer that are worth pinning, and that
 * a unit test can reach without a DOM.
 *
 * These are assertions about the source text, which is not how anyone would
 * choose to test a component. There is no DOM runner in this repo yet - vitest
 * and @testing-library are devDependencies waiting on the component split in a
 * later phase, and jsdom is not installed at all - so the alternatives were a
 * source assertion or nothing. Both cases below are ones where the *wrong* code
 * looks more correct than the right code, which is exactly when a regression
 * arrives as a tidy-up nobody questions. When there is a DOM runner, these
 * become a render and a spy on fetch, and this file goes away.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { classify, LIVE_WINDOW_MS } from "../lib/games.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const page = readFileSync(join(ROOT, "app/page.tsx"), "utf8");

test("nothing in the fetch layer busts the cache with a unique URL", () => {
  /* `?t=${Date.now()}` makes every poll a URL the CDN and the browser have
     never seen, so the ETag can never match and every poll transfers the whole
     body. raw.githubusercontent answers a conditional request with 304 and an
     empty body, which is the entire saving. */
  assert.doesNotMatch(page, /\?t=\$\{Date\.now\(\)\}/,
    "a cache-busting query string is back in the fetch layer");
});

test("the poll revalidates rather than throwing its validators away", () => {
  /* The trap, and the reason this is a test and not a comment: `no-store` reads
     as the stronger of the two and is the wrong one. It tells the browser not
     to consult *or populate* its cache, so there is no stored entry to build an
     If-None-Match from and every poll is a full body - the same waste the
     cache-buster caused, arrived at from the other direction.

     `no-cache` is the one that means "always ask, but ask conditionally": it
     revalidates on every request and takes the 304 when nothing changed. It is
     no less fresh, because the response is only reused when the server has just
     said it is still current. */
  assert.match(page, /cache: "no-cache"/,
    "the poll is not revalidating; it should be cache: \"no-cache\"");
  assert.doesNotMatch(page, /cache: "no-store"/,
    "no-store discards the validators that make a poll cheap");
});

test("the page's idea of live is the shared classify, not a second copy of it", () => {
  /* The dead-week bug was the page and the builder disagreeing about what live
     meant. A gamesOfWeek row carries a kickoff and no completion flag - the
     builder only writes scheduled and live games into it - so handing classify
     `{ startDate: row.date }` is the whole adapter, and the answers below are
     what the page's inline arithmetic used to compute. */
  const now = Date.parse("2026-09-12T20:30:00.000Z");
  const at = (ms) => classify({ startDate: new Date(now - ms).toISOString() }, now);
  assert.equal(at(-1), "scheduled", "a game a millisecond from kickoff is not live");
  assert.equal(at(0), "live", "kickoff itself is live");
  assert.equal(at(LIVE_WINDOW_MS - 1), "live");
  assert.equal(at(LIVE_WINDOW_MS), "stalled", "past the window it is stale, not live");

  assert.doesNotMatch(page, /now - kick < LIVE_WINDOW_MS/,
    "the page is computing the live window itself again instead of asking classify");
});
