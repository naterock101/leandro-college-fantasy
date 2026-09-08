/**
 * The logo map, checked as data.
 *
 * The rendering half of this phase is in `tests/logos.test.tsx`, because it
 * needs a DOM. What is here is the part that has nothing to do with the DOM
 * and everything to do with the one rule the repo is built around: the map is
 * keyed on the exact CFBD school string, so `Miami` and `Miami (OH)` are two
 * different teams with two different logos and no amount of prefix, substring
 * or normalisation ever brings them together.
 *
 * It also holds the coverage assertion. A logo map that quietly lost half the
 * league would look fine in every screenshot taken of the half it kept, so the
 * count is asserted rather than eyeballed, and a school that stops resolving
 * fails here with its own name in the message.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => JSON.parse(readFileSync(resolve(ROOT, p), "utf8"));

const logos = read("data/logos.json");
const rosters = read("data/rosters.json");

const rostered = Object.values(rosters.managers).flatMap((r) => r.map((t) => t.cfbd));

/**
 * Schools we know we have no logo for, each with the reason.
 *
 * It is empty, and that is the point: it exists so that a school which stops
 * resolving has to be written down as a deliberate gap by a human, rather than
 * disappearing into a passing test. Anything not listed here must resolve.
 */
const KNOWN_GAPS = [];

describe("the logo map", () => {
  test("is keyed on the exact CFBD school string", () => {
    assert.equal(typeof logos.teams, "object");
    assert.ok(logos.teams !== null);
    /* A stray leading or trailing space in a key is invisible in the file and
       silently breaks the join for exactly one team. */
    for (const key of Object.keys(logos.teams)) {
      assert.equal(key, key.trim(), `"${key}" is not trimmed`);
      assert.notEqual(key, "", "empty key");
    }
  });

  test("every entry has an https logo, in the shape the page reads", () => {
    for (const [school, entry] of Object.entries(logos.teams)) {
      /* https and not http. CFBD serves these URLs over http, the site is
         https, and a mixed-content image is blocked and renders as nothing -
         which is the one failure mode this phase exists to make impossible. */
      assert.match(entry.logo, /^https:\/\/a\.espncdn\.com\//, `${school} logo host`);
      /* Colours are optional and null when the feed has none, rather than
         invented. Twelve of the FCS opponents in the map have no alternate
         colour; making one up would be worse than not having it. */
      for (const field of ["color", "altColor"]) {
        if (entry[field] !== null) assert.match(entry[field], /^#[0-9a-f]{6}$/, `${school} ${field}`);
      }
    }
  });

  test("every rostered school has both colours", () => {
    /* The gap above is tolerable for an FCS opponent that appears twice all
       season. For a drafted team it is not, because anything a later phase
       colours by team - a chart line, a badge - has eighty of these to work
       from and no fallback worth having. */
    const thin = rostered.filter((s) => {
      const e = logos.teams[s];
      return e && (!e.color || !e.altColor);
    });
    assert.deepEqual(thin, []);
  });

  test("every rostered school resolves, or is a written-down gap", () => {
    const missing = rostered.filter((s) => !(s in logos.teams) && !KNOWN_GAPS.includes(s));
    assert.deepEqual(missing, [], `no logo for: ${missing.join(", ")}`);
    assert.equal(rostered.length, 80);
  });

  describe("the name traps", () => {
    /* Each pair is two schools that a substring or prefix match would collapse
       into one. If the map ever gives them the same logo, the page shows one
       manager another manager's team. */
    const pairs = [
      ["Miami", "Miami (OH)"],
      ["Ohio", "Ohio State"],
      /* The README calls this one "Louisiana vs Louisiana Monroe". CFBD's
         string is `UL Monroe`, so the prefix trap Louisiana actually has is
         Louisiana Tech - which is the same lesson and a different string. */
      ["Louisiana", "Louisiana Tech"],
      ["Texas", "Texas State"],
      ["Texas", "Texas A&M"],
    ];

    for (const [a, b] of pairs) {
      test(`${a} and ${b} are different teams`, () => {
        const x = logos.teams[a];
        const y = logos.teams[b];
        assert.ok(x, `no entry for ${a}`);
        assert.ok(y, `no entry for ${b}`);
        assert.notEqual(x.logo, y.logo, `${a} and ${b} share a logo`);
      });
    }

    test("the accented and punctuated schools are stored as rosters.json spells them", () => {
      /* Not a cosmetic point. `data/rosters.json` is the join, so the map has
         to carry its exact bytes - one normalisation form or one apostrophe
         out and two of the eighty teams silently lose their logo. */
      for (const school of ["San José State", "Hawai'i", "Texas A&M"]) {
        assert.ok(rostered.includes(school), `${school} is not in rosters.json as written`);
        assert.ok(logos.teams[school], `no logo entry for ${school}`);
      }
    });
  });

  test("covers more than the draft board", () => {
    /* Game rows name the opponent too, and most opponents are undrafted. A map
       of only the 80 drafted teams would leave every game row half-drawn. */
    assert.ok(
      Object.keys(logos.teams).length >= 130,
      `only ${Object.keys(logos.teams).length} teams in the map`
    );
  });
});

describe("scripts/build-logos.mjs", () => {
  /* The script is run by hand, so its behaviour when a person gets it wrong is
     as much of the deliverable as the file it writes. Every case below runs
     the real script; none of them touch the network or need a key. */
  const run = (argv, env = {}) =>
    spawnSync(process.execPath, [resolve(ROOT, "scripts/build-logos.mjs"), ...argv], {
      cwd: ROOT,
      encoding: "utf8",
      env: { ...process.env, CFBD_API_KEY: undefined, ...env },
    });

  test("says what is missing when there is no key, and writes nothing", () => {
    const r = run(["--dry"]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /CFBD_API_KEY is not set/);
    /* The second sentence is the point. A key that is not there is a thing the
       reader has to go and do, and the two ways out are not obvious. */
    assert.match(r.stderr, /--espn/);
  });

  test("reads a CFBD-shaped payload without a key at all", () => {
    const out = resolve(tmpdir(), `logos-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
    const r = run(["--fixture", "fixtures/cfbd-teams.json", "--replace", "--out", out]);
    assert.equal(r.status, 0, r.stderr);
    const built = JSON.parse(readFileSync(out, "utf8"));
    rmSync(out, { force: true });

    assert.equal(built.source, "cfbd");
    assert.equal(Object.keys(built.teams).length, 80);
    /* The fixture carries CFBD's own field spellings and CFBD's own http URLs,
       which is why it is worth reading rather than a copy of the ESPN one:
       these three assertions are the whole of the CFBD-to-ours translation. */
    assert.match(built.teams["Miami"].logo, /^https:\/\//, "http was not upgraded");
    assert.match(built.teams["Miami"].logo, /500-dark/, "the light logo was chosen");
    assert.ok(built.teams["Miami"].altColor, "alt_color was not read");
    assert.notEqual(built.teams["Miami"].logo, built.teams["Miami (OH)"].logo);
  });

  test("refuses to write a map that has lost a rostered school", () => {
    /* The failure that would otherwise be invisible. A feed that quietly stops
       naming one school produces a map that is correct about 79 teams, and the
       80th just has no crest - which looks like a slow image. */
    const doc = JSON.parse(readFileSync(resolve(ROOT, "fixtures/cfbd-teams.json"), "utf8"));
    const thinned = { teams: doc.teams.filter((t) => t.school !== "Miami") };
    const fixture = resolve(tmpdir(), `cfbd-thin-${process.pid}.json`);
    const out = resolve(tmpdir(), `logos-thin-${process.pid}.json`);
    writeFileSync(fixture, JSON.stringify(thinned));

    const r = run(["--fixture", fixture, "--replace", "--out", out]);
    rmSync(fixture, { force: true });

    assert.equal(r.status, 1);
    assert.match(r.stderr, /"Miami"/);
    assert.equal(existsSync(out), false, "it wrote the file anyway");
  });
});
