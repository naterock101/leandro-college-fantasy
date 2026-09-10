# Build plan - the trophy case

A fifth tab holding a small set of season awards, each with exactly one
holder, each recomputed from scratch on every build, each able to change hands
the moment a game finishes.

The point of the feature is the *changing hands*. A static list of season
superlatives is a stats page; a trophy somebody took off you last Saturday is
a group chat. Everything below is arranged around making that flip visible.

---

# Part 1 - What we are building

## 0. The shape every award has

One record, produced by one pure function, for all of them:

```
{
  id: "upset",
  label: "Biggest Upset",
  blurb: "Won as the longest underdog",
  holders: [{ manager, value, detail }],   // usually one, joint on a tie
  runnerUp: { manager, value, detail } | null,
  changed: boolean,                         // holder differs from last week's
  unit: "chance" | "points" | "margin" | "count",
}
```

`holders` is a list rather than a manager because ties are real and a tie
broken by array order is a lie that will eventually be noticed. Two managers
who both put up 14 points in week 6 both hold Best Week. The renderer shows up
to two names and then `+N`.

`runnerUp` is what makes the tab worth reloading. The holder alone says who is
winning; the holder plus the next number down says how safe they are.

`changed` is computed by running the whole award set twice - once over every
settled game, once over every settled game *before the current week* - and
comparing holders. That is two passes over a few hundred rows, so it costs
nothing, and it is the only honest way to get the badge: a "new" flag written
by hand at award time would go stale the moment a correction to an old week
landed, which the 8-hourly baseline cron exists specifically to catch.

An award with no holder - week one, nobody has played - is not zero and is not
blank. It is `holders: []`, and the tab renders "Not awarded yet." The
distinction is the same one `lazyNote` already draws in `app/page.tsx`: an
empty array reads identically whether nothing has happened or the data failed,
and only one of those is the site's fault.

## 1. The six that ship

Six, not fourteen. A wall of trophies is a wall, and nobody reads a wall.

| Award | Holder | Value | Source |
|---|---|---|---|
| **Biggest Upset** | Their team won when the market gave it the least chance | win chance | `results[].chance` |
| **Heartbreaker** | Their team lost when the market gave it the most chance | win chance | `results[].chance` |
| **Blowout** | Their team's biggest margin of victory | margin | `results[].score` |
| **Best Week** | Most points banked in a single week | points | `byWeek[].delta` |
| **Luckiest** | Points banked furthest above what the closing lines expected | points | `byWeek[].cumulative` |
| **Civil War** | Most games where two of their own teams played each other | count | `results[].sameManager` |

Every one of these is a number that can be beaten by a single Saturday. That
was the selection rule, and it is why "Best Pick" and "Steady Eddie" are not on
this list - they move slowly enough to be a standings column, not a trophy.

Held back for a second pass, in rough order of appeal: Worst Week, Biggest
Riser, Nailbiter King, Giant Killer, Perfect Saturday, Unluckiest, Cinderella,
Dead Weight. All eight are computable from the same inputs and need no new
data; they are deferred to keep the first version legible, not because they are
hard.

## 2. Three rules the awards have to obey

**A modelled price is not a market.** `build-standings.mjs` already draws this
line for luck, the expected record and upset tagging: a game priced only by
ESPN's FPI is excluded, because calling it "what the closing lines expected"
would be false on exactly the games nobody can check. Biggest Upset and
Heartbreaker inherit that rule for free by reading a field derived from
`market`, which is already `null` on a modelled price.

**An unpriced game is not a coin flip.** A game no book touched has no chance
attached and is simply not a candidate for the two chance-based awards. It
still counts for Blowout, Best Week and Civil War, which do not consult a line.
The award record does not need to publish the excluded count the way `luck`
does - a trophy is one game, and one game either had a price or it did not.

**An undrafted team's win is nobody's trophy.** `results` carries every game a
rostered team played, including the ones it lost to a team nobody drafted.
Those rows have `points: 0` and no `winner.manager`. Every award filters to
rows with an owner on the side the award is about - the winner for Blowout and
Biggest Upset, the loser for Heartbreaker.

## 3. The one field the builder is missing

`results[].line` is `"TCU -3.5"`. A string cannot be sorted, and Biggest Upset
is a sort.

The number is already in hand. `scripts/build-standings.mjs` calls
`winProbability(market, team)` in the luck ledger a dozen lines above where it
pushes the result row. Adding

```js
chance: market ? winProbability(market, winner) : null,
```

to that row is the whole change. `null` on an unpriced or modelled game, which
is what keeps rule one and rule two above from needing any code of their own.

The loser's chance is `1 - chance`, so one field serves both awards. It is
optional in `Data` for the usual reason: a browser holding cached JS must not
break on a payload written before the field existed, and the award builder
skips a row whose `chance` is `undefined` exactly as it skips one that is
`null`.

## 4. Where the awards live in the payload

In **`standings.json`**, the always-fetched core - not in `results.json` with
the rows they are derived from.

That looks backwards and is not. The whole reason for the split in
`lib/payload.mjs` is that `results` is the growth term, ~64 rows a week, and it
is off the polling path. The awards are the *reduction* of that array: six
records, well under a kilobyte, constant in size for the rest of the season. If
the trophy tab had to fetch `results.json` to render, the tab would pull 60KB
to display six lines, and it would show a spinner on open. Computing them in
the builder and shipping the answer means the tab is instant and the poll cost
is a rounding error.

So `awards` is appended to `CORE` in `lib/payload.mjs`, and the new tab
declares `needs: null`.

## 5. Where it renders

A fifth tab, `trophies`, labelled **Trophies**.

`app/components/Tabs.tsx` was built for this: the list is one array, and its
header says adding a tab is one entry in one file plus the line in the page
that composes the component. Nothing else in the tab machinery moves.

The panel is six cards. Each card is the award name, the blurb, the holder's
name large, the value, the one-line detail ("Buffalo 24-21 over Kansas State,
week 4"), and the runner-up in dim text below. A card whose holder changed this
week carries a **NEW** badge.

`tests/a11y.test.tsx` already imports `TABS` and drives the strip by its
length rather than by a hardcoded count, so arrow-key wrapping, roving
`tabindex` and the panel wiring extend to a fifth tab with no test change. The
contrast and overflow sweeps will need the new panel added to whatever they
enumerate.

---

# Part 2 - Development plan

Test-first throughout, matching the method in `PLAN.md`: write the failing
test, state what it asserts and why that is the right assertion, make it pass,
refactor. `fixtures/sample-standings.json` is regenerated only as a deliberate
step with the diff read, via `npm run fixture:regen`.

Four phases. Each one ends green and ships on its own.

## Phase 1 - `chance` on the result row

*Builder only. Nothing renders it yet.*

- Test in `tests/build.test.mjs`: a priced, settled, rostered game carries a
  `chance` between 0 and 1, and it agrees with `winProbability` called
  directly on the same stored line.
- Test: a game whose only price is `model: true` carries `chance: null`.
- Test: a game with no line at all carries `chance: null`.
- Add the field to `results.push({...})` in `scripts/build-standings.mjs`.
- Add `chance?: number | null` to `Result` in `app/types.ts`.
- `npm run fixture:regen`, read the diff. It should touch nothing but the new
  key on rows that had a `line`.

## Phase 2 - `lib/awards.mjs`

*A pure function, no I/O, no imports from the builder. Tested alone.*

Same plain-ESM-with-JSDoc arrangement as `lib/winprob.mjs` and `lib/games.mjs`,
so the builder and any future consumer import one file and cannot disagree
about what an award is.

```js
export function buildAwards({ results, byWeek, through })
export function markChanges(now, before)
```

`through` is a count of weeks off the front of `byWeek`, and it is what lets
the caller ask for last week's answer, which is how `changed` is computed.
Left off, it means the whole season.

**`luck` is not an input, though the payload has one.** The season figure
cannot be truncated to "as of last week", so an award built on it could not be
asked for its own history and could not carry the badge. `byWeek[].cumulative`
already carries the same subtraction week by week - `pricedPoints` against
`expectedPoints` - and `tests/build.test.mjs` already asserts that its last
entry and the season `luck` are the same sum. Reading the weekly block gets
truncation for free and adds no new obligation to the builder.

New file `tests/awards.test.mjs`, hand-built inputs, no golden:

- Each of the six picks the right holder from a three-row input.
- A tie produces two entries in `holders`, in a stable order.
- An empty input produces six awards, all with `holders: []`.
- A `chance: null` row is not a candidate for Biggest Upset or Heartbreaker,
  but *is* a candidate for Blowout.
- A row where the winner has no manager is not a candidate for Blowout.
- `runnerUp` is null when only one candidate exists, and is the second-best
  when two do.
- `throughWeek` genuinely truncates: the same input asked for week 2 gives a
  different holder than asked for week 5.

## Phase 3 - Wire it in

- `scripts/build-standings.mjs` calls `buildAwards` twice - full, and through
  the previous week - and diffs the holders to set `changed`.
- `awards` appended to `CORE` in `lib/payload.mjs`.
- `Award` type added to `app/types.ts`, `awards?: Award[]` on `Data`.
- Test in `tests/payload.test.mjs`: `awards` lands in the core file, not in
  `results.json`.
- Test in `tests/build.test.mjs`: the built payload carries six awards, and
  `changed` is false on a build whose current week has no settled games.
- `npm run fixture:regen`, read the diff.

## Phase 4 - The tab

- `app/components/Trophies.tsx`.
- One entry in `TABS`, one line in `app/page.tsx`.
- New file `tests/trophies.test.tsx`:
  - Six cards render from the golden fixture.
  - An award with `holders: []` renders "Not awarded yet" and no value.
  - Two holders render both names; three render two names and "+1".
  - `changed: true` renders the NEW badge; `changed: false` does not.
  - A payload with no `awards` key at all renders the tab's empty state and
    does not throw. This is the cached-JS window and it is the test most
    likely to be forgotten.
- Extend the contrast and overflow sweeps to cover the new panel.

## What is deliberately not in this plan

The other eight awards. Any award that needs data the builder does not already
write. A per-award history chart. Notifications when a trophy changes hands -
that is a webhook and a separate decision about where it posts.
