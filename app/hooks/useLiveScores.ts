"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { classify } from "../../lib/games.mjs";

/**
 * Live scores for the games already on screen, straight from the browser.
 *
 * ESPN's public scoreboard needs no key and answers with
 * `access-control-allow-origin: *`, so the page fetches it itself: no Action,
 * no cron, no commits, and nothing added to the CFBD budget. The event `id` is
 * the same number CFBD uses, which is the only reason this is safe to do at
 * all - every other join in this repo has to reckon with school strings that
 * do not match, and this one does not.
 *
 * Nothing here is allowed to matter. ESPN is undocumented, so the contract we
 * are relying on could change without notice on a Saturday morning; every
 * failure mode ends with an empty map and a block drawn exactly as it was
 * before this file existed. That is asserted in tests/liveScores.test.tsx
 * rather than left as an intention.
 */

const ENDPOINT =
  "https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard";

/* FBS. The same group the rest of the repo restricts itself to. */
const GROUPS = "80";

/* A game clock moves faster than anything else on this page, and the endpoint
   sits behind a max-age of about three seconds, so this is the one fetch here
   that is not shaped by a CDN window. Thirty seconds is roughly a play and a
   half: fast enough that the score is never visibly wrong, slow enough that a
   four-hour Saturday afternoon is ~480 requests to a free public endpoint
   rather than a poll per second. */
export const POLL_MS = 30_000;

export type LiveScore = {
  /* away and home, in the order the row reads. Null when the payload carried
     a status but no usable pair of numbers. */
  score: { home: number; away: number } | null;
  period: number | null;
  displayClock: string | null;
  /* ESPN's own: "pre" | "in" | "post". */
  state: string | null;
  /* ESPN's own words for the status - "Halftime", "End of 3rd", "Final",
     "Delayed". Carried because there is no reliable way to compose those from
     period and clock: at halftime the state is still "in" and the clock reads
     0:00, and "Q2 0:00" would be a sentence nobody says. */
  detail: string | null;
};

/** The map the hook returns: ESPN event id, as a string, to what it knows. */
export type LiveScores = Record<string, LiveScore>;

/**
 * The Eastern calendar day a kickoff belongs to, as ESPN's `dates` wants it.
 *
 * `dates=20260905` returns 16:00Z Sep 5 through 02:30Z Sep 6, because the
 * parameter is an Eastern day and not a UTC one. Asking by UTC day loses every
 * Saturday-night kickoff from the Saturday it belongs to and finds it, alone,
 * under Sunday.
 *
 * This formats an instant directly rather than stepping a window, which is why
 * it needs none of the UTC-day arithmetic `lib/lines.mjs` does: there is no
 * "next day" here to get wrong across the 25-hour November Sunday.
 */
export const espnDay = (ms: number): string =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(ms)).replaceAll("-", "");

/* A number, or nothing. `Number(null)` is 0 and `Number("")` is 0, either of
   which would put a 0-0 scoreline on a game that reported no score at all. */
const num = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string" || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

/**
 * ESPN's scoreboard body, keyed by event id.
 *
 * Written so that no shape of input can throw: everything is checked before it
 * is walked, and an event that does not yield something usable is skipped
 * rather than emitted half-populated. A half-populated entry is the dangerous
 * outcome, because the block would then draw a scoreline built from a payload
 * it did not understand.
 *
 * Exported for its own tests. The status is read from the event and from the
 * competition, in that order - both carry it in the live payload, and the
 * trimmed sample in `fixtures/espn-sample.json` carries only the second.
 *
 * @param body anything at all, including a parsed HTML error page
 */
export function parseScoreboard(body: unknown): LiveScores {
  const out: LiveScores = {};
  const events = (body as any)?.events;
  if (!Array.isArray(events)) return out;

  for (const e of events) {
    const id = e?.id != null && e.id !== "" ? String(e.id) : null;
    if (!id) continue;

    const comp = Array.isArray(e?.competitions) ? e.competitions[0] : null;
    const status = e?.status ?? comp?.status;
    const sides = Array.isArray(comp?.competitors) ? comp.competitors : [];
    const side = (which: string) => sides.find((c: any) => c?.homeAway === which);

    const home = num(side("home")?.score);
    const away = num(side("away")?.score);
    const state = str(status?.type?.state);
    const entry: LiveScore = {
      score: home !== null && away !== null ? { home, away } : null,
      period: num(status?.period),
      displayClock: str(status?.displayClock),
      state,
      detail: str(status?.type?.detail),
    };
    /* Neither a score nor a status is nothing to say, and an entry that exists
       but says nothing would still count as "ESPN knows this game" further up. */
    if (!entry.score && !state) continue;
    out[id] = entry;
  }
  return out;
}

/** The kickoffs handed in, as the set of Eastern days that covers them. */
const daysFor = (games: { date: string }[]): string[] => {
  const days = new Set<string>();
  for (const g of games) {
    const ms = Date.parse(String(g?.date));
    if (Number.isFinite(ms)) days.add(espnDay(ms));
  }
  return [...days].sort();
};

/**
 * @param games the rows about to be drawn, each with the CFBD id the builder
 *   wrote and the kickoff it wrote beside it
 */
export function useLiveScores(games: { id?: string | number; date: string }[]): LiveScores {
  const [scores, setScores] = useState<LiveScores>({});

  /* The identity of the set, not of the array. The page rebuilds its live list
     once a minute off a ticking clock, so the array is new every minute while
     the games in it are the same three; keying the effects on the array itself
     would restart the poller - and refetch - on every one of those ticks. */
  const key = games.map((g) => `${g.id ?? ""}@${g.date}`).join("|");
  const days = useMemo(() => daysFor(games), [key]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Asked of the shared classifier, on the same argument the page uses, so
     "live" cannot come to mean two things. Computed in render rather than
     memoised on `key`: it has to be able to change without the set changing,
     which is exactly what happens when the last game of the night runs out of
     its window. The page re-renders this component once a minute, so that
     boundary is crossed within a minute of it happening.

     The page already filters to live games before this component sees them.
     Doing it again here is not redundancy for its own sake - the cost of the
     hook trusting a caller that stops filtering is a request every thirty
     seconds, forever, to somebody else's free endpoint. */
  const now = Date.now();
  const live = games.some((g) => classify({ startDate: g.date }, now) === "live");

  /* Mounted, not "this effect run is current". Phase 3 lost a page's first and
     only response to the other version of this: a tab that resolves
     document.hidden a tick after mount changes state, the effect re-runs, and
     its cleanup discards a request that was already on the wire and about to
     arrive. Reconfiguring the poller is not a reason to throw away an answer.
     Set on the way in as well as cleared on the way out, or React's
     development double-mount leaves it false for the life of the page. */
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  /* Two rounds can be in flight at once - a poll, and the immediate fetch a
     returning tab makes - and they can land in either order. Only the newest
     round is allowed to win. */
  const round = useRef(0);

  const refresh = useCallback(() => {
    if (!days.length) return;
    const mine = ++round.current;
    const one = (day: string) =>
      fetch(`${ENDPOINT}?dates=${day}&groups=${GROUPS}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then(parseScoreboard)
        /* Unreachable, rate-limited, an HTML error page with a 200 on it: all
           the same answer here, which is that this date contributed nothing. */
        .catch(() => ({} as LiveScores));

    Promise.all(days.map(one)).then((maps) => {
      if (!alive.current || round.current !== mine) return;
      const next = Object.assign({}, ...maps) as LiveScores;
      /* A round that came back with nothing usable leaves the last good map
         alone. The two cases are genuinely different: never having had a score
         is a block that draws its kickoff time, which is where this started;
         losing the network mid-game is a score that stops moving, and blanking
         it would be throwing away the truest thing on the row. Either way the
         row still carries a kickoff, so neither state can lie. */
      setScores((prev) => (Object.keys(next).length ? next : prev));
    });
  }, [days]);

  /* The one signal that says nobody can see the answer. */
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const sync = () => setVisible(!document.hidden);
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);

  /* Once, as soon as there is something on the field, and again whenever that
     set changes. Deliberately not gated on visibility, for the reason the
     page's own first fetch is not: an occluded window and an automated browser
     both report hidden while being driven, and gating this too would cost a
     newly opened tab the only fetch it was ever going to make. The timer below
     is the part that has to stop. */
  useEffect(() => { if (live) refresh(); }, [refresh, live]);

  /* And then on a timer, only while someone can see it, and never at all when
     nothing is on. Coming back fetches immediately rather than waiting out an
     interval that was not running: thirty seconds of a stale scoreline is the
     whole of what this feature is trying to avoid. */
  const wasHidden = useRef(false);
  useEffect(() => {
    if (!visible) { wasHidden.current = true; return; }
    if (!live) return;
    if (wasHidden.current) { wasHidden.current = false; refresh(); }
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [refresh, live, visible]);

  return scores;
}
