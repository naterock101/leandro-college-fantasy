"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { classify } from "../lib/games.mjs";
import { mergePayload } from "../lib/payload.mjs";

import { Activity } from "./components/Activity";
import { AllTeams } from "./components/AllTeams";
import { GamesOfWeek } from "./components/GamesOfWeek";
import { Leaderboard } from "./components/Leaderboard";
import { LiveGames } from "./components/LiveGames";
import { Style } from "./components/Style";
import { Trends } from "./components/Trends";
import { panelId, TABS, tabId, Tabs } from "./components/Tabs";
import { Unscored } from "./components/Unscored";
import { ViewState } from "./hooks/useViewState";
import type { Data, Lazy, Load, Tab } from "./types";

/* Reads the JSON the GitHub Action commits. Fetching from raw.githubusercontent
   rather than the bundled copy means data updates without a Vercel redeploy,
   which matters because the bot commits every 10 minutes during games.

   The branch is `data`, not `main`: an orphan branch holding the payload and
   nothing else, so main's history is code again and Vercel - which watches
   main - never sees a data commit at all. Its files sit at the branch root
   rather than under public/, because there is no site on that branch for
   public/ to mean anything about. */
const SOURCE =
  "https://raw.githubusercontent.com/naterock101/leandro-college-fantasy/data";

/* The copy bundled with this deploy, reached only when the live fetch fails:
   local dev, an offline visitor, a raw.githubusercontent outage, and the
   window between deploying this and the `data` branch existing at all. Frozen
   at whatever was committed to main, and deliberately not refreshed by the
   bot - keeping it current is what would put data commits back on main. */
const bundled = (file: string) => `/${file}.json`;
const remote = (file: string) => `${SOURCE}/${file}.json`;

/* The core is on screen the moment the page opens; the other two are ~70% of
   the bytes and neither is visible until a tab is clicked. Which tab needs
   which file is declared alongside the tabs themselves, in components/Tabs. */
const NEEDS = Object.fromEntries(TABS.map((t) => [t.id, t.needs])) as Record<Tab, Lazy | null>;

/* 60 seconds while a game is on, five minutes otherwise. The bot writes every
   10 minutes at its fastest and raw.githubusercontent holds a 300s CDN cache
   in front of it, so the old flat 120s spent most of its polls asking a
   question that could not have a new answer. A minute during a game is under
   the CDN window, so the first poll after a commit lands within about a minute
   of it becoming visible; five minutes off-season matches the cache exactly. */
const POLL_LIVE_MS = 60_000;
const POLL_IDLE_MS = 5 * 60_000;

/* What a tab says instead of its own empty state while its file is not here.
   The distinction is the whole point of having it: an empty array reads the
   same whether nothing has happened yet or the fetch failed, and only one of
   those is the site's fault. Returns null once the file has arrived, and the
   tab's own copy takes over. */
const lazyNote = (st: Load) =>
  st === "ready"
    ? null
    : st === "failed"
    ? "That part of the payload did not load. The page tries again on its next refresh."
    : "Loading…";

/**
 * The shell: which tab is open, what has been fetched, and where each section
 * goes. Everything that draws anything lives in components/.
 *
 * It is split this way because the alternative had become the problem. One
 * 1,100-line component is one file for every change to touch, and the next
 * four things planned for this page - live scores, analytics columns, a fourth
 * tab, logos - are four independent edits to four different parts of it. As
 * one file that is four conflicting versions of the same file; as this it is
 * four files that do not overlap.
 */
export default function Page() {
  /* The always-fetched file and the two that arrive when their tab is opened,
     kept apart in state and put together for the render. Every consumer below
     goes on reading one object with every section on it - mergePayload fills
     an absent section with an empty collection rather than undefined, so a
     file that 404s costs a tab its contents and never the whole page. */
  const [core, setCore] = useState<Record<string, any> | null>(null);
  const [parts, setParts] = useState<Partial<Record<Lazy, any>>>({});
  const [load, setLoad] = useState<Record<Lazy, Load>>({ results: "idle", teams: "idle" });
  /* Which lazy files this session is following. A tab opened once keeps its
     file refreshing with the core thereafter, so switching back to it shows
     the same instant as the leaderboard rather than a stale snapshot. */
  const [want, setWant] = useState<Lazy[]>([]);
  const data = useMemo(
    () => (core ? (mergePayload(core, parts) as Data) : null),
    [core, parts]
  );
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("league");

  /* A phone left open through a twelve hour Saturday used to poll about 360
     times in a pocket. The tab being hidden is the one signal that says nobody
     can see the answer. */
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const sync = () => setVisible(!document.hidden);
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);

  /* The live list is a function of the wall clock as much as of the payload:
     a game becomes "in progress" by kicking off, with no new data involved. A
     minute is fine granularity for a three hour game. */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    /* And it stops while nobody can see it, for the same reason the poll does.
       Phase 3 took the poll out of a pocket and left this behind, so a phone
       on a Saturday still woke every sixty seconds to work out that a game it
       was not showing anyone had ended.

       Coming back sets the clock before scheduling the next tick, because the
       time kept moving while the tab was hidden: a reader who opens their
       phone an hour later must see the games that are on now, not the ones
       that were on when they last looked. Without that line the page would be
       up to a minute stale at exactly the moment someone is looking at it. */
    if (!visible) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, [visible]);

  /* Opening a tab is what asks for its file. Adding to the list restarts the
     polling effect below, which fetches immediately, so the first open is a
     request and every later open is already-loaded data. */
  useEffect(() => {
    const f = NEEDS[tab];
    if (f) setWant((w) => (w.includes(f) ? w : [...w, f]));
  }, [tab]);

  /* Every league game in progress, unfiltered: this sits at the top of the
     leaderboard, above the manager picker that belongs to games of the week, so
     narrowing it by a control further down the page would read as a bug.

     Games that have kicked off and are not yet in the payload as final. The bot
     writes only completed games as results, so anything still sitting in the
     upcoming list whose start time has passed is on the field right now.

     The upper bound matters: outside the Saturday window the bot runs every
     eight hours, so a game that finished at noon can sit in this list until the
     evening run retires it. Nothing runs past five and a half hours, so beyond
     that the entry is stale rather than live and is dropped.

     It is computed here rather than inside the block that draws it because the
     poll cadence is a function of the same answer, and the alternative was two
     definitions of "is anything on". */
  const liveGames = useMemo(() => {
    if (!data) return [];
    /* Asked of the shared classifier rather than recomputed here. A row in
       gamesOfWeek carries a kickoff and no completion flag - the builder puts
       only scheduled and live games in that list - so the kickoff is the whole
       input, and going through classify is what keeps the page and the builder
       from drifting apart on what "live" means. That drift was the dead-week
       bug: the page already knew a game abandoned eight hours ago was not live
       and the builder did not. */
    return data.gamesOfWeek.games
      .filter((g) => classify({ startDate: g.date }, now) === "live")
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }, [data, now]);

  /* ---------------------------------------------------------------- */

  /* The one place anything is fetched. It restarts when the cadence changes,
     when a tab asks for a new file, and when the tab comes back into view, and
     it fetches once immediately on every one of those - so returning to a
     phone shows the current score straight away rather than after waiting out
     an interval that was not running.

     Deliberately placed after liveGames rather than at the top of the
     component: the cadence is a function of the data, and the alternative was
     a second definition of "is anything on" living up there. The cost is one
     extra fetch when the first payload turns the cadence from idle to live,
     and that fetch is a 304. */
  const pollMs = liveGames.length ? POLL_LIVE_MS : POLL_IDLE_MS;
  /* Mounted, not "this effect run is current". Tying it to the effect run was
     a bug worth keeping the note for: opening the site in a background tab
     mounts it visible, resolves document.hidden a tick later, and that state
     change re-ran the fetch effect - whose cleanup then discarded the very
     first response, in flight and about to arrive, so the page sat on
     "Loading…" until someone focused the tab. Reconfiguring the poller is not
     a reason to throw away a request already on the wire. Set on the way in as
     well as cleared on the way out, because React's development double-mount
     would otherwise leave it false for the life of the page. */
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  /* One request per file the page currently wants: the core always, and each
     lazy file whose tab has been opened. */
  const refresh = useCallback(() => {
    /* No cache-busting query string, and `no-cache` rather than `no-store`.
       Both of the old settings had the same effect: `?t=` made every poll a
       URL nothing had ever seen, and `no-store` tells the browser not to keep
       a copy it could revalidate against, so between them every poll pulled
       the whole body. `no-cache` still goes to the network every single time -
       it is not weaker - but it goes conditionally, and raw.githubusercontent
       answers a matching If-None-Match with a 304 and no body at all. */
    const json = (url: string) =>
      fetch(url, { cache: "no-cache" })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))));
    /* Live copy first, deploy-time copy second, per file. */
    const grab = (file: string) => json(remote(file)).catch(() => json(bundled(file)));

    grab("standings")
      .then((d) => { if (alive.current) { setCore(d); setErr(null); } })
      .catch((e) => { if (alive.current) setErr(e.message); });

    for (const f of want) {
      setLoad((s) => (s[f] === "idle" ? { ...s, [f]: "loading" } : s));
      grab(f)
        .then((d) => {
          if (!alive.current) return;
          setParts((p) => ({ ...p, [f]: d }));
          setLoad((s) => ({ ...s, [f]: "ready" }));
        })
        /* A refresh that fails after the file once arrived leaves the tab
           showing what it has. Only a file we have never had reads as failed,
           because that is the only case where the tab is empty and the reason
           matters. */
        .catch(() => {
          if (!alive.current) return;
          setLoad((s) => ({ ...s, [f]: s[f] === "ready" ? "ready" : "failed" }));
        });
    }
  }, [want]);

  /* Intent: on mount, and every time a tab asks for a file we have not got.
     Deliberately not gated on visibility. A click is a request whether or not
     the document calls itself visible, and it does not always - an occluded
     window and an automated browser both report hidden while being driven, and
     gating this on visibility cost a newly opened tab its one and only fetch. */
  useEffect(() => { refresh(); }, [refresh]);

  /* And then on a timer, only while someone can see it. A phone left open
     through a twelve hour Saturday used to poll about 360 times in a pocket.
     Coming back fetches immediately rather than waiting out an interval that
     was never running; a change of cadence only re-times the interval, because
     nothing about that makes the data any older. */
  const wasHidden = useRef(false);
  useEffect(() => {
    if (!visible) { wasHidden.current = true; return; }
    if (wasHidden.current) { wasHidden.current = false; refresh(); }
    const id = setInterval(refresh, pollMs);
    return () => clearInterval(id);
  }, [refresh, visible, pollMs]);

  if (err) return <main className="wrap"><p className="err">Could not load standings ({err}). Check SOURCE.</p><Style /></main>;
  if (!data) return <main className="wrap"><p className="muted">Loading…</p><Style /></main>;

  const stamp = new Date(data.generatedAt);

  return (
    <ViewState>
    <main className="wrap">
      <header>
        <div className="brand">
          <img src="/logo.png" alt="" width={51} height={130} className="mark" />
          <div>
            <h1>Austin College Football Fantasy League</h1>
            <div className="muted sm">
              Updated {stamp.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
            </div>
          </div>
        </div>
      </header>

      <Tabs active={tab} onSelect={setTab} />

      {/* One panel, named by whichever tab is on. Only the open tab is
          rendered: the other two would otherwise be in the document for a
          screen reader to walk into, and All teams in particular would be a
          table of nothing at all until its file arrives. */}
      <div role="tabpanel" id={panelId(tab)} aria-labelledby={tabId(tab)}>
        {tab === "league" && (
          <>
            <Leaderboard data={data} />
            <LiveGames games={liveGames} generatedAt={data.generatedAt} />
            <GamesOfWeek data={data} />
            <Unscored data={data} />
          </>
        )}

        {tab === "teams" && <AllTeams data={data} note={lazyNote(load.teams)} />}

        {tab === "h2h" && <Activity data={data} note={lazyNote(load.results)} />}

        {tab === "trends" && <Trends data={data} note={lazyNote(load.results)} />}
      </div>

      <Style />
    </main>
    </ViewState>
  );
}
