#!/usr/bin/env node
/**
 * Builds public/standings.json from CollegeFootballData.
 *
 * One upstream call per run: the full season, both season types. Conference
 * championship games come back as seasonType "regular", bowls and playoff
 * games as "postseason". League rules count all of them, so we never branch
 * on season type, we just count completed games.
 *
 * Env: CFBD_API_KEY
 * Usage: node scripts/build-standings.mjs [--dry] [--fixture path.json] [--out path.json]
 *
 * --out redirects the write away from public/standings.json. Regenerating the
 * sample fixture must use it: writing the fixture build to the live file, even
 * for the moment before copying it back, publishes synthetic standings to
 * anyone whose page happens to poll in that window.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROSTERS = resolve(ROOT, "data/rosters.json");
const LINES = resolve(ROOT, "public/lines.json");
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

/* ------------------------------------------------------------------ */
/* field access: v2 is camelCase, snake_case kept as a fallback        */
/* ------------------------------------------------------------------ */

const pick = (g, ...names) => {
  for (const n of names) if (g[n] !== undefined && g[n] !== null) return g[n];
  return undefined;
};
const home = (g) => pick(g, "homeTeam", "home_team");
const away = (g) => pick(g, "awayTeam", "away_team");
const homePts = (g) => pick(g, "homePoints", "home_points");
const awayPts = (g) => pick(g, "awayPoints", "away_points");
const homeConf = (g) => pick(g, "homeConference", "home_conference");
const awayConf = (g) => pick(g, "awayConference", "away_conference");
const startDate = (g) => pick(g, "startDate", "start_date");
const seasonType = (g) => pick(g, "seasonType", "season_type") ?? "regular";
const weekOf = (g) => pick(g, "week") ?? 0;
const isDone = (g) => pick(g, "completed") === true;
const isPost = (g) => seasonType(g) === "postseason";
const sortKey = (g) => `${isPost(g) ? 1 : 0}|${String(weekOf(g)).padStart(2, "0")}`;

/* ------------------------------------------------------------------ */

/* Written by scripts/build-lines.mjs on the 8-hourly cron only, so most runs
   read a file they did not create. Missing or unreadable means no spreads this
   run, never a failure: standings must not depend on the betting feed. */
function loadLines() {
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

  const all = new Map();
  const touch = (team, conf) => {
    if (!team) return null;
    if (!all.has(team)) all.set(team, { team, conf: conf ?? null, wins: 0, losses: 0, points: 0, remaining: 0 });
    const rec = all.get(team);
    if (!rec.conf && conf) rec.conf = conf;
    return rec;
  };

  const headToHead = [];
  const upcoming = [];
  const seenTeams = new Set();
  const collisionLoss = {};

  for (const g of games) {
    const h = home(g), a = away(g);
    const rh = touch(h, homeConf(g)), ra = touch(a, awayConf(g));
    const oh = owners.get(h), oa = owners.get(a);
    if (oh) seenTeams.add(h);
    if (oa) seenTeams.add(a);

    if (!isDone(g)) {
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
      if (oh && oa) {
        upcoming.push({
          key: sortKey(g), week: weekOf(g), seasonType: seasonType(g), date: startDate(g),
          away: { team: a, manager: oa.manager, tier: oa.tier, conf: oa.conf, draft: oa.draft },
          home: { team: h, manager: oh.manager, tier: oh.tier, conf: oh.conf, draft: oh.draft },
          neutral: pick(g, "neutralSite", "neutral_site") === true,
          sameManager: oh.manager === oa.manager,
          stakes: Math.max(val(oh.tier), val(oa.tier)),
          spread: lines.games[g.id] ?? null,
        });
      }
      continue;
    }

    const hp = homePts(g), ap = awayPts(g);
    if (typeof hp !== "number" || typeof ap !== "number" || hp === ap) continue;
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

    if (owners.has(winner) && owners.has(loser)) {
      /* The stored line is whatever the books had when build-lines last ran,
         which for a finished game is the closing line. A pick-em has no
         favourite and so can never be an upset, and a game the books never
         priced simply goes untagged. */
      const line = lines.games[g.id] ?? null;
      headToHead.push({
        week: weekOf(g), seasonType: seasonType(g), date: startDate(g),
        winner: { team: winner, manager: owners.get(winner).manager },
        loser: { team: loser, manager: owners.get(loser).manager },
        score: `${Math.max(hp, ap)}-${Math.min(hp, ap)}`,
        sameManager: owners.get(winner).manager === owners.get(loser).manager,
        spread: line,
        upset: Boolean(line && line.favorite && line.favorite !== winner),
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
    .sort((x, y) => y.stakes - x.stakes || String(x.date).localeCompare(String(y.date)));

  return {
    generatedAt: new Date().toISOString(),
    season: doc.season,
    scoring: PTS,
    postseasonScheduled: games.some((g) => isPost(g)),
    linesFetchedAt: lines.fetchedAt,
    standings: table,
    byWeek: buildByWeek(doc, owners, games, PTS),
    gamesOfWeek: {
      label: gow.length ? (gow[0].seasonType === "postseason" ? `Postseason ${gow[0].week}` : `Week ${gow[0].week}`) : null,
      games: gow,
    },
    byConference,
    headToHead: headToHead.sort((a, b) => String(a.date).localeCompare(String(b.date))),
  };
}

function buildByWeek(doc, owners, games, PTS) {
  const names = Object.keys(doc.managers);
  const buckets = new Map();
  for (const g of games) {
    if (!isDone(g)) continue;
    if (!owners.has(home(g)) && !owners.has(away(g))) continue;
    const k = sortKey(g);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(g);
  }

  const running = Object.fromEntries(names.map((n) => [n, { points: 0, wins: 0, losses: 0 }]));
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
    }
    out.push({
      key: k,
      label: ord === "1" ? `Postseason ${Number(wk)}` : `Week ${Number(wk)}`,
      seasonType: ord === "1" ? "postseason" : "regular",
      week: Number(wk),
      games: buckets.get(k).length,
      delta,
      cumulative: JSON.parse(JSON.stringify(running)),
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
const upsets = out.headToHead.filter((h) => h.upset).length;
console.log(`head to head played: ${out.headToHead.length}` + (upsets ? `, ${upsets} upset(s)` : ""));

if (DRY) {
  console.log("dry run, not writing");
} else {
  if (FIXTURE && OUT.endsWith("/public/standings.json")) {
    console.error("Refusing to write a fixture build to public/standings.json.");
    console.error("That is the live file the site reads. Pass --out to redirect it.");
    process.exit(1);
  }
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
  console.log(`wrote ${OUT}`);
}
