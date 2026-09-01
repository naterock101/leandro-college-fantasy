#!/usr/bin/env node
/**
 * One-off check: does every school string in data/rosters.json exist in CFBD,
 * and does its conference match what we recorded?
 *
 * Run this once before the season and any time realignment news breaks.
 * Costs 1 API call.
 *
 *   CFBD_API_KEY=... node scripts/verify-teams.mjs
 *
 * Exits non-zero if anything is wrong, so it can gate CI.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const doc = JSON.parse(readFileSync(resolve(ROOT, "data/rosters.json"), "utf8"));

const key = process.env.CFBD_API_KEY;
if (!key) { console.error("CFBD_API_KEY is not set."); process.exit(1); }

const res = await fetch(`https://api.collegefootballdata.com/teams?year=${doc.season}`, {
  headers: { Authorization: `Bearer ${key}` },
});
if (!res.ok) { console.error(`CFBD returned ${res.status} ${res.statusText}`); process.exit(1); }

const teams = await res.json();
const bySchool = new Map();
for (const t of teams) {
  const school = t.school ?? t.School;
  const conference = t.conference ?? t.Conference ?? null;
  if (school) bySchool.set(school, conference);
}

/* crude similarity, good enough to suggest the right string for a typo */
const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
const near = (want) => {
  const w = norm(want);
  return [...bySchool.keys()]
    .map((s) => {
      const n = norm(s);
      let score = 0;
      if (n === w) score = 100;
      else if (n.startsWith(w) || w.startsWith(n)) score = 80;
      else if (n.includes(w) || w.includes(n)) score = 60;
      return { s, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((x) => x.s);
};

let bad = 0, warned = 0;
console.log(`CFBD returned ${bySchool.size} teams for ${doc.season}\n`);

for (const [manager, roster] of Object.entries(doc.managers)) {
  for (const t of roster) {
    if (!bySchool.has(t.cfbd)) {
      bad++;
      const guesses = near(t.cfbd);
      console.error(`MISSING  ${manager.padEnd(8)} "${t.cfbd}"`);
      if (guesses.length) console.error(`         did you mean: ${guesses.map((g) => `"${g}"`).join(", ")}`);
      continue;
    }
    const apiConf = bySchool.get(t.cfbd);
    if (apiConf && apiConf !== t.conf) {
      warned++;
      console.warn(`CONF     ${manager.padEnd(8)} "${t.cfbd}" rosters.json says ${t.conf}, CFBD says ${apiConf}`);
    }
  }
}

console.log("");
if (bad) {
  console.error(`${bad} name mismatch(es). Fix data/rosters.json before running the standings build.`);
  process.exit(1);
}
if (warned) {
  console.warn(`${warned} conference mismatch(es). Point values come from "tier", not "conf", so scoring is unaffected,`);
  console.warn(`but the one-team-per-conference validation uses "conf", so reconcile these.`);
  process.exit(1);
}
console.log("All 80 school names resolve and every conference matches. Good to go.");
