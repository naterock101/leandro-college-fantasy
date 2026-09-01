#!/usr/bin/env node
/**
 * Builds public/lines.json from CollegeFootballData's /lines endpoint.
 *
 * This is a SECOND upstream endpoint and therefore a second call, which is why
 * it does not run on every poll. The 10-minute game-day schedule would push us
 * to ~1,332 calls/month against a 1,000 cap. Instead the workflow runs this
 * only on the 8-hourly baseline cron (and manual dispatch), roughly 93 calls a
 * month, for ~759 total. Spreads do not move meaningfully between polls and
 * stop mattering once a game kicks off, so 8-hour freshness is plenty.
 *
 * Output is its own file rather than part of standings.json on purpose: the
 * 10-minute standings runs re-read it and re-attach whatever is there, so
 * spreads never flicker in and out between runs that did and did not fetch.
 *
 * Env: CFBD_API_KEY
 * Usage: node scripts/build-lines.mjs [--dry] [--out path.json]
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROSTERS = resolve(ROOT, "data/rosters.json");
const API = "https://api.collegefootballdata.com/lines";

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
const OUT = resolve(ROOT, flagValue("--out") ?? "public/lines.json");

/* CFBD returns several books per game, and has been seen to spell the same one
   two ways. Normalise, then take the first preference that is present. */
const PREFERENCE = ["draftkings", "bovada"];
const normProvider = (p) => String(p ?? "").toLowerCase().replace(/[^a-z]/g, "");

/* Same camelCase/snake_case defence build-standings.mjs applies to /games. */
const pick = (g, ...names) => {
  for (const n of names) if (g[n] !== undefined && g[n] !== null) return g[n];
  return undefined;
};
const homeOf = (g) => pick(g, "homeTeam", "home_team");
const awayOf = (g) => pick(g, "awayTeam", "away_team");

const doc = JSON.parse(readFileSync(ROSTERS, "utf8"));

const key = process.env.CFBD_API_KEY;
if (!key) { console.error("CFBD_API_KEY is not set."); process.exit(1); }

const res = await fetch(`${API}?year=${doc.season}`, {
  headers: { Authorization: `Bearer ${key}` },
});
if (!res.ok) { console.error(`CFBD returned ${res.status} ${res.statusText}`); process.exit(1); }
const games = await res.json();

const pickLine = (lines) => {
  if (!Array.isArray(lines) || !lines.length) return null;
  for (const want of PREFERENCE) {
    const hit = lines.find((l) => normProvider(l.provider) === want && typeof l.spread === "number");
    if (hit) return hit;
  }
  return lines.find((l) => typeof l.spread === "number") ?? null;
};

const out = {};
let priced = 0;
let unnamed = 0;
for (const g of games) {
  const line = pickLine(g.lines);
  if (!line) continue;
  /* CFBD states the spread from the home team's perspective: negative means
     the home team is favoured. */
  const spread = line.spread;
  const favorite = spread === 0 ? null : spread < 0 ? homeOf(g) : awayOf(g);
  /* No team name means we cannot say who was favoured, and a spread with no
     favourite would render as "undefined -7". Drop it rather than ship that. */
  if (spread !== 0 && !favorite) { unnamed++; continue; }
  out[g.id] = {
    spread,
    favorite,
    formatted: spread === 0 ? "PK" : `${favorite} ${-Math.abs(spread)}`,
    overUnder: typeof line.overUnder === "number" ? line.overUnder : null,
    provider: line.provider,
  };
  priced++;
}

const payload = {
  fetchedAt: new Date().toISOString(),
  season: doc.season,
  games: out,
};

console.log(`games in lines feed: ${games.length}`);
console.log(`games with a usable spread: ${priced}`);
if (unnamed) console.warn(`note: ${unnamed} priced game(s) had no resolvable team name, skipped`);

if (DRY) {
  console.log("dry run, not writing");
} else {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(payload, null, 2) + "\n");
  console.log(`wrote ${OUT}`);
}
