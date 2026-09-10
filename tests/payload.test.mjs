/**
 * The payload split, and the contract that makes a missing piece survivable.
 *
 * One 91KB file was refetched whole by every open tab every two minutes, and
 * `results` is the term that grows: ~64 entries a week, so ~1,000 and ~275KB
 * raw by the time the playoff is over. Splitting it is only safe if two things
 * are true, and both are asserted here rather than assumed:
 *
 *   1. Nothing is lost. The union of the written files is byte-for-byte the
 *      payload the builder computed - no key dropped, none written twice.
 *   2. Nothing is required. A tab whose file 404s, or has not been fetched
 *      yet, gets an empty collection and renders its empty state, never
 *      `undefined` and a thrown render.
 *
 * The second is the one that matters in production: the lazy files are fetched
 * from a branch the bot pushes to, and the window between deploying this and
 * that branch existing is a window where every lazy fetch fails.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { CORE, LAZY, splitPayload, mergePayload } from "../lib/payload.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const GAMES = join(ROOT, "fixtures/sample-games.json");
const GOLDEN = join(ROOT, "fixtures/sample-standings.json");

/** Runs the builder into a fresh directory and returns the paths it wrote to. */
function runBuilder(...extra) {
  const dir = mkdtempSync(join(tmpdir(), "payload-"));
  const out = join(dir, "standings.json");
  const r = spawnSync(process.execPath,
    [join(ROOT, "scripts/build-standings.mjs"), "--fixture", GAMES, "--out", out, ...extra],
    { encoding: "utf8" });
  assert.equal(r.status, 0, `builder exited ${r.status}\n${r.stderr}`);
  return { dir, out };
}

const read = (p) => JSON.parse(readFileSync(p, "utf8"));

/* ------------------------------------------------------------------ */
/* the split writer                                                    */
/* ------------------------------------------------------------------ */

test("a live build writes one file per audience, named beside the core", () => {
  const { dir } = runBuilder();
  for (const name of ["standings.json", "results.json", "teams.json"]) {
    assert.ok(existsSync(join(dir, name)), `${name} was not written`);
  }
});

test("the union of the written files is exactly the payload", () => {
  /* The whole safety argument for splitting. `--union` writes what the builder
     computed to a single file, and that file is also the golden the rest of
     the suite diffs, so this compares the split against the payload the repo
     already agrees is correct rather than against a second opinion. */
  const { dir } = runBuilder();
  const union = { ...read(join(dir, "standings.json")),
                  ...read(join(dir, "results.json")),
                  ...read(join(dir, "teams.json")) };
  assert.deepEqual(union, read(GOLDEN));
});

test("no key is written twice, and none is written nowhere", () => {
  /* deepEqual on the union above would pass if a key were in two files with
     the same value, and that is exactly the shape of the bug that doubles the
     bytes we set out to save. Counted rather than merged. */
  const { dir } = runBuilder();
  const files = ["standings.json", "results.json", "teams.json"]
    .map((n) => read(join(dir, n)));
  const seen = new Map();
  for (const f of files) for (const k of Object.keys(f)) seen.set(k, (seen.get(k) ?? 0) + 1);
  const twice = [...seen].filter(([, n]) => n > 1).map(([k]) => k);
  assert.deepEqual(twice, [], "written in more than one file");
  assert.deepEqual([...seen.keys()].sort(), Object.keys(read(GOLDEN)).sort());
});

test("the core carries the first paint and nothing that only a tab needs", () => {
  /* The point of the exercise: `results`, `headToHead` and `byConference` are
     ~70% of the bytes and none of them is on screen when the page opens. */
  const { dir } = runBuilder();
  const core = read(join(dir, "standings.json"));
  for (const k of Object.values(LAZY).flat()) {
    assert.equal(k in core, false, `${k} is still in the core payload`);
  }
  /* `awards` is in this list and not in the lazy one, which looks backwards
     and is not. It is the *reduction* of `results` - six records under a
     kilobyte, constant in size for the rest of the season - so shipping the
     answer in the core costs a rounding error on every poll, where making the
     Trophies tab fetch the 60KB array it came from would put a spinner on a
     tab that renders six lines. */
  for (const k of ["standings", "projection", "byWeek", "gamesOfWeek", "unscored",
                   "awards", "generatedAt", "season", "scoring", "postseasonScheduled",
                   "linesFetchedAt"]) {
    assert.ok(k in core, `${k} is missing from the core payload`);
  }
  assert.deepEqual(Object.keys(core).sort(), [...CORE].sort());
});

test("--union writes the whole payload to the one path it was given", () => {
  /* How the golden is regenerated. A golden split across three files is three
     diffs to read, and could not state the invariant above. */
  const dir = mkdtempSync(join(tmpdir(), "payload-"));
  const out = join(dir, "sample-standings.json");
  const r = spawnSync(process.execPath,
    [join(ROOT, "scripts/build-standings.mjs"), "--fixture", GAMES, "--out", out, "--union"],
    { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(read(out), read(GOLDEN));
  assert.equal(existsSync(join(dir, "sample-results.json")), false,
    "--union still wrote a sibling");
});

test("the sibling names come off the core's own basename", () => {
  /* So `--out fixtures/sample-standings.json` cannot scatter bare
     `results.json` next to a `sample-` prefixed golden. */
  const dir = mkdtempSync(join(tmpdir(), "payload-"));
  const r = spawnSync(process.execPath,
    [join(ROOT, "scripts/build-standings.mjs"), "--fixture", GAMES,
      "--out", join(dir, "sample-standings.json")],
    { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(join(dir, "sample-results.json")));
  assert.ok(existsSync(join(dir, "sample-teams.json")));
});

test("a core path the siblings cannot be named from is refused, not guessed at", () => {
  const dir = mkdtempSync(join(tmpdir(), "payload-"));
  const r = spawnSync(process.execPath,
    [join(ROOT, "scripts/build-standings.mjs"), "--fixture", GAMES,
      "--out", join(dir, "payload.json")],
    { encoding: "utf8" });
  assert.notEqual(r.status, 0, "silently wrote something under a name nobody asked for");
  assert.match(r.stderr, /standings\.json/);
});

test("--lines reads the spreads from where the run keeps them", () => {
  /* The workflow writes every payload file straight into a worktree of the
     `data` branch, which is also where the merge-only lines file lives now.
     Without this the builder would go on reading public/lines.json out of the
     code checkout - a path that no longer holds a lines file at all - and
     would quietly publish a season with no spreads on it. */
  const dir = mkdtempSync(join(tmpdir(), "payload-"));
  const lines = join(dir, "lines.json");
  const doc = read(join(ROOT, "fixtures/sample-lines.json"));
  doc.fetchedAt = "2001-02-03T04:05:06.000Z";
  writeFileSync(lines, JSON.stringify(doc));

  const out = join(dir, "standings.json");
  const r = spawnSync(process.execPath,
    [join(ROOT, "scripts/build-standings.mjs"), "--fixture", GAMES,
      "--lines", lines, "--out", out, "--union"],
    { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(read(out).linesFetchedAt, doc.fetchedAt);
});

test("a fixture build with no --lines still reads the fixture, never the live file", () => {
  /* The hermeticity guarantee the golden depends on. --lines is an explicit
     instruction and overrides it; the absence of --lines must not quietly
     start reading public/lines.json again, whose fetchedAt moves every few
     hours and made the golden undiffable. */
  const { out } = runBuilder("--union");
  assert.equal(read(out).linesFetchedAt,
    read(join(ROOT, "fixtures/sample-lines.json")).fetchedAt);
});

/* ------------------------------------------------------------------ */
/* splitPayload: the partition itself                                  */
/* ------------------------------------------------------------------ */

test("a key the split has never heard of stays in the core", () => {
  /* The partition is defined by what is lazy, so anything a later phase adds
     lands in the always-fetched file. That is the safe default: a new key in
     the core is a few bytes on every poll, a new key in no file at all is a
     section of the site that silently disappears. */
  const parts = splitPayload({ standings: [], luck: { adam: 3 }, results: [], headToHead: [],
                               byConference: {} });
  assert.deepEqual(parts.core.luck, { adam: 3 });
  assert.equal("luck" in parts.results, false);
  assert.equal("luck" in parts.teams, false);
});

test("splitting a payload that is missing a lazy section writes it as absent", () => {
  /* A snapshot built before `results` existed has no `results` key. The split
     must not invent one, or the page would read an empty timeline as fact
     where today it reads a missing one as "not written yet". */
  const parts = splitPayload({ standings: [], byConference: {} });
  assert.deepEqual(parts.results, {});
  assert.deepEqual(parts.teams, { byConference: {} });
});

/* ------------------------------------------------------------------ */
/* mergePayload: what the page sees when a file never arrives           */
/* ------------------------------------------------------------------ */

test("a core with no lazy files gives every tab an empty collection", () => {
  /* The degradation contract, stated once here so the page does not have to
     spell `?? []` at each of the six places it reads these. `undefined` is
     what throws; `[]` and `{}` are what render an empty state. */
  const merged = mergePayload({ standings: [], generatedAt: "x" }, {});
  assert.deepEqual(merged.results, []);
  assert.deepEqual(merged.headToHead, []);
  assert.deepEqual(merged.byConference, {});
  assert.equal(merged.generatedAt, "x");
});

test("a lazy file that arrived is used, and one that did not is still empty", () => {
  const merged = mergePayload({ standings: [] },
    { results: { results: [{ key: "0|01" }], headToHead: [] } });
  assert.equal(merged.results.length, 1);
  assert.deepEqual(merged.byConference, {});
});

test("merging every part back together reproduces the payload", () => {
  const full = read(GOLDEN);
  const parts = splitPayload(full);
  assert.deepEqual(mergePayload(parts.core, { results: parts.results, teams: parts.teams }), full);
});

test("a lazy file that is not an object is ignored rather than trusted", () => {
  /* raw.githubusercontent serves a 404 page as text/plain, and a fetch that
     followed a redirect to something HTML-shaped would parse to a string or
     null. Neither may reach the render. */
  for (const junk of [null, "Not Found", 42, []]) {
    const merged = mergePayload({ standings: [] }, { results: junk, teams: junk });
    assert.deepEqual(merged.results, [], `${JSON.stringify(junk)} got through`);
    assert.deepEqual(merged.byConference, {}, `${JSON.stringify(junk)} got through`);
  }
});
