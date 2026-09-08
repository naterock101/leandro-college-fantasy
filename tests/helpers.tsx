/**
 * The shared rig for the DOM tests: a fake network, a pinned clock, and a
 * render that waits for the first payload to land.
 *
 * Named `helpers.tsx` rather than `*.test.tsx` on purpose - vitest collects
 * only the latter, so this file is a module and never a suite of its own.
 */

import { act, render, waitFor, screen } from "@testing-library/react";
import { expect, vi } from "vitest";

import { splitPayload } from "../lib/payload.mjs";
import golden from "../fixtures/sample-standings.json" with { type: "json" };

import Page from "../app/page";

/* The golden fixture is the union of the three files the builder writes, so
   the split that produces the fake responses is the real one from
   lib/payload.mjs rather than a second description of the same partition. */
export const payload = golden as Record<string, any>;

export type Fetches = { url: string; init: RequestInit | undefined }[];

/**
 * Serves the split golden payload to whatever the page asks for, and records
 * every request so a test can assert on the URL and the cache mode.
 *
 * `missing` names files whose fetch rejects at the remote host, which is how
 * a test reaches the bundled fallback path and the failed-lazy-file states.
 */
export function stubFetch(opts: { missing?: string[]; remoteDown?: boolean } = {}) {
  const files = splitPayload(payload) as Record<string, any>;
  const byName: Record<string, any> = {
    standings: files.core,
    results: files.results,
    teams: files.teams,
  };
  const calls: Fetches = [];
  const spy = vi.fn((url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const name = url.replace(/^.*\//, "").replace(/\.json$/, "");
    const remote = url.startsWith("http");
    const gone =
      opts.missing?.includes(name) || (remote && opts.remoteDown) || !byName[name];
    if (gone) return Promise.resolve({ ok: false, status: 404, json: () => Promise.reject() });
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(byName[name]) });
  });
  vi.stubGlobal("fetch", spy);
  return calls;
}

/* Every game in the fixture is in September 2026, and half of what the page
   renders is a function of the wall clock - which games are live, which week
   is current. Pinning it is what makes those assertions mean anything. */
export const FIXTURE_NOW = new Date("2026-09-12T18:00:00.000Z");

export async function renderPage(now: Date = FIXTURE_NOW) {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(now);
  const view = render(<Page />);
  /* The first fetch resolves a microtask later, so every test would otherwise
     open on the "Loading…" state. */
  await waitFor(() => expect(screen.queryByText("Loading…")).toBeNull());
  return view;
}

/* The one signal that says nobody can see the answer. jsdom's `hidden` is a
   getter on Document.prototype, so it is shadowed on the instance; the event
   goes through act() because the state update it causes is what tears down the
   poll interval, and an update left unflushed reads in a test as a page that
   went on polling in a pocket. */
export async function setHidden(hidden: boolean) {
  Object.defineProperty(document, "hidden", { value: hidden, configurable: true });
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

/* Timers are faked so the poll interval can be driven, which means React's own
   scheduling is faked too; advancing inside act() is what lets an effect that
   the timer triggers finish before the assertion after it. */
export async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
