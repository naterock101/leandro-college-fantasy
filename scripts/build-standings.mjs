#!/usr/bin/env node
/**
 * Builds the site's payload from CollegeFootballData.
 *
 * One upstream call per run: the full season, both season types. Conference
 * championship games come back as seasonType "regular", bowls and playoff
 * games as "postseason". League rules count all of them, so we never branch
 * on season type, we just count completed games.
 *
 * Env: CFBD_API_KEY
 * Usage: node scripts/build-standings.mjs [--dry] [--fixture path.json]
 *                                         [--lines path.json] [--out path.json]
 *                                         [--now iso] [--union]
 *
 * Three files come out, not one - standings.json, results.json, teams.json -
 * because the page fetches the first on every poll and the other two only once
 * the tab that needs them is opened. lib/payload.mjs owns which key goes where.
 *
 * --fixture also swaps the lines file for fixtures/sample-lines.json and pins
 * the clock, so a fixture build reads nothing that moves and its output is
 * reproducible.
 *
 * --lines says where the lines file is. The workflow keeps it in the `data`
 * worktree alongside everything else it writes.
 *
 * --out redirects the write away from public/. It names the core file, and the
 * other two are named from its prefix. Regenerating the sample fixture must use
 * it: writing the fixture build to the live file, even for the moment before
 * copying it back, publishes synthetic standings to anyone whose page happens
 * to poll in that window.
 *
 * --union writes everything to the one path instead, which is how the golden
 * fixture stays a single diffable file.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  pick, home, away, homePts, awayPts, homeConf, awayConf,
  startDate, seasonType, weekOf, isDone, isPost, sortKey, classify,
} from "../lib/games.mjs";
import { splitPayload } from "../lib/payload.mjs";
import { winProbability, luckOf, round1 } from "../lib/winprob.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROSTERS = resolve(ROOT, "data/rosters.json");
const FIXTURE_LINES = resolve(ROOT, "fixtures/sample-lines.json");
const API = "https://api.collegefootballdata.com/games";

const args = process.argv.slice(2);
const DRY = args.includes("--dry");

const flagValue = (name) => {
  const i = args.indexOf(name);
  if (i === -1) return null;
  const v = args[i + 1];
  if (!v || v.startsWith("--")) {
    console.error(`${name} needs a path.`);
    process.exit(1);
  }
  return v;
};

const FIXTURE = flagValue("--fixture");
const OUT = resolve(ROOT, flagValue("--out") ?? "public/standings.json");
/* Where build-lines.mjs left its file. The workflow keeps every data file in a
   worktree of the `data` branch and passes both scripts a matching --out and
   --lines, so the two never have to agree about a path by convention and there
   is no copy step between them that could be dropped. Dropping one would have
   been quiet and expensive: the builder would read a lines file that is not
   there and publish a season with no spreads on it. */
const LINES_FLAG = flagValue("--lines");
const LINES = resolve(ROOT, LINES_FLAG ?? "public/lines.json");
/* Writes the whole payload to OUT as one file instead of the three the site
   fetches. Only `npm run fixture:regen` passes it: a golden split across three
   files is three diffs to read, and could not state the one invariant worth
   stating, which is that the split loses nothing. Splitting is therefore the
   default, so a workflow that forgot a flag would fail loudly on a missing
   file rather than quietly publish a 92KB core again. */
const UNION = args.includes("--union");

/* The instant the whole build is judged against: which games have kicked off,
   which have been abandoned, and the generatedAt the page prints. One value
   rather than a Date.now() at each site, because a run that straddles a
   boundary would otherwise classify the same game two ways within one file.

   A fixture build pins it. The fixture's dates are fixed and the wall clock is
   not, so without this the golden file would call week 3 scheduled today, live
   on 12 September and stalled on the 13th, and stop being diffable in CI on a
   date nobody chose. This instant puts the fixture halfway through its week 3:
   one game in flight, one just kicked off, one still to come, and the two
   abandoned games of weeks 1 and 2 long past the live window - every branch of
   classify exercised by the golden rather than only the easy ones. */
const FIXTURE_NOW = "2026-09-12T20:30:00.000Z";
const NOW = (() => {
  const flag = flagValue("--now");
  if (flag) {
    /* Overriding the clock on a live run would write a false generatedAt into
       the file the site reads, so it is a fixture-only affordance. */
    if (!FIXTURE) { console.error("--now is only meaningful with --fixture."); process.exit(1); }
    const t = Date.parse(flag);
    if (!Number.isFinite(t)) { console.error(`--now: ${flag} is not a date.`); process.exit(1); }
    return t;
  }
  return FIXTURE ? Date.parse(FIXTURE_NOW) : Date.now();
})();

/* ------------------------------------------------------------------ */

/* Written by scripts/build-lines.mjs, which the workflow runs immediately
   before this script on every run. Still read rather than required: that step
   exits 0 on any feed failure and leaves the previous file in place, so this
   one must cope with a file that is missing, stale, or was last written hours
   ago. Missing or unreadable means no spreads this run, never a failure -
   standings must not depend on the betting feed.

   The file is merge-only, so an entry here may be older than fetchedAt and
   carries its own `seenAt` and `closed`. Those ride along inside the entry and
   need nothing from this function; `closed` is what makes the stored price of
   a finished game identifiable as a closing line, which matters because ESPN
   deletes a game's odds the moment it goes final.

   A fixture build reads the committed fixture instead, and never touches the
   live file. Reading live lines made the golden output drift on the wall clock
   through linesFetchedAt, and a golden file that drifts cannot be diffed in
   CI, which is the only thing a golden file is for. */
function loadLines() {
  /* --lines names a file outright and so beats the fixture's default. Without
     it a fixture build reads the committed fixture and never the live file,
     which is what keeps the golden diffable. */
  if (FIXTURE && !LINES_FLAG) {
    /* Unlike the live file this one is not optional: silently falling back to
       no spreads would change the golden output rather than fail, which is the
       wrong way round for a file whose whole job is determinism. */
    if (!existsSync(FIXTURE_LINES)) {
      console.error(`A --fixture build needs ${FIXTURE_LINES}, which is missing.`);
      process.exit(1);
    }
    const doc = JSON.parse(readFileSync(FIXTURE_LINES, "utf8"));
    return { fetchedAt: doc.fetchedAt ?? null, games: doc.games ?? {} };
  }
  if (!existsSync(LINES)) return { fetchedAt: null, games: {} };
  try {
    const doc = JSON.parse(readFileSync(LINES, "utf8"));
    return { fetchedAt: doc.fetchedAt ?? null, games: doc.games ?? {} };
  } catch (e) {
    console.warn(`note: could not read ${LINES} (${e.message}), continuing without spreads`);
    return { fetchedAt: null, games: {} };
  }
}

function loadRosters() {
  const doc = JSON.parse(readFileSync(ROSTERS, "utf8"));
  const allConfs = [...doc.conferences.power, ...doc.conferences.other];
  const owners = new Map();
  const problems = [];

  for (const [manager, teams] of Object.entries(doc.managers)) {
    if (teams.length !== 10) problems.push(`${manager}: ${teams.length} teams, expected 10`);
    const seen = new Set();
    for (const t of teams) {
      if (owners.has(t.cfbd)) {
        problems.push(`${t.cfbd} drafted twice: ${owners.get(t.cfbd).manager} and ${manager}`);
      }
      owners.set(t.cfbd, { manager, tier: t.tier, conf: t.conf, draft: t.draft });
      if (seen.has(t.conf)) problems.push(`${manager}: two teams from ${t.conf}`);
      seen.add(t.conf);
    }
    for (const c of allConfs) if (!seen.has(c)) problems.push(`${manager}: no team from ${c}`);
    const p4 = teams.filter((t) => t.tier === "p4").length;
    if (p4 !== 4) problems.push(`${manager}: ${p4} power teams, expected 4`);
  }

  if (problems.length) {
    console.error("Roster validation failed:");
    for (const p of problems) console.error("  " + p);
    process.exit(1);
  }
  return { doc, owners };
}

async function fetchGames(year) {
  if (FIXTURE) return JSON.parse(readFileSync(FIXTURE, "utf8"));
  const key = process.env.CFBD_API_KEY;
  if (!key) { console.error("CFBD_API_KEY is not set."); process.exit(1); }
  const res = await fetch(`${API}?year=${year}&seasonType=both`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!res.ok) { console.error(`CFBD returned ${res.status} ${res.statusText}`); process.exit(1); }
  return res.json();
}

/* ------------------------------------------------------------------ */

function build(doc, owners, games, lines) {
  const PTS = doc.scoring;
  const POWER = new Set(doc.conferences.power);
  const ALL_CONFS = [...doc.conferences.power, ...doc.conferences.other];
  const CONF_SET = new Set(ALL_CONFS);
  const val = (tier) => PTS[tier];

  const managers = {};
  for (const m of Object.keys(doc.managers)) {
    managers[m] = { manager: m, points: 0, wins: 0, losses: 0, remaining: 0, ceiling: 0, collisionLoss: 0, teams: {} };
    for (const t of doc.managers[m]) {
      managers[m].teams[t.cfbd] = {
        team: t.cfbd, draft: t.draft, conf: t.conf, tier: t.tier,
        wins: 0, losses: 0, points: 0, remaining: 0, ceiling: 0,
      };
    }
  }

  /* The timeline prints school names and owners and nothing else, so its sides
     are the same {team, manager} pair headToHead uses - not the conference and
     long draft name the upcoming games list needs. Across a full season that is
     the difference between a lean payload and one the bot recommits every ten
     minutes and every open phone refetches every two. */
  const scoredSide = (team, o) => ({ team, manager: o ? o.manager : null });

  const all = new Map();
  const touch = (team, conf) => {
    if (!team) return null;
    if (!all.has(team)) all.set(team, { team, conf: conf ?? null, wins: 0, losses: 0, points: 0, remaining: 0 });
    const rec = all.get(team);
    if (!rec.conf && conf) rec.conf = conf;
    return rec;
  };

  const headToHead = [];
  /* Every scored game with a drafted team on either side, oldest first. This is
     the timeline: Buffalo belongs in it the moment it plays, whoever it played.
     headToHead is the subset where both sides are drafted, and stays its own
     array because the page has read it under that name since the first deploy
     and a browser holding cached JS must not break on a reshaped payload. */
  const results = [];
  /* Every upcoming game involving a drafted team, each flagged h2h when both
     sides are drafted. The UI shows only the h2h ones until you filter to a
     manager, at which point it needs that manager's whole slate.

     "Upcoming" means scheduled or live and nothing else. A game that kicked off
     and was never completed used to sit here for the rest of the season, and
     because the next week is the lowest sort key in this list, one abandoned
     game in week 1 pinned games of the week, the projection, remaining and
     every ceiling to a week that was already over. */
  const upcoming = [];
  /* The games that will never produce a result: abandoned before a final score,
     or completed with none. Both were invisible before - one showed as upcoming
     forever, the other was skipped in silence - and invisible is the worst of
     the three options when the number they are quietly wrong about is a
     manager's ceiling. */
  const unscored = [];
  /* One entry per settled team-game a manager owned, holding what it was worth,
     what the closing line said their chance of winning it was, and whether they
     did. Summed at the end into points banked against points expected.

     A game the books never priced goes into neither this ledger nor the count
     of games it covers; it is counted separately in `luckUnpriced` and named on
     the page. Half this fixture and a sixth of the live season have no line,
     and a luck number that silently ignored them would be the most confident
     wrong number on the site. */
  const luckLedger = Object.fromEntries(Object.keys(doc.managers).map((m) => [m, []]));
  let luckPriced = 0, luckUnpriced = 0;
  const seenTeams = new Set();
  const collisionLoss = {};

  for (const g of games) {
    const h = home(g), a = away(g);
    const rh = touch(h, homeConf(g)), ra = touch(a, awayConf(g));
    const oh = owners.get(h), oa = owners.get(a);
    if (oh) seenTeams.add(h);
    if (oa) seenTeams.add(a);

    const state = classify(g, NOW);
    if (state === "scheduled" || state === "live") {
      for (const [team, o, rec] of [[h, oh, rh], [a, oa, ra]]) {
        if (rec) rec.remaining++;
        if (!o) continue;
        managers[o.manager].teams[team].remaining++;
        managers[o.manager].remaining++;
      }
      if (oh && oa && oh.manager === oa.manager) {
        const lesser = Math.min(val(oh.tier), val(oa.tier));
        collisionLoss[oh.manager] = (collisionLoss[oh.manager] ?? 0) + lesser;
      }
      if (oh || oa) {
        const sideOf = (team, o) =>
          o ? { team, manager: o.manager, tier: o.tier, conf: o.conf, draft: o.draft }
            : { team, manager: null, tier: null, conf: null, draft: team };
        /* CFBD's /games carries no clock, period or status, so a game in flight
           is only ever "kicked off and not yet marked complete". If the feed
           happens to be carrying a partial score for one, pass it through; when
           it is not, the row still stands on the fact that the game started.
           Live detail proper lives on /scoreboard, which is a second call per
           run and would put the cron over the free tier's 1,000 a month. */
        const lhp = homePts(g), lap = awayPts(g);
        const partial = typeof lhp === "number" && typeof lap === "number"
          ? { home: lhp, away: lap }
          : undefined;
        upcoming.push({
          key: sortKey(g), id: g.id, week: weekOf(g), seasonType: seasonType(g), date: startDate(g),
          away: sideOf(a, oa),
          home: sideOf(h, oh),
          neutral: pick(g, "neutralSite", "neutral_site") === true,
          h2h: Boolean(oh && oa),
          sameManager: Boolean(oh && oa && oh.manager === oa.manager),
          stakes: Math.max(oh ? val(oh.tier) : 0, oa ? val(oa.tier) : 0),
          spread: lines.games[g.id] ?? null,
          partial,
        });
      }
      continue;
    }

    const hp = homePts(g), ap = awayPts(g);

    if (state !== "final") {
      /* Same test as results: a game between two teams nobody drafted moves
         nothing and belongs in no list this league reads. */
      if (oh || oa) {
        unscored.push({
          key: sortKey(g), week: weekOf(g), seasonType: seasonType(g), date: startDate(g),
          away: scoredSide(a, oa),
          home: scoredSide(h, oh),
          /* Names the state, never a cause. The feed cannot tell weather from a
             forfeit from its own outage, and a page that guessed would be
             confidently wrong in front of eight people who watched the game.

             By the time a game is unusable, two numeric scores can only be
             equal ones, so the tie is read off the scores being present rather
             than compared: hp === ap would call a game the feed never scored a
             tie, since null === null. */
          reason: state === "stalled" ? "no result"
            : typeof hp === "number" && typeof ap === "number" ? "tied"
              : "no score",
        });
      }
      continue;
    }

    const winner = hp > ap ? h : a;
    const loser = hp > ap ? a : h;

    for (const [team, rec] of [[h, rh], [a, ra]]) {
      if (!rec) continue;
      const won = team === winner;
      if (won) rec.wins++; else rec.losses++;
      const o = owners.get(team);
      const tier = o ? o.tier : POWER.has(rec.conf) ? "p4" : "g5";
      if (won) rec.points += val(tier);
      if (!o) continue;
      const M = managers[o.manager], T = M.teams[team];
      if (won) { T.wins++; M.wins++; T.points += val(o.tier); M.points += val(o.tier); }
      else { T.losses++; M.losses++; }
    }

    /* The stored line is whatever the books had when build-lines last ran,
       which for a finished game is the closing line. A pick-em has no favourite
       and so can never be an upset, and a game the books never priced simply
       goes untagged. */
    const line = lines.games[g.id] ?? null;
    /* A modelled price is not a market, and every figure below this line is a
       statement about what the market said. FPI exists in this file only so
       the projection can reach a game the books ignored; letting it into luck,
       the expected record or upset tagging would make "the closing lines
       expected" false on exactly the games nobody can check. */
    const market = line && line.model !== true ? line : null;
    const upset = Boolean(market && market.favorite && market.favorite !== winner);

    if (oh || oa) {
      /* Luck, one game at a time. The line is the stored closing price, and it
         is the only thing needed: `closed` is never consulted, because it is
         only ever set by a run that fetched that game's date, so every game
         finished before the flag shipped will never carry it and CFBD cannot
         set it at all. The spread survives regardless, and the spread is what
         the model reads. An unpriced game is excluded from both sides of the
         subtraction rather than treated as a coin flip. */
      if (!market) {
        luckUnpriced++;
      } else {
        luckPriced++;
        for (const [team, o] of [[h, oh], [a, oa]]) {
          if (!o) continue;
          luckLedger[o.manager].push({
            value: val(o.tier),
            probability: winProbability(market, team),
            won: team === winner,
          });
        }
      }

      const ow = owners.get(winner);
      results.push({
        key: sortKey(g), week: weekOf(g), seasonType: seasonType(g), date: startDate(g),
        winner: scoredSide(winner, ow),
        loser: scoredSide(loser, owners.get(loser)),
        score: `${Math.max(hp, ap)}-${Math.min(hp, ap)}`,
        /* what the win was worth to its owner, and 0 when an undrafted team
           beat a drafted one, which is the shape of a bad Saturday */
        points: ow ? val(ow.tier) : 0,
        h2h: Boolean(oh && oa),
        sameManager: Boolean(oh && oa && oh.manager === oa.manager),
        upset,
        /* The market's line or nothing. A results row reading "Arkansas State
           FPI" would present a forecast as the price that was on offer. */
        line: market ? market.formatted : null,
      });
    }

    if (owners.has(winner) && owners.has(loser)) {
      headToHead.push({
        week: weekOf(g), seasonType: seasonType(g), date: startDate(g),
        winner: { team: winner, manager: owners.get(winner).manager },
        loser: { team: loser, manager: owners.get(loser).manager },
        score: `${Math.max(hp, ap)}-${Math.min(hp, ap)}`,
        sameManager: owners.get(winner).manager === owners.get(loser).manager,
        spread: market,
        upset,
      });
    }
  }

  const missing = [...owners.keys()].filter((t) => !seenTeams.has(t));
  const fullFeed = games.length > 500;
  if (missing.length && fullFeed) {
    console.error("These roster teams matched no games in the CFBD feed:");
    for (const t of missing) console.error(`  ${t}  (${owners.get(t).manager})`);
    console.error("Fix data/rosters.json before trusting this output.");
    process.exit(1);
  } else if (missing.length) {
    console.warn(`note: ${missing.length} roster teams absent from a partial feed (${games.length} games), skipping name check`);
  }

  for (const M of Object.values(managers)) {
    for (const T of Object.values(M.teams)) T.ceiling = T.points + T.remaining * val(T.tier);
    const raw = Object.values(M.teams).reduce((s, t) => s + t.ceiling, 0);
    M.collisionLoss = collisionLoss[M.manager] ?? 0;
    M.ceiling = raw - M.collisionLoss;
  }

  const table = Object.values(managers).sort(
    (x, y) => y.points - x.points || y.wins - x.wins || x.manager.localeCompare(y.manager)
  );

  const projection = project(table, upcoming, lines, val);

  const byConference = {};
  for (const c of ALL_CONFS) byConference[c] = [];
  for (const rec of all.values()) {
    if (!CONF_SET.has(rec.conf)) continue; // drops FCS opponents and independents
    const o = owners.get(rec.team);
    byConference[rec.conf].push({
      team: rec.team,
      tier: POWER.has(rec.conf) ? "p4" : "g5",
      wins: rec.wins, losses: rec.losses, points: rec.points, remaining: rec.remaining,
      manager: o ? o.manager : null,
    });
  }
  for (const c of ALL_CONFS) {
    byConference[c].sort((x, y) => y.points - x.points || y.wins - x.wins || x.team.localeCompare(y.team));
  }

  upcoming.sort((x, y) => x.key.localeCompare(y.key) || String(x.date).localeCompare(String(y.date)));
  const nextKey = upcoming.length ? upcoming[0].key : null;
  const gow = upcoming.filter((u) => u.key === nextKey)
    .sort((x, y) => Number(y.h2h) - Number(x.h2h) || y.stakes - x.stakes ||
                    String(x.date).localeCompare(String(y.date)));

  return {
    generatedAt: new Date(NOW).toISOString(),
    season: doc.season,
    scoring: PTS,
    postseasonScheduled: games.some((g) => isPost(g)),
    linesFetchedAt: lines.fetchedAt,
    standings: table,
    projection,
    luck: {
      /* Both counts, always, because the second is what makes the first
         readable. `games` is the settled rostered games the ledger covers and
         `unpriced` the settled rostered games it had to leave out, so the page
         can say what share of the season the number is speaking for rather than
         implying it is all of it. */
      games: luckPriced,
      unpriced: luckUnpriced,
      /* In table order, like projection.managers, so the golden file reads down
         the same list twice rather than down the standings once and the roster
         file once. */
      managers: Object.fromEntries(
        table.map((r) => [r.manager, luckOf(luckLedger[r.manager])])),
    },
    byWeek: buildByWeek(doc, owners, games, PTS, lines),
    gamesOfWeek: {
      label: gow.length ? (gow[0].seasonType === "postseason" ? `Postseason ${gow[0].week}` : `Week ${gow[0].week}`) : null,
      games: gow,
    },
    /* Ordered like the timeline rather than by reason, because it is read as
       "what happened to week 2" and not as a list of feed defects. */
    unscored: unscored.sort((x, y) => x.key.localeCompare(y.key) ||
                                      String(x.date).localeCompare(String(y.date))),
    byConference,
    headToHead: headToHead.sort((a, b) => String(a.date).localeCompare(String(b.date))),
    results: results.sort((a, b) => a.key.localeCompare(b.key) ||
                                    String(a.date).localeCompare(String(b.date))),
  };
}

/* Projects the next scheduled week two ways.

   The first hands every game to the side the book favours. Deliberately naive:
   a spread is a market probability, not a verdict, so this is "if every
   favourite holds", not a forecast. Pick-ems and unpriced games are counted as
   unprojected rather than guessed at.

   The second weights each game by the chance the model gives it, which is
   strictly more of the information in the line - a one-point favourite and a
   four-touchdown favourite are the same certainty to the first and are not to
   the second. It is published *alongside* the naive one rather than instead of
   it: the existing fields keep their names and their meaning, because a
   browser holding cached JS reads them and must not break on the new payload.
   Same optional-field discipline as results, unscored and byWeek[].scheduled. */
function project(table, upcoming, lines, val) {
  const keys = [...new Set(upcoming.map((u) => u.key))].sort();
  if (!keys.length) return null;
  const key = keys[0];
  const week = upcoming.filter((u) => u.key === key);

  const delta = {};
  const expected = {};
  for (const row of table) {
    delta[row.manager] = { wins: 0, losses: 0, points: 0 };
    expected[row.manager] = 0;
  }

  /* Two ways a game reaches the end of this loop unprojected, and they are
     different sentences: the books never priced it, or they priced it and
     called it even. `unprojected` stays as their sum because a browser holding
     cached JS reads it, and the two halves ride alongside so the caption can
     say which happened rather than asserting the commoner one. */
  let projected = 0, unprojected = 0, unpriced = 0, pickems = 0, modelled = 0;
  for (const g of week) {
    const line = g.spread;

    /* Expected points run over every priced game including the pick-ems the
       naive projection skips: a pick-em tells the naive one nothing, because it
       names no favourite to hand the game to, and tells this one that each side
       is worth half its value. */
    for (const sd of [g.home, g.away]) {
      if (!sd.manager) continue;
      const p = winProbability(line, sd.team);
      if (p === null) continue;
      expected[sd.manager] += p * val(sd.tier);
    }

    if (!line || !line.favorite) {
      unprojected++;
      if (line) pickems++; else unpriced++;
      continue;
    }
    projected++;
    /* Projected, and worth saying how. A game reaching the end of the week
       on ESPN's forecast rather than on a price is still a game in the total,
       and the column header says "if every betting favourite wins". */
    if (line.model === true) modelled++;
    for (const sd of [g.home, g.away]) {
      if (!sd.manager) continue;
      if (sd.team === line.favorite) {
        delta[sd.manager].wins++;
        delta[sd.manager].points += val(sd.tier);
      } else {
        delta[sd.manager].losses++;
      }
    }
  }

  const proj = table.map((r) => ({
    manager: r.manager,
    wins: r.wins + delta[r.manager].wins,
    losses: r.losses + delta[r.manager].losses,
    points: r.points + delta[r.manager].points,
  }));
  proj.sort((x, y) => y.points - x.points || y.wins - x.wins || x.manager.localeCompare(y.manager));

  const rankNow = new Map(table.map((r, i) => [r.manager, i]));
  const rankProj = new Map(proj.map((r, i) => [r.manager, i]));

  const pointsNow = new Map(table.map((r) => [r.manager, r.points]));

  const managers = {};
  for (const r of proj) {
    const gain = round1(expected[r.manager]);
    managers[r.manager] = {
      wins: r.wins, losses: r.losses, points: r.points,
      gained: delta[r.manager].points,
      /* positive means climbing the table, i.e. a smaller index */
      rankDelta: rankNow.get(r.manager) - rankProj.get(r.manager),
      /* The two new fields. Both are added rather than substituted, and both
         are read through a fallback on the page, so the payload a browser is
         still holding from before this shipped renders exactly as it did.

         expectedPoints is derived from the *published* expectedGained rather
         than the full-precision sum, so the two numbers on screen add up to
         the digit they are printed to. */
      expectedGained: gain,
      expectedPoints: round1((pointsNow.get(r.manager) ?? 0) + gain),
    };
  }

  const [ord, wk] = key.split("|");
  return {
    key,
    label: ord === "1" ? `Postseason ${Number(wk)}` : `Week ${Number(wk)}`,
    games: week.length,
    projected,
    unprojected,
    unpriced,
    pickems,
    modelled,
    managers,
  };
}

function buildByWeek(doc, owners, games, PTS, lines) {
  const names = Object.keys(doc.managers);
  const buckets = new Map();
  /* Every rostered game the week holds, played or not, so a week can be shown
     as progress ("64/65 scored") rather than a bare count. A game between two
     rostered teams is one game here, same as in the played buckets. */
  const scheduled = new Map();
  for (const g of games) {
    if (!owners.has(home(g)) && !owners.has(away(g))) continue;
    const k = sortKey(g);
    scheduled.set(k, (scheduled.get(k) ?? 0) + 1);
    if (!isDone(g)) continue;
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(g);
  }

  const running = Object.fromEntries(names.map((n) => [n, { points: 0, wins: 0, losses: 0 }]));
  /* The expected record and the expected points, accumulated alongside the
     real ones: what the closing lines said a manager would have won, and been
     paid, by the end of each week - which is the week's own expectation plus
     every week before it. Kept at full precision here and rounded only where
     they are published, so a twelve-week total is not twelve roundings deep.

     `priced` is its denominator and travels with it, because the two records
     beside each other on the page are only comparable if a reader can see when
     they cover different games, and it is shared by both pairs because both
     run over exactly the same games. A settled game the books never priced is
     in neither: an unpriced game is not a coin flip we happen to know nothing
     about, it is a game this model has nothing to say about. */
  const expected = Object.fromEntries(names.map((n) =>
    [n, { wins: 0, priced: 0, won: 0, points: 0, banked: 0 }]));
  const out = [];

  for (const k of [...buckets.keys()].sort()) {
    const [ord, wk] = k.split("|");
    const delta = Object.fromEntries(names.map((n) => [n, 0]));
    for (const g of buckets.get(k)) {
      const hp = homePts(g), ap = awayPts(g);
      if (typeof hp !== "number" || typeof ap !== "number" || hp === ap) continue;
      const winner = hp > ap ? home(g) : away(g);
      const loser = hp > ap ? away(g) : home(g);
      const ow = owners.get(winner), ol = owners.get(loser);
      if (ow) {
        const p = PTS[ow.tier];
        running[ow.manager].points += p; running[ow.manager].wins++; delta[ow.manager] += p;
      }
      if (ol) running[ol.manager].losses++;

      /* Inside the guard above, not before it: a game that reached this
         function without a usable score produced no win and no loss, so it
         must not produce an expectation either. The stored line for a finished
         game is its closing line - the merge-only lines file never overwrites
         one with a later fetch - which is as close as this repo gets to a
         record of what was projected for that week at the time. */
      const line = lines.games[g.id] ?? null;
      /* Market prices only, for the same reason luck takes market prices only:
         this pair is published as what the closing lines expected. A modelled
         price leaves the game in neither column, exactly as an unpriced game
         does, and `priced` goes on reporting how many games the pair covers. */
      if (!line || line.model === true) continue;
      for (const team of [winner, loser]) {
        const o = owners.get(team);
        if (!o) continue;
        const p = winProbability(line, team);
        if (typeof p !== "number") continue;
        expected[o.manager].wins += p;
        expected[o.manager].priced += 1;
        /* The same probability, weighted by what the win was worth. That
           weighting is the whole difference between the two expectations: to
           the record a win is a win, and to the board a power-conference win
           is worth half again as much as a Group of Five one. Which is why
           both are published rather than one being derived from the other -
           a manager can be ahead of the market on the record and behind it on
           the points, by winning the cheap games and losing the dear one. */
        expected[o.manager].points += p * PTS[o.tier];
        /* The wins over *these* games, which is the only thing the expectation
           can honestly be compared against. It cannot be recovered on the page
           from the season record and a count: subtracting the unpriced games
           from a manager's wins assumes every one of them was a win, which for
           a manager sitting at 0-3 with one priced game produces minus two. */
        if (team === winner) {
          expected[o.manager].won += 1;
          /* and the points banked over those same games, for the same reason
             `won` is counted here: the points over the priced games cannot be
             recovered on the page from a season total and a game count, because
             nothing says which games the unpriced ones were or what they paid. */
          expected[o.manager].banked += PTS[o.tier];
        }
      }
    }
    out.push({
      key: k,
      label: ord === "1" ? `Postseason ${Number(wk)}` : `Week ${Number(wk)}`,
      seasonType: ord === "1" ? "postseason" : "regular",
      week: Number(wk),
      games: buckets.get(k).length,
      scheduled: scheduled.get(k) ?? buckets.get(k).length,
      delta,
      /* Rounded here rather than accumulated rounded, and the losses derived
         from the *published* wins so the pair on screen adds back to `priced`
         exactly - the same rule `delta` follows in luckOf. */
      cumulative: Object.fromEntries(names.map((n) => {
        const w = round1(expected[n].wins);
        return [n, {
          ...running[n],
          expectedWins: w,
          expectedLosses: round1(expected[n].priced - w),
          priced: expected[n].priced,
          pricedWins: expected[n].won,
          expectedPoints: round1(expected[n].points),
          pricedPoints: expected[n].banked,
        }];
      })),
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */

const { doc, owners } = loadRosters();
const lines = loadLines();
const games = await fetchGames(doc.season);
const out = build(doc, owners, games, lines);

console.log(`games in feed: ${games.length}`);
console.log("  manager     pts   W-L     left  ceiling");
for (const s of out.standings) {
  console.log(
    `  ${s.manager.padEnd(10)} ${String(s.points).padStart(3)}  ${`${s.wins}-${s.losses}`.padEnd(7)}` +
    `${String(s.remaining).padStart(4)}  ${String(s.ceiling).padStart(5)}` +
    (s.collisionLoss ? `   (-${s.collisionLoss} own matchup)` : "")
  );
}
const priced = out.gamesOfWeek.games.filter((g) => g.spread).length;
console.log(`games of the week (${out.gamesOfWeek.label ?? "none"}): ${out.gamesOfWeek.games.length}` +
  (lines.fetchedAt ? `, ${priced} with a spread` : ", no lines file"));
if (out.projection) {
  const p = out.projection;
  console.log(`projection (${p.label}): ${p.projected}/${p.games} games priced` +
    (p.unprojected ? `, ${p.unprojected} unprojected` : ""));
  const gains = out.standings.map((s) => `${s.manager} +${p.managers[s.manager].expectedGained}`);
  console.log(`  expected points: ${gains.join(", ")}`);
}
/* Printed with its denominator every run. The number this whole feature is
   worth is "luck over the games we have prices for", and the run log is where
   a season that quietly stops being priced should first become obvious. */
{
  const l = out.luck;
  console.log(`luck over ${l.games} priced game(s)` +
    (l.unpriced ? `, ${l.unpriced} settled game(s) with no line excluded` : ""));
  for (const s of out.standings) {
    const m = l.managers[s.manager];
    if (!m.games) continue;
    console.log(`  ${s.manager.padEnd(10)} ${String(m.actual).padStart(3)} banked, ` +
      `${String(m.expected).padStart(5)} expected  ${m.delta >= 0 ? "+" : ""}${m.delta}`);
  }
}
/* Printed even when it is zero: this is the count that used to be silent, and
   a run that starts dropping games from every ceiling should say so in its own
   log rather than only in the payload. */
console.log(`unscored (never resolved, excluded from points and ceiling): ${out.unscored.length}`);
for (const u of out.unscored) {
  console.log(`  ${u.seasonType === "postseason" ? "P" : "wk"}${u.week} ` +
    `${u.away.team} at ${u.home.team} - ${u.reason}`);
}
const upsets = out.headToHead.filter((h) => h.upset).length;
console.log(`head to head played: ${out.headToHead.length}` + (upsets ? `, ${upsets} upset(s)` : ""));
console.log(`scored games with a drafted team: ${out.results.length}` +
  ` across ${new Set(out.results.map((r) => r.key)).size} week(s)`);

if (DRY) {
  console.log("dry run, not writing");
} else {
  if (FIXTURE && OUT.endsWith("/public/standings.json")) {
    console.error("Refusing to write a fixture build to public/standings.json.");
    console.error("That is the live file the site reads. Pass --out to redirect it.");
    process.exit(1);
  }
  mkdirSync(dirname(OUT), { recursive: true });
  const write = (path, doc) => {
    writeFileSync(path, JSON.stringify(doc, null, 2) + "\n");
    console.log(`wrote ${path}`);
  };

  if (UNION) {
    write(OUT, out);
  } else {
    /* The siblings are named off the core's own basename rather than fixed, so
       `--out fixtures/sample-standings.json` cannot scatter a bare
       `results.json` next to a `sample-` prefixed golden. A path the prefix
       cannot be read from is refused: guessing at it would put the payload
       somewhere nobody goes looking, which reads as a missing section on the
       site and as a successful run in the log. */
    const base = basename(OUT);
    if (!base.endsWith("standings.json")) {
      console.error(`--out must name a *standings.json file; got ${base}.`);
      console.error("The results and teams files are named from its prefix.");
      process.exit(1);
    }
    const prefix = base.slice(0, -"standings.json".length);
    const parts = splitPayload(out);
    write(OUT, parts.core);
    for (const [file, doc] of Object.entries(parts)) {
      if (file === "core") continue;
      write(join(dirname(OUT), `${prefix}${file}.json`), doc);
    }
  }
}
