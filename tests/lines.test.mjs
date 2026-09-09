/**
 * Betting lines: normalisation of two disagreeing sources, and the merge rule
 * that keeps a price after the source that supplied it has forgotten it.
 *
 * Hermetic by construction. The ESPN cases run against fixtures/espn-sample.json,
 * captured from the live endpoint on 2026-09-08 and trimmed; nothing here opens
 * a socket. The end-to-end cases invoke scripts/build-lines.mjs with
 * --espn-fixture and --no-cfbd, which is the same seam a human uses to replay a
 * captured payload.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  normProvider, formatSpread, formatMoneyline, impliedProbability, devig,
  cfbdObservation, espnObservation, fpiObservation, espnDates, mergeLines,
} from "../lib/lines.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = resolve(ROOT, "scripts/build-lines.mjs");
const ESPN_FIXTURE = resolve(ROOT, "fixtures/espn-sample.json");

/* The LSU/Clemson game in the fixture is final, and ESPN carries no odds for
   it - which is the whole trap this suite exists for. */
const FINAL_ID = "401856660";
const T0 = "2026-09-01T00:00:00.000Z";

const espnDoc = () => JSON.parse(readFileSync(ESPN_FIXTURE, "utf8"));
const eventById = (id) => espnDoc().events.find((e) => e.id === id);

/** A stored lines.json with one price, for the retention cases. */
const seedFile = (games) => {
  const dir = mkdtempSync(join(tmpdir(), "lines-"));
  const out = join(dir, "lines.json");
  writeFileSync(out, JSON.stringify({
    fetchedAt: T0, season: 2026, games,
  }, null, 2) + "\n");
  return out;
};

/* Returns the run rather than throwing on a non-zero exit: "exits 0" is one of
   the things under test, and the interesting messages are on stderr. */
const runBuild = (args) => {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
};

const runOk = (args) => {
  const r = runBuild(args);
  assert.equal(r.status, 0, `build-lines exited ${r.status}:\n${r.out}`);
  return r.out;
};

/* ------------------------------------------------------------------ */
/* 1. the erasure trap                                                 */
/* ------------------------------------------------------------------ */

describe("merge-only retention", () => {
  test("a refresh that omits a game keeps its stored price", () => {
    const stored = {
      [FINAL_ID]: {
        spread: -3.5, favorite: "LSU", formatted: "LSU -3.5",
        overUnder: 55.5, provider: "DraftKings", seenAt: T0, closed: false,
      },
    };
    const merged = mergeLines(stored, [
      /* the same game, observed after it went final: ESPN has dropped the
         odds object entirely, so the observation carries no price */
      { id: FINAL_ID, seenAt: "2026-09-06T04:00:00.000Z", closed: true, price: null },
    ]);
    assert.ok(merged[FINAL_ID], "the stored price must survive a priceless observation");
    assert.equal(merged[FINAL_ID].spread, -3.5);
    assert.equal(merged[FINAL_ID].favorite, "LSU");
    assert.equal(merged[FINAL_ID].formatted, "LSU -3.5");
    assert.equal(merged[FINAL_ID].closed, true, "the game is final, so the line is a closing line");
  });

  test("a game absent from the observation list is untouched", () => {
    const stored = {
      "1": { spread: 3.5, favorite: "TCU", formatted: "TCU -3.5", overUnder: 44.5, provider: "DraftKings", seenAt: T0, closed: true },
      "2": { spread: -7, favorite: "Iowa", formatted: "Iowa -7", overUnder: 40.5, provider: "DraftKings", seenAt: T0, closed: false },
    };
    const merged = mergeLines(stored, [
      { id: "2", seenAt: "2026-09-02T00:00:00.000Z", closed: false,
        price: { spread: -8.5, favorite: "Iowa", formatted: "Iowa -8.5", overUnder: 40.5, provider: "DraftKings" } },
    ]);
    assert.deepEqual(Object.keys(merged).sort(), ["1", "2"]);
    assert.deepEqual(merged["1"], stored["1"], "an unobserved game must not change at all");
    assert.equal(merged["2"].spread, -8.5, "an observed game takes the new price");
  });

  test("closed never goes back to false", () => {
    const stored = {
      "1": { spread: -7, favorite: "Iowa", formatted: "Iowa -7", overUnder: 40.5, provider: "DraftKings", seenAt: T0, closed: true },
    };
    /* CFBD carries no completion status at all, so its observations say null
       rather than false. Neither may un-finish a finished game. */
    const merged = mergeLines(stored, [
      { id: "1", seenAt: "2026-09-02T00:00:00.000Z", closed: null,
        price: { spread: -7, favorite: "Iowa", formatted: "Iowa -7", overUnder: 40.5, provider: "DraftKings" } },
      { id: "1", seenAt: "2026-09-03T00:00:00.000Z", closed: false,
        price: { spread: -7, favorite: "Iowa", formatted: "Iowa -7", overUnder: 40.5, provider: "DraftKings" } },
    ]);
    assert.equal(merged["1"].closed, true);
  });

  test("seenAt moves when the price moves and stands still when it does not", () => {
    const price = { spread: -7, favorite: "Iowa", formatted: "Iowa -7", overUnder: 40.5, provider: "DraftKings" };
    const stored = { "1": { ...price, seenAt: T0, closed: false } };

    const same = mergeLines(stored, [{ id: "1", seenAt: "2026-09-02T00:00:00.000Z", closed: false, price }]);
    assert.equal(same["1"].seenAt, T0, "re-observing the same price must not churn the file");

    const moved = mergeLines(stored, [{
      id: "1", seenAt: "2026-09-02T00:00:00.000Z", closed: false,
      price: { ...price, spread: -7.5, formatted: "Iowa -7.5" },
    }]);
    assert.equal(moved["1"].seenAt, "2026-09-02T00:00:00.000Z");
  });

  test("an entry written before seenAt existed survives without gaining a fake one", () => {
    /* Every entry in the live file predates this phase. They keep their price
       and can still be marked closed, but we never saw when their price was
       set, so inventing a seenAt would be worse than leaving it absent - the
       whole point of the field is to date a closing line. */
    const legacy = { spread: -10, favorite: "LSU", formatted: "LSU -10", overUnder: 48.5, provider: "Draft Kings" };
    const merged = mergeLines({ [FINAL_ID]: legacy }, [
      { id: FINAL_ID, seenAt: T0, closed: true, price: null },
    ]);
    assert.deepEqual(merged[FINAL_ID], { ...legacy, closed: true });
    assert.equal("seenAt" in merged[FINAL_ID], false);
  });

  test("a first sighting is inserted", () => {
    const merged = mergeLines({}, [{
      id: "9", seenAt: T0, closed: false,
      price: { spread: 0, favorite: null, formatted: "PK", overUnder: 51.5, provider: "Bovada" },
    }]);
    assert.equal(merged["9"].formatted, "PK");
    assert.equal(merged["9"].seenAt, T0);
  });

  test("an observation with no price and nothing stored adds nothing", () => {
    const merged = mergeLines({}, [{ id: "9", seenAt: T0, closed: true, price: null }]);
    assert.deepEqual(merged, {}, "a game we never priced must not appear as an empty entry");
  });

  test("a moneyline never displaces a stored spread", () => {
    /* The sequence this exists for is real and runs one way: a book posts a
       spread, then pulls it as kickoff nears and leaves the moneyline up. On a
       settled game, taking the downgrade would rewrite the closing line the
       luck and expectation work reads - the same thing merge-only prevents. */
    const spread = { spread: -19.5, favorite: "Troy", formatted: "Troy -19.5",
                     overUnder: 51.5, provider: "DraftKings" };
    const merged = mergeLines({ "1": { ...spread, seenAt: T0, closed: false } }, [{
      id: "1", seenAt: "2026-09-02T00:00:00.000Z", closed: true,
      price: { spread: null, favorite: "Troy", formatted: "Troy ML -1650",
               overUnder: 51.5, provider: "DraftKings", probability: 0.9083 },
    }]);
    assert.equal(merged["1"].spread, -19.5, "the stored spread was overwritten");
    assert.equal(merged["1"].probability, undefined);
    assert.equal(merged["1"].seenAt, T0);
    /* and the observation still does the one thing it is entitled to do */
    assert.equal(merged["1"].closed, true, "closed must still be recorded");
  });

  test("a model never displaces a market price", () => {
    /* FPI has an opinion on every game, including the ones the books have
       priced. Without this rule a run that fetched a predictor would overwrite
       a real closing line with a forecast, and the expectation columns - which
       exclude modelled prices - would quietly stop counting a game they had
       been counting all season. */
    const spread = { spread: -19.5, favorite: "Troy", formatted: "Troy -19.5",
                     overUnder: 51.5, provider: "DraftKings" };
    const merged = mergeLines({ "1": { ...spread, seenAt: T0, closed: false } }, [{
      id: "1", seenAt: "2026-09-02T00:00:00.000Z", closed: false,
      price: { spread: null, favorite: "Troy", formatted: "Troy FPI",
               overUnder: null, provider: "ESPN FPI", probability: 0.93, model: true },
    }]);
    assert.equal(merged["1"].spread, -19.5);
    assert.equal(merged["1"].model, undefined);
    assert.equal(merged["1"].provider, "DraftKings");
  });

  test("but a market price replaces a model, whenever one turns up", () => {
    const model = { spread: null, favorite: "Arkansas State", formatted: "Arkansas State FPI",
                    overUnder: null, provider: "ESPN FPI", probability: 0.91, model: true };
    const stored = mergeLines({}, [{ id: "1", seenAt: T0, closed: false, price: model }]);
    assert.equal(stored["1"].model, true);

    const priced = mergeLines(stored, [{
      id: "1", seenAt: "2026-09-02T00:00:00.000Z", closed: false,
      price: { spread: -20.5, favorite: "Arkansas State", formatted: "Arkansas State -20.5",
               overUnder: 52.5, provider: "DraftKings" },
    }]);
    assert.equal(priced["1"].spread, -20.5);
    assert.equal(priced["1"].model, undefined, "the mark must not survive the upgrade");
    assert.equal(priced["1"].probability, undefined);
  });

  test("but a moneyline is kept when there is no spread to lose", () => {
    const price = { spread: null, favorite: "Troy", formatted: "Troy ML -1650",
                    overUnder: 51.5, provider: "DraftKings", probability: 0.9083 };
    const first = mergeLines({}, [{ id: "1", seenAt: T0, closed: false, price }]);
    assert.equal(first["1"].probability, 0.9083);
    assert.equal(first["1"].seenAt, T0);

    /* and a moneyline that moved is a price that moved */
    const moved = mergeLines(first, [{
      id: "1", seenAt: "2026-09-02T00:00:00.000Z", closed: false,
      price: { ...price, formatted: "Troy ML -1400", probability: 0.8934 },
    }]);
    assert.equal(moved["1"].seenAt, "2026-09-02T00:00:00.000Z",
      "seenAt must follow the moneyline as it follows the spread");

    /* and a spread, when one finally appears, is the upgrade */
    const upgraded = mergeLines(first, [{
      id: "1", seenAt: "2026-09-03T00:00:00.000Z", closed: false,
      price: { spread: -19.5, favorite: "Troy", formatted: "Troy -19.5",
               overUnder: 51.5, provider: "DraftKings" },
    }]);
    assert.equal(upgraded["1"].spread, -19.5);
    assert.equal(upgraded["1"].probability, undefined,
      "a stale probability beside a fresh spread would be two prices for one game");
  });
});

/* ------------------------------------------------------------------ */
/* 2. CFBD normalisation                                               */
/* ------------------------------------------------------------------ */

const cfbdGame = (over) => ({
  id: 1, homeTeam: "Iowa", awayTeam: "Iowa State",
  lines: [{ provider: "DraftKings", spread: -7, overUnder: 44.5 }],
  ...over,
});

describe("CFBD normalisation", () => {
  test("a negative spread means the home team is favoured", () => {
    const o = cfbdObservation(cfbdGame(), T0);
    assert.equal(o.price.favorite, "Iowa");
    assert.equal(o.price.spread, -7);
    assert.equal(o.price.formatted, "Iowa -7");
  });

  test("a positive spread means the away team is favoured", () => {
    const o = cfbdObservation(cfbdGame({ lines: [{ provider: "DraftKings", spread: 3.5, overUnder: 44.5 }] }), T0);
    assert.equal(o.price.favorite, "Iowa State");
    assert.equal(o.price.spread, 3.5);
    assert.equal(o.price.formatted, "Iowa State -3.5",
      "formatted always states the favourite laying points, whatever the sign convention");
  });

  test("snake_case team fields are read too", () => {
    const o = cfbdObservation({ id: 1, home_team: "Iowa", away_team: "Iowa State",
      lines: [{ provider: "DraftKings", spread: -7 }] }, T0);
    assert.equal(o.price.favorite, "Iowa");
  });

  test("a pick-em has no favourite and can never be an upset", () => {
    const o = cfbdObservation(cfbdGame({ lines: [{ provider: "Bovada", spread: 0, overUnder: 51.5 }] }), T0);
    assert.equal(o.price.spread, 0);
    assert.equal(o.price.favorite, null);
    assert.equal(o.price.formatted, "PK");
    /* build-standings.mjs tags an upset as `line.favorite && line.favorite !== winner`,
       so a null favourite is what makes a pick-em untaggable. */
    assert.equal(Boolean(o.price.favorite), false);
  });

  test("both DraftKings spellings win the preference", () => {
    for (const spelling of ["DraftKings", "Draft Kings"]) {
      const o = cfbdObservation(cfbdGame({ lines: [
        { provider: "Bovada", spread: -3, overUnder: 40 },
        { provider: spelling, spread: -7, overUnder: 44.5 },
      ] }), T0);
      assert.equal(o.price.spread, -7, `${spelling} should outrank Bovada`);
      assert.equal(o.price.provider, spelling, "the book's own spelling is preserved for display");
    }
    assert.equal(normProvider("Draft Kings"), normProvider("DraftKings"));
  });

  test("a priced game with no resolvable team name is dropped", () => {
    /* "undefined -7" is worse on the page than no spread at all. */
    assert.equal(cfbdObservation({ id: 1, lines: [{ provider: "DraftKings", spread: -7 }] }, T0), null);
  });

  test("no usable line means no observation", () => {
    assert.equal(cfbdObservation(cfbdGame({ lines: [] }), T0), null);
    assert.equal(cfbdObservation(cfbdGame({ lines: undefined }), T0), null);
    assert.equal(cfbdObservation(cfbdGame({ lines: [{ provider: "DraftKings", spread: null }] }), T0), null);
  });

  test("CFBD cannot say whether a game is over", () => {
    assert.equal(cfbdObservation(cfbdGame(), T0).closed, null);
  });
});

/* ------------------------------------------------------------------ */
/* 3. ESPN normalisation                                               */
/* ------------------------------------------------------------------ */

describe("ESPN normalisation", () => {
  test("a home favourite is re-signed into the CFBD convention", () => {
    const o = espnObservation(eventById("401858213"), T0);
    assert.equal(o.price.favorite, "Miami");
    assert.ok(o.price.spread < 0, "negative means home favoured, as CFBD states it");
    assert.equal(o.price.formatted, "Miami -55.5");
  });

  test("an away favourite is re-signed into the CFBD convention", () => {
    /* Michigan is home, Oklahoma away and favoured by 5.5. */
    const o = espnObservation(eventById("401856679"), T0);
    assert.equal(o.price.favorite, "Oklahoma");
    assert.ok(o.price.spread > 0, "positive means away favoured, as CFBD states it");
    assert.equal(o.price.formatted, "Oklahoma -5.5");
  });

  test("the favourite is the full school name, never ESPN's abbreviation", () => {
    for (const id of ["401858213", "401856679", "401856782"]) {
      const o = espnObservation(eventById(id), T0);
      const details = eventById(id).competitions[0].odds[0].details;
      assert.notEqual(o.price.formatted, details,
        `${id}: ESPN's "${details}" uses an abbreviation and must not reach the payload`);
      assert.ok(o.price.favorite.length > 4, `${id}: "${o.price.favorite}" looks like an abbreviation`);
    }
  });

  test("provider falls back to name when displayName is absent", () => {
    /* Verified live 2026-09-08: 52 of 53 priced games carried provider.name
       only. displayName is the documented-looking field and the rare one. */
    assert.equal(espnObservation(eventById("401858213"), T0).price.provider, "DraftKings");
    assert.equal(espnObservation(eventById("401856679"), T0).price.provider, "DraftKings");
    assert.equal(eventById("401856679").competitions[0].odds[0].provider.displayName, undefined);
  });

  test("a pick-em has no favourite", () => {
    const o = espnObservation(eventById("401899001"), T0);
    assert.equal(o.price.spread, 0);
    assert.equal(o.price.favorite, null);
    assert.equal(o.price.formatted, "PK");
  });

  test("an event with no odds yields an observation with no price", () => {
    const o = espnObservation(eventById("401858439"), T0);
    assert.ok(o, "the event still tells us the game exists and whether it is over");
    assert.equal(o.price, null);
    assert.equal(o.closed, false);
  });

  test("a final event reports closed even though its odds are gone", () => {
    const ev = eventById(FINAL_ID);
    assert.equal(ev.competitions[0].odds, undefined, "fixture must keep the real shape: no odds on a final");
    const o = espnObservation(ev, T0);
    assert.equal(o.closed, true);
    assert.equal(o.price, null);
  });

  test("a reshaped or garbage event yields nothing rather than throwing", () => {
    for (const junk of [null, {}, { id: 1 }, "nope", { id: "1", competitions: "no" },
      { id: "1", competitions: [{ odds: [{}] }] }]) {
      assert.doesNotThrow(() => espnObservation(junk, T0));
    }
    assert.equal(espnObservation({}, T0), null);
    assert.equal(espnObservation({ id: "1", competitions: [{ odds: [{}] }] }, T0).price, null);
  });

  /* ---------------------------------------------------------------- */
  /* the moneyline fallback                                             */
  /* ---------------------------------------------------------------- */

  test("a game the book will not spread is priced off its moneyline", () => {
    /* Alabama State at Troy, captured 2026-09-12: DraftKings has the game but
       `pointSpread` reads literally "OFF", which is a book declining to price
       a side. It used to reach the page as no line at all, so Troy's owner was
       short a game in every column built on the market. */
    const o = espnObservation(eventById("401868326"), T0);
    assert.equal(o.price.spread, null, "no spread may be invented from a moneyline");
    assert.equal(o.price.favorite, "Troy");
    assert.equal(o.price.formatted, "Troy ML -1650");
    assert.equal(o.price.provider, "DraftKings");
    assert.equal(o.price.overUnder, 51.5);
    /* -1650 alone implies 0.9429. The pair holds 3.8%, and taking that out is
       the difference between the book's price and the market's opinion. */
    assert.equal(o.price.probability, 0.9083);
  });

  test("de-vigging is the pair, not one side of it", () => {
    assert.equal(Math.round(impliedProbability(-1650) * 1e4) / 1e4, 0.9429);
    assert.equal(Math.round(impliedProbability(950) * 1e4) / 1e4, 0.0952);
    assert.equal(Math.round(devig(-1650, 950) * 1e4) / 1e4, 0.9083);
    /* Both sides of one game add to 1 once the margin is gone. */
    assert.equal(Math.round((devig(-1650, 950) + devig(950, -1650)) * 1e6) / 1e6, 1);
    /* An even market is a pick-em, and -110 both ways is what one looks like. */
    assert.equal(devig(-110, -110), 0.5);
  });

  test("a pair that cannot be a real market is refused rather than believed", () => {
    /* A wrong probability is worse than none here: it would be published as a
       market opinion and weighted like one everywhere the model is summed. */
    for (const [h, a] of [[-1650, null], [null, 950], [0, 950], [NaN, 950],
                          [100, 100], [-10000, -10000],
                          /* nothing lives strictly between -100 and +100, and
                             -50 read as a price is a heavy favourite reported
                             as a one-in-three shot */
                          [-50, 950], [-1650, 60]]) {
      assert.equal(devig(h, a), null, `${h}/${a} should not produce a probability`);
    }
  });

  test("the two prices come from the same quote or not at all", () => {
    /* De-vigging is the pair divided by its own total, so a close against an
       open is two moments subtracted from each other and the margin that comes
       out is not one anybody offered. Here the book has pulled the home side
       and left an opening price behind: the answer is no price, not a pair
       assembled from whatever each side happens to still have. */
    const mixed = structuredClone(eventById("401868326"));
    mixed.competitions[0].odds[0].moneyline = {
      home: { close: { odds: "-1650" } },
      away: { open: { odds: "+950" } },
    };
    assert.equal(espnObservation(mixed, T0).price, null,
      "a close on one side and an open on the other is not a market");

    /* A whole block that happens to be the opening one is still one market,
       and is used. The rule is same-quote, not close-only. */
    const opens = structuredClone(eventById("401868326"));
    opens.competitions[0].odds[0].moneyline = {
      home: { close: { odds: "OFF" }, open: { odds: "-1650" } },
      away: { close: { odds: "OFF" }, open: { odds: "+950" } },
    };
    assert.equal(espnObservation(opens, T0).price.probability, 0.9083);
  });

  test("a moneyline that is OFF is not a number", () => {
    /* The string the book uses to say it is not pricing this. Read as a
       number it would come back 0 or NaN and take a whole game with it. */
    const ev = structuredClone(eventById("401868326"));
    ev.competitions[0].odds[0].moneyline.home = { close: { odds: "OFF" }, open: { odds: "OFF" } };
    assert.equal(espnObservation(ev, T0).price, null);
  });

  test("a named favourite is never published at even money", () => {
    /* The invariant behind rounding the probability before branching on it:
       whatever the pair, a price either names a favourite and publishes a
       chance above a half, or names nobody and is a pick-em. A favourite
       carrying 0.5 would be handed the game by the projection and coloured as
       the favourite on the page, on a price that says it is a coin flip. */
    for (const [h, a] of [[-1650, 950], [-105, -105], [-110, -110], [-120, 100],
                          [100, -120], [-2500, 1100], [-100, -100]]) {
      const ev = structuredClone(eventById("401868326"));
      ev.competitions[0].odds[0].moneyline = {
        home: { close: { odds: String(h) } }, away: { close: { odds: String(a) } },
      };
      const { price } = espnObservation(ev, T0);
      if (!price) continue;
      if (price.favorite === null) {
        assert.equal(price.probability, undefined, `${h}/${a}: a pick-em carries no probability`);
      } else {
        assert.ok(price.probability > 0.5, `${h}/${a}: ${price.favorite} at ${price.probability}`);
      }
    }
  });

  test("an even moneyline is written as the pick-em it is", () => {
    /* Rather than a probability of 0.5 with no favourite, which would be a
       second way of saying what this repo already has one way of saying. */
    const ev = structuredClone(eventById("401868326"));
    ev.competitions[0].odds[0].moneyline = {
      home: { close: { odds: "-110" } }, away: { close: { odds: "-110" } },
    };
    const { price } = espnObservation(ev, T0);
    assert.equal(price.spread, 0);
    assert.equal(price.favorite, null);
    assert.equal(price.formatted, "PK");
    assert.equal(price.probability, undefined);
  });

  test("a spread beats a moneyline on the same game", () => {
    /* The fallback is a fallback. A book quoting both is quoting one price,
       and the spread is the one the rest of the repo is built to read. */
    const ev = structuredClone(eventById("401868326"));
    ev.competitions[0].odds[0].spread = -19.5;
    ev.competitions[0].odds[0].homeTeamOdds.favorite = true;
    const { price } = espnObservation(ev, T0);
    assert.equal(price.spread, -19.5);
    assert.equal(price.formatted, "Troy -19.5");
    assert.equal(price.probability, undefined);
  });

  test("formatMoneyline says which kind of number it is", () => {
    /* It shares a column with "Georgia -41.5", and a reader who takes -1650
       for a spread is reading a number eighty times too large. */
    assert.equal(formatMoneyline("Troy", -1650), "Troy ML -1650");
    assert.equal(formatMoneyline("Troy", 120), "Troy ML +120");
  });

  test("the per-event odds shape is read too, not just the scoreboard's", () => {
    /* ESPN writes the same price two ways in two endpoints, and neither is
       documented. The numeric shape is what sports.core.api returns. */
    const ev = structuredClone(eventById("401868326"));
    delete ev.competitions[0].odds[0].moneyline;
    ev.competitions[0].odds[0].homeTeamOdds.moneyLine = -1650;
    ev.competitions[0].odds[0].awayTeamOdds.moneyLine = 950;
    assert.equal(espnObservation(ev, T0).price.probability, 0.9083);
  });

  /* ---------------------------------------------------------------- */
  /* the model of last resort                                           */
  /* ---------------------------------------------------------------- */

  /* West Georgia at Arkansas State as ESPN's predictor really answered it on
     2026-09-09: no book anywhere would price the game, and FPI gives the home
     side 91.4%. */
  const predictor = (home, away) => ({
    homeTeam: { statistics: [{ name: "gameProjection", displayValue: String(home) }] },
    awayTeam: { statistics: [{ name: "gameProjection", displayValue: String(away) }] },
  });
  const competition = (completed = false, state = "pre") => ({
    competitors: [
      { homeAway: "home", team: { location: "Arkansas State" } },
      { homeAway: "away", team: { location: "West Georgia" } },
    ],
    status: { type: { completed, state } },
  });

  test("a game no book will price at all falls back to the model", () => {
    const o = fpiObservation(predictor(91.4, 8.6), competition(), "401868241", T0);
    assert.equal(o.price.favorite, "Arkansas State");
    assert.equal(o.price.probability, 0.91);
    assert.equal(o.price.spread, null);
    assert.equal(o.price.provider, "ESPN FPI");
    assert.equal(o.price.model, true, "the mark is what keeps it out of the market columns");
  });

  test("and it never formats as a price a book offered", () => {
    /* FPI publishes a predicted margin too - 20.2 points here - and rendering
       that would put "Arkansas State -20.5" in the same column as real
       spreads, which is the one thing a forecast must not look like. */
    const o = fpiObservation(predictor(91.4, 8.6), competition(), "401868241", T0);
    assert.equal(o.price.formatted, "Arkansas State FPI");
    assert.ok(!/-?\d/.test(o.price.formatted), "no number that could read as a line");
    assert.equal(o.price.overUnder, null);
  });

  test("a predictor that does not describe one game is refused", () => {
    /* The two percentages are separately published numbers, and a pair that
       does not add up is a response this code has misread. Believing half of
       it would put a confident wrong favourite into the projection. */
    for (const [h, a] of [[91.4, 30], [null, 8.6], [140, -40], [50, 50]]) {
      const o = fpiObservation(predictor(h, a), competition(), "401868241", T0);
      assert.equal(o, null, `${h}/${a} should not produce a price`);
    }
    assert.equal(fpiObservation({}, competition(), "401868241", T0), null);
    assert.equal(fpiObservation(predictor(91.4, 8.6), competition(), "", T0), null);
  });

  test("an unnameable favourite is refused rather than printed", () => {
    const nameless = { competitors: [{ homeAway: "away", team: { location: "West Georgia" } }] };
    assert.equal(fpiObservation(predictor(91.4, 8.6), nameless, "401868241", T0), null);
  });

  test("the fetch window is Eastern days, not UTC ones", () => {
    /* Saturday 2026-09-05, 22:00 ET, which is Sunday 02:00Z. A UTC window
       would already have rolled to the 6th and would ask ESPN for a day whose
       late games it is in the middle of. */
    const satNight = new Date("2026-09-06T02:00:00.000Z");
    assert.deepEqual(espnDates(satNight).slice(0, 3), ["20260904", "20260905", "20260906"]);
  });

  test("the fetch window survives the November clock change", () => {
    /* The crons are annotated "Eastern is UTC-4 through Nov 1, UTC-5 after",
       which is precisely the seam a hand-rolled offset would get wrong. */
    const beforeFallBack = new Date("2026-11-01T04:30:00.000Z"); // 00:30 EDT, Nov 1
    assert.deepEqual(espnDates(beforeFallBack).slice(0, 3), ["20261031", "20261101", "20261102"]);
    const afterFallBack = new Date("2026-11-01T06:30:00.000Z"); // 01:30 EST, Nov 1
    assert.deepEqual(espnDates(afterFallBack).slice(0, 3), ["20261031", "20261101", "20261102"]);
  });

  test("the fetch window always includes yesterday", () => {
    /* Yesterday is the one that catches a game going final, which is the only
       moment `closed` can ever be recorded before ESPN drops the odds. */
    const d = espnDates(new Date("2026-09-12T18:00:00.000Z"));
    assert.equal(d[0], "20260911");
    assert.equal(d[1], "20260912");
  });

  test("the fetch window reaches the next Saturday from every day of the week", () => {
    /* The point of ESPN being primary is that spreads are current, and the
       games that matter are the coming weekend's. A window that stops at
       tomorrow prices nothing from Sunday to Wednesday: on those days ESPN
       returns an empty slate, and the only thing refreshing spreads is the
       CFBD call, at 7-hour granularity. Verified against the live season -
       the first run after cutover was a Tuesday and ESPN priced zero games.

       Reaching seven days out is what makes "primary" true rather than
       true-on-Fridays, and it costs nothing: ESPN is unmetered. */
    const eastern = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
    });
    /* Sunday 2026-09-06 through Saturday 2026-09-12, one run per weekday at
       noon Eastern. Every one of them must be able to see 2026-09-12, and the
       Saturday run must see the Saturday after it rather than only itself. */
    for (let i = 0; i < 7; i++) {
      const noonEt = new Date(Date.parse("2026-09-06T16:00:00.000Z") + i * 86400000);
      const want = i === 6 ? "20260919" : "20260912";
      const got = espnDates(noonEt);
      assert.ok(got.includes(want),
        `a run on ${eastern.format(noonEt)} cannot see ${want}; window was ${got.join(",")}`);
    }
  });

  test("formatSpread states the favourite laying points", () => {
    assert.equal(formatSpread("Iowa", -7), "Iowa -7");
    assert.equal(formatSpread("Iowa", 7), "Iowa -7");
    assert.equal(formatSpread(null, 0), "PK");
  });
});

/* ------------------------------------------------------------------ */
/* 4. the script, end to end                                           */
/* ------------------------------------------------------------------ */

describe("build-lines.mjs", () => {
  test("a refresh never erases a completed game's closing line", () => {
    const out = seedFile({
      [FINAL_ID]: {
        spread: -3.5, favorite: "LSU", formatted: "LSU -3.5",
        overUnder: 55.5, provider: "DraftKings", seenAt: T0, closed: false,
      },
    });
    runOk(["--espn-fixture", ESPN_FIXTURE, "--no-cfbd", "--out", out]);
    const doc = JSON.parse(readFileSync(out, "utf8"));
    assert.ok(doc.games[FINAL_ID], "the closing line was erased");
    assert.equal(doc.games[FINAL_ID].formatted, "LSU -3.5");
    assert.equal(doc.games[FINAL_ID].closed, true);
    assert.ok(doc.games["401858213"], "new prices are still added");
  });

  test("a garbage ESPN payload leaves the stored file byte-identical", () => {
    const out = seedFile({
      "1": { spread: -7, favorite: "Iowa", formatted: "Iowa -7", overUnder: 40.5, provider: "DraftKings", seenAt: T0, closed: false },
    });
    const before = readFileSync(out, "utf8");
    const junk = join(dirname(out), "junk.json");
    writeFileSync(junk, "<html>429 Too Many Requests</html>");
    runOk(["--espn-fixture", junk, "--no-cfbd", "--out", out]);
    assert.equal(readFileSync(out, "utf8"), before, "a bad response must not rewrite the file at all");
  });

  test("a reshaped ESPN payload leaves the stored file byte-identical", () => {
    const out = seedFile({
      "1": { spread: -7, favorite: "Iowa", formatted: "Iowa -7", overUnder: 40.5, provider: "DraftKings", seenAt: T0, closed: false },
    });
    const before = readFileSync(out, "utf8");
    const reshaped = join(dirname(out), "reshaped.json");
    writeFileSync(reshaped, JSON.stringify({ items: [] }));
    runOk(["--espn-fixture", reshaped, "--no-cfbd", "--out", out]);
    assert.equal(readFileSync(out, "utf8"), before);
  });

  test("a date with no games keeps every stored price", () => {
    const out = seedFile({
      "1": { spread: -7, favorite: "Iowa", formatted: "Iowa -7", overUnder: 40.5, provider: "DraftKings", seenAt: T0, closed: false },
    });
    const empty = join(dirname(out), "empty.json");
    writeFileSync(empty, JSON.stringify({ events: [] }));
    runOk(["--espn-fixture", empty, "--no-cfbd", "--out", out]);
    const doc = JSON.parse(readFileSync(out, "utf8"));
    assert.equal(doc.games["1"].spread, -7);
    assert.equal(Object.keys(doc.games).length, 1);
  });

  test("a missing stored file is created rather than fatal", () => {
    const dir = mkdtempSync(join(tmpdir(), "lines-"));
    const out = join(dir, "nested", "lines.json");
    runOk(["--espn-fixture", ESPN_FIXTURE, "--no-cfbd", "--out", out]);
    const doc = JSON.parse(readFileSync(out, "utf8"));
    assert.equal(doc.season, 2026);
    assert.ok(Object.keys(doc.games).length >= 4);
  });

  test("a moneyline price survives the whole script", () => {
    /* `probability` is added late in the price object and passes through the
       observation, the merge and the written file before anything reads it.
       Dropped anywhere along the way the feature would silently do nothing:
       every column would read exactly as it did before, with the game left
       out and no error anywhere. */
    const dir = mkdtempSync(join(tmpdir(), "lines-"));
    const out = join(dir, "lines.json");
    runOk(["--espn-fixture", ESPN_FIXTURE, "--no-cfbd", "--out", out]);
    const entry = JSON.parse(readFileSync(out, "utf8")).games["401868326"];
    assert.equal(entry.spread, null);
    assert.equal(entry.favorite, "Troy");
    assert.equal(entry.formatted, "Troy ML -1650");
    assert.equal(entry.probability, 0.9083);
  });

  test("replaying a fixture never reaches the network for a predictor", () => {
    /* This suite is hermetic by construction and the FPI step is the one
       thing in the script that could break that: Howard at Indiana is in the
       fixture unpriced, rostered and not yet kicked off, which is exactly the
       shape the step goes looking for. Left ungated it would fire a live
       request in the middle of every fixture-based test here, and the file
       those tests assert on would depend on what ESPN thought that morning. */
    const dir = mkdtempSync(join(tmpdir(), "lines-"));
    const out = join(dir, "lines.json");
    const r = runBuild(["--espn-fixture", ESPN_FIXTURE, "--no-cfbd", "--out", out]);
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /fpi: skipped, replaying a fixture/);
    const games = JSON.parse(readFileSync(out, "utf8")).games;
    assert.equal(Object.values(games).some((g) => g.model), false,
      "a replay invented a modelled price");
  });

  test("an unreadable stored file is not overwritten", () => {
    /* Truncated JSON is the shape of an interrupted write. Rewriting it from a
       partial refresh would turn a recoverable file into a confidently wrong
       one, so the run bails instead. */
    const dir = mkdtempSync(join(tmpdir(), "lines-"));
    const out = join(dir, "lines.json");
    writeFileSync(out, '{"games": {"1": ');
    const before = readFileSync(out, "utf8");
    assert.notEqual(runBuild(["--espn-fixture", ESPN_FIXTURE, "--no-cfbd", "--out", out]).status, 0);
    assert.equal(readFileSync(out, "utf8"), before);
  });

  test("an ESPN failure exits 0 and reports it", () => {
    const out = seedFile({});
    const junk = join(dirname(out), "junk.json");
    writeFileSync(junk, "not json");
    /* Standings must never fail on the lines feed, so the exit code matters as
       much as the message. */
    const log = runOk(["--espn-fixture", junk, "--no-cfbd", "--out", out]);
    assert.match(log, /no source/i);
  });

  test("--dry writes nothing", () => {
    const out = seedFile({});
    const before = readFileSync(out, "utf8");
    runOk(["--espn-fixture", ESPN_FIXTURE, "--no-cfbd", "--out", out, "--dry"]);
    assert.equal(readFileSync(out, "utf8"), before);
  });
});
