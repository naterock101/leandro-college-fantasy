# Build plan

Everything agreed in the review, sequenced. Two documents in one: what we are
building and why (part 1), and how the work is split and verified (part 2).

Ground rules carried over from the existing repo, none of them negotiable:

- **Zero runtime dependencies.** Test tooling is `devDependencies` only.
- **The scoring logic fails loud.** A wrong-but-plausible standings file is the
  worst outcome; a red Action is the second best after a correct one.
- **The CFBD free tier is 1,000 calls/month.** Every change restates the budget.
- **Never substring-match a school name.** Exact equality on the CFBD string.

---

# Part 1 - What we are building

## 0. The finding that reshapes three items

ESPN's public scoreboard endpoint:

```
https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=YYYYMMDD&groups=80
```

Verified against the live season on 2026-09-08:

| Property | Value | Consequence |
|---|---|---|
| Auth | none | no key, no secret, no rotation |
| `access-control-allow-origin` | `*` | **the browser can call it directly** |
| `cache-control` | `max-age=3` | genuinely live |
| Event `id` | `401858212` | **identical to the CFBD game id** |
| `status` | `{clock, displayClock, period, type.state}` | quarter and game clock |
| `competitions[].odds` | DraftKings spread + O/U, explicit `favorite` flag | free spreads |
| `competitors[].team` | `logo`, `color`, `alternateColor` | free logos |

The id equality is the important part: we join on it, so none of the
name-matching traps in `data/rosters.json` apply to any of this.

Three consequences:

1. **Live scores need no infrastructure.** No Action, no cron, no commits, no
   CFBD calls. The page fetches ESPN itself.
2. **Spreads become free and unlimited**, so "as fresh as possible" costs
   nothing rather than costing a cadence tradeoff.
3. **The CFBD budget does not move.** It stays at ~759/month.

ESPN is an undocumented endpoint. Everything built on it is therefore treated
exactly the way `lines.json` is treated today: **optional, degrades to the
current behaviour, never fails a build or blanks a page.** That rule is a test,
not a comment.

## 1. Dead-week pin, and the unscored games list

**The bug.** `build-standings.mjs` picks the next week as the lowest sort key
among incomplete games:

```js
const nextKey = upcoming.length ? upcoming[0].key : null;
```

A game that is never marked complete - cancelled for weather, abandoned,
a feed error - stays in `upcoming` for the rest of the season. From that moment:

- "Games of the week" shows that one orphan game, forever
- `projection` projects that dead week, so the Proj column freezes
- `remaining` and `ceiling` count a game that will never be played, overstating
  the ceiling by 2 or 3 points permanently

**The fix.** One shared predicate, `lib/games.mjs`, classifying every game:

| State | Test | Counts toward `remaining`? |
|---|---|---|
| `scheduled` | not complete, kickoff in the future | yes |
| `live` | not complete, kicked off < 5.5h ago | yes |
| `stalled` | not complete, kicked off > 5.5h ago | **no** |
| `final` | complete, two different numeric scores | no |
| `unusable` | complete, but scores missing or equal | **no** |

5.5 hours is the existing `LIVE_WINDOW_MS` from `app/page.tsx`, moved into the
shared module so the page and the builder cannot disagree about what "live"
means. That disagreement is the actual bug: the page already knows a stalled
game is not live, and the builder does not.

`nextKey` is then chosen from `scheduled` and `live` games only, so a stalled
game can never pin the week. Same for `projection`, `remaining` and `ceiling`.

**The new feature.** `stalled` and `unusable` games are today invisible: a
stalled game shows in "On the field" for 5.5 hours and then silently vanishes,
and an `unusable` one is `continue`d past in the builder and never appears
anywhere. Both now go into a new payload array:

```jsonc
"unscored": [
  { "key": "0|03", "week": 3, "seasonType": "regular",
    "date": "2026-09-19T23:30:00.000Z",
    "away": { "team": "...", "manager": "..." },
    "home": { "team": "...", "manager": null },
    "reason": "no result" }   // or "no score" | "tied"
]
```

Rendered as its own block **under Games of the week**, grouped by the week the
game belonged to, and **excluded from the live block**. Copy names the state
plainly rather than guessing at a cause: *"Kicked off Sep 19 and never reported
a final score. Not counted in points, remaining or ceiling."*

## 2. Ceiling and remaining

Falls out of item 1: `remaining` counts `scheduled` and `live` only. Covered by
its own fixture case rather than assumed.

## 3. Lines, always current

**Today.** `build-lines.mjs` calls CFBD `/lines` on the 8-hourly baseline cron
only, ~21 calls/week. Everything else re-reads the file. Freshness: up to 8h.

**After.** ESPN becomes the primary source and runs on **every** standings run;
CFBD stays as the reconciling fallback on the baseline cron.

| Source | Cadence | Cost | Role |
|---|---|---|---|
| ESPN scoreboard | every run (10 min on game day) | free | current price |
| CFBD `/lines` | baseline cron, 8h | 21/wk | gap-fill, cross-check |

Freshness goes from 8 hours to 10 minutes on game day. **Budget unchanged.**

### The trap this creates

ESPN **drops the odds object once a game goes final** - confirmed on a finished
game, `competitions[0].odds` is absent. `build-lines.mjs` today writes a fresh
object every run. Refreshing every 10 minutes against a source that forgets
would therefore **erase the spread of every completed game**, destroying:

- `upset` detection on the head-to-head list and the timeline
- the closing line the luck and expected-points work in item 9 depends on

So the merge rule is mandatory and is the first test written for this phase:

> **`lines.json` is merge-only. A game that has ever had a price keeps its last
> observed price forever. A refresh may add a game or update a price; it may
> never remove one.**

Each entry gains `seenAt` (when this price was last observed) and `closed`
(true once the game is final), so a closing line is identifiable as such rather
than inferred from the file's mtime.

### Normalisation

The two sources disagree on convention and must be normalised in `lib/lines.mjs`:

| | CFBD | ESPN |
|---|---|---|
| Sign | negative = home favoured | magnitude only |
| Favourite | inferred from sign | explicit `awayTeamOdds.favorite` |
| Provider | `DraftKings` **and** `Draft Kings` | `provider.displayName` |
| Team names | school strings | ids, plus abbreviations in `details` |

Normalised shape is the current one plus the two new fields, so the page's
existing spread rendering keeps working unchanged.

## 4. Hermetic fixtures and a real test suite

**The bug.** `npm run fixture:regen` reads live `public/lines.json`, so the
committed golden file carries a real `linesFetchedAt` and real spreads.
Regenerating it right now drifts on that field. A golden file that drifts on
the wall clock cannot be diffed in CI, which is the only thing a golden file is
for.

**The fix.** `--fixture` implies fixture lines: a new `fixtures/sample-lines.json`,
and the live file is never read on a fixture build. The builder's clock fields
(`generatedAt`) are the only non-deterministic output and are excluded from the
golden comparison explicitly rather than by accident.

**The suite.** `node --test`, built in, no dependency:

- `tests/lib.test.mjs` - pure functions: game classification, win probability,
  line normalisation, formatting, sort keys
- `tests/lines.test.mjs` - merge-only semantics, closing-line retention, both
  sign conventions, provider spelling
- `tests/build.test.mjs` - golden file, plus invariants that hold for any input:
  - every manager has exactly 10 teams, one per conference, exactly 4 power
  - `points == 3 * p4 wins + 2 * g5 wins`
  - `ceiling >= points`, and `ceiling == points + remaining*value - collisionLoss`
  - `byWeek` final cumulative equals `standings`
  - `byWeek` total games == completed rostered games, and
    `results.length` == that total minus the `unusable` ones. (The naive
    `sum(byWeek[].games) == results.length` is **false**: `byWeek` counts every
    completed rostered game, `results` only those with two different numeric
    scores, so a tie or a scoreless game opens a gap. Phase 1 tightens this to
    `results.length + unscored.length` once `unscored[]` exists.)
  - every `headToHead` entry has two managers; every `results` entry has one
  - no `unscored` game appears in `gamesOfWeek`, `results` or `headToHead`

`fixtures/sample-games.json` grows to cover: a cancelled game, a completed game
with no score, a tie, a same-manager collision, a neutral-site game, a
postseason game, and an undrafted-beats-drafted result.

Three notes from building it, against my own first description:
`postseasonScheduled` does **not** flip - the fixture already held a bowl game.
A same-manager collision and an undrafted winner also already existed, so the
added cases were chosen to cover new ground: a collision with **unequal** tiers
(3 v 2, so `Math.min` is actually exercised) and an **independent** as the
undrafted winner (so the `byConference` drop is exercised). And `neutral` is
written only on the upcoming path, so a completed neutral-site game changes
nothing anywhere - that case has to be an upcoming game to test anything.

CI: a `test.yml` workflow on push and PR. It runs no network calls and needs no
key, so it is free and cannot flake on CFBD.

## 5. README budget

A correction to my own earlier reading: the two numbers are not contradictory,
they are unlabelled. `666` is the **standings-only** cost (153 runs/week);
`759` is standings **plus** lines (174/week). Both are right. The fix is to say
which is which, and to restate the arithmetic after item 3 changes the mix.

## 6. Accessibility

- Leaderboard rows are `<tr onClick>` with no `tabIndex`, `role` or key handler,
  so the team detail is unreachable by keyboard. Becomes a real `<button>` in
  the manager cell driving `aria-expanded` / `aria-controls`.
- Dropdowns have `aria-expanded` but no Escape handler and no focus return.
  `useClickAway` grows a keydown branch and restores focus to the trigger.
- The tab strip is three unrelated buttons. Becomes
  `role="tablist"` / `role="tab"` / `aria-selected` with arrow-key movement.
- The live dot conveys state by colour and motion alone; gets a text label.
- The race chart (item 10) ships with a visually-hidden data table.
- Contrast audit of `--muted` (#7E8FA3 on #0D1520) at the 9-11px sizes used for
  captions. It is likely under 4.5:1 at those sizes and needs either a lighter
  muted or a larger minimum.

## 7. Infrastructure

### 7a. Bot commits move to a `data` branch

34 of 49 commits are already bot commits, one week in - roughly 5,000 by
December, burying every real change. Data moves to an orphan `data` branch:

- `main` holds code, and its history becomes readable again
- `SOURCE` in the page points at `refs/heads/data`
- **`vercel.json`'s `ignoreCommand` is deleted.** Vercel only watches `main`,
  which no longer receives data commits, so the whole `[skip ci]` workaround
  disappears. A hack removed rather than another added.
- The Action's commit step gains a worktree checkout of `data`

Cutover risk is already handled by the existing design: a page whose fetch of
the old URL fails falls back to the copy bundled with the deploy. Worst case a
stale open tab shows deploy-time data until it is reloaded.

### 7b. Payload split

Today one 91KB file (10.4KB gzipped) is refetched by every open tab. `results`
is the growth term: 64 entries after one week, so roughly 1,000 and ~275KB raw
by season's end.

| File | Contents | Fetched |
|---|---|---|
| `standings.json` | standings, projection, byWeek, gamesOfWeek, unscored, meta | always |
| `results.json` | results, headToHead | Activity and Trends tabs |
| `teams.json` | byConference | All teams tab |
| `lines.json` | spreads | already separate |

Lazy files are fetched once on first tab open and then refreshed on the same
interval as the core. Every consumer already tolerates a missing section, so
the loading state is a real state and not a spinner over the whole page.

### 7c. Polling

Three defects, all in one `useEffect`:

1. **Cache-busted.** `?t=${Date.now()}` defeats ETag revalidation, so every poll
   transfers the whole body where a conditional request would return 304.
   Removed; `cache: "no-store"` alone gives freshness without discarding
   validators.
2. **Misaligned.** Polls every 120s against a bot that writes every 10 minutes
   behind a 300s CDN cache. Most polls cannot return anything new. Becomes:
   60s when a tracked game is live, 5 minutes otherwise.
3. **Never pauses.** A phone left open through a 12-hour Saturday polls ~360
   times in a pocket. Pauses on `visibilitychange`, and fetches once immediately
   on return rather than waiting out the interval.

## 8. Live scores

Client-side, no infrastructure. A `useLiveScores(games)` hook:

- derives the set of ESPN date strings from the kickoff times of the games it
  was handed, so it asks only for dates that matter (usually one)
- fetches ESPN, keys the response by `id`, joins to games we already track
- returns `{ score, period, displayClock, state }` per id
- polls every 30s, only while at least one tracked game is in the live window
  and the tab is visible

The "On the field" block goes from a kickoff time and a usually-empty score
column to `Q3 7:42 - Miami 21, Louisville 17`.

Degradation is the design constraint. ESPN unreachable, rate-limited, reshaped
or returning nothing for a date means the block renders exactly as it does
today. This is asserted in tests, not hoped for.

## 9. Win probability, expected points, luck

`lib/winprob.mjs`, pure and unit-tested:

```
P(favourite wins) = Phi(|spread| / sigma),  sigma = 16
```

sigma = 16 approximates the standard deviation of college football margins
against the spread. It lives in one named constant with a comment, because it
is a modelling assumption and not a fact.

Three things built on it:

- **Per-game win probability** in Games of the week, beside the spread.
- **Expected points added.** For each upcoming rostered game,
  `wp(team) * tier value`. Summed per manager per week. This is a strictly
  better projection than the current "every favourite wins", which is
  deliberately naive and throws away most of the information in the line. The
  existing `projection` object keeps its shape and gains `expected` fields, so
  a cached page never breaks on the new payload.
- **Luck.** Over completed rostered games, `actual points - expected points`
  computed from each game's stored closing line. Positive means running hot.
  A new column on the leaderboard.

Two honesty constraints, both enforced by tests:

- A game with no line contributes to neither side of the luck calculation, and
  the count of excluded games is carried in the payload and shown in the caption.
- Luck depends on the closing line, which depends on the merge-only rule in
  item 3. That dependency is why item 3 lands before this one.

## 10. Trends tab

A fourth tab, so the leaderboard does not get busier.

**The race chart.** Hand-rolled SVG, no charting dependency, driven entirely by
`byWeek.cumulative`, which already contains everything needed. Eight lines,
one per manager. Responsive via `viewBox`, theme colours from the existing
custom properties, a visually-hidden data table for screen readers, and direct
end-of-line labels rather than a legend that has to be cross-referenced.

**The head-to-head matrix.** An 8x8 grid from `headToHead`. Rows are managers,
columns opponents, cells a W-L record. The diagonal holds own-goal games.
Directly relevant because head-to-head is the league tiebreaker, and it is
currently only available as a flat chronological list. Horizontally scrollable
on a phone within its own container, never widening the page.

## 11. Logos

`scripts/build-logos.mjs`, run manually, one CFBD `/teams` call, writing
`data/logos.json` committed to `main`. CFBD rather than ESPN because it is
keyed on the exact school strings the rosters already join on.

Rendered at 18-20px in the leaderboard detail, the all-teams table and the
game rows. Fixed width and height and `loading="lazy"` so a slow or missing
logo causes no layout shift, and a missing entry renders nothing rather than a
broken image.

## Explicitly out of scope

Season simulation and title odds; the awards and trophy case. Both discussed,
both deferred.

---

# Part 2 - Development plan

## Method

Test-first throughout. For each unit of work: write the failing test, state
what it asserts and why that is the right assertion, make it pass, then
refactor. The golden file is regenerated only as a deliberate step with the
diff read, never as a reflex to make a red test green.

Work runs in subagents on isolated git worktrees. Phases that run in parallel
have **disjoint file ownership**, listed per phase; anything shared is assigned
to exactly one owner. Integration is sequential: each phase merges to `main`
with a green suite before the next starts.

## Dependency graph

```
Phase 0  Foundation
   |
   +---------------------+
   |                     |
Phase 1              Phase 2
Correctness          Lines
   |                     |
   +---------+-----------+
             |
         Phase 3  Infrastructure
             |
         Phase 4  Refactor + a11y
             |
   +---------+---------+---------+
   |         |         |         |
Phase 5A   5B        5C        5D
Live     Analytics  Trends    Logos
   |         |         |         |
   +---------+---------+---------+
             |
         Phase 6  Integration
```

## Phase 0 - Foundation

One agent. Blocks everything, so it is not parallelised.

- `npm test` wired to `node --test`
- `vitest` + `@testing-library/react` added as **devDependencies** for the
  component work in phases 4 and 5. Runtime dependencies stay at zero.
- `lib/` created: `games.mjs` (field pickers, classification, sort keys),
  `format.mjs` (shared formatting). Imported by both `scripts/*.mjs` and
  `app/page.tsx` - `allowJs` is already on in `tsconfig.json`, so plain ESM
  with JSDoc types needs no build step and no new toolchain.
- `fixtures/sample-lines.json`; `--fixture` stops reading the live lines file
- `fixtures/sample-games.json` extended with the seven edge cases in item 4
- Golden test and the invariant suite
- `.github/workflows/test.yml` on push and PR

**Owns:** `lib/**`, `tests/**`, `fixtures/**`, `package.json`, `test.yml`
**Exit:** `npm test` green; `npm run fixture:regen` byte-identical on a second
run with `public/lines.json` deleted.

## Phase 1 - Correctness (parallel with 2)

- Game classification wired into the builder
- `nextKey`, `projection`, `remaining`, `ceiling` all exclude stalled games
- `unscored[]` emitted
- README budget wording

**Owns:** `scripts/build-standings.mjs`, `README.md`
**Tests first:** a stalled game does not pin `gamesOfWeek`; does not appear in
`results`; does appear in `unscored`; does not count toward `remaining`;
ceiling drops accordingly. A tie and a scoreless completed game land in
`unscored` with the right reason.

## Phase 2 - Lines (parallel with 1)

- `lib/lines.mjs` normalising both sources
- ESPN fetch added to `build-lines.mjs`; CFBD retained as fallback
- **Merge-only** rewrite, `seenAt` and `closed`
- Workflow: lines step runs every run
- Budget restated

**Owns:** `scripts/build-lines.mjs`, `lib/lines.mjs`, `poll.yml`
**Shared:** the `loadLines()` call site in `build-standings.mjs` belongs to
this phase, not phase 1.
**Tests first:** *the erasure test is written before any ESPN code* - given a
stored price and a refresh whose payload omits that game, the price survives
and `closed` flips. Then both sign conventions, both provider spellings, and
a malformed ESPN payload leaving the file untouched.

## Phase 3 - Infrastructure

Sequential: touches the workflow that phase 2 just edited, and the fetch layer
phase 4 then refactors.

- `data` orphan branch; Action commits there via a worktree
- `vercel.json` `ignoreCommand` deleted
- Payload split into four files
- Polling: cache-buster removed, interval varied, paused when hidden

**Owns:** `poll.yml`, `vercel.json`, the fetch layer of `app/page.tsx`, README
architecture section
**Tests first:** the split writer emits files whose union equals the current
payload; a page given a missing lazy file renders its tab's empty state rather
than throwing.
**Manual verification:** confirm in the browser that a data commit produces no
Vercel deployment, and that `main`'s log is clean.

## Phase 4 - Refactor and accessibility

Sequential, and deliberately before the features: four agents adding sections
to a 1,006-line single component would produce four conflicting versions of it.

- `app/page.tsx` split into `app/components/*` with the shell retaining only
  tab state and data loading
- Every item in section 6

**Owns:** all of `app/**`
**Tests first:** component tests for keyboard operation of the row toggle, the
dropdowns and the tab strip; an automated contrast check on the token pairs.

## Phase 5 - Features (four agents in parallel)

Each owns its own component files. The only shared file is the page shell's tab
list, which 5C alone edits.

| | Work | Owns |
|---|---|---|
| **5A** | ESPN live scores hook and the On the field block | `app/hooks/useLiveScores.ts`, `app/components/LiveGames.tsx` |
| **5B** | Win probability, expected points, luck | `lib/winprob.mjs`, `scripts/build-standings.mjs`, `app/components/Leaderboard.tsx` |
| **5C** | Trends tab: race chart, h2h matrix | `app/components/Trends*.tsx`, page shell tab list |
| **5D** | Logos | `scripts/build-logos.mjs`, `data/logos.json`, `app/components/TeamName.tsx` |

**Tests first, per agent:**
- 5A: the join is by id; ESPN unreachable, empty, or reshaped renders today's
  block unchanged; polling stops when nothing is live and when the tab hides
- 5B: `Phi` against known values; a pick-em is 50%; expected points never
  exceed the maximum available; a game with no line is excluded from both sides
  of luck and counted in the exclusion total
- 5C: the chart renders every manager across every week; the hidden table
  matches the plotted series; the matrix diagonal holds own-goal games and each
  pair's two cells are mirror images
- 5D: a missing logo renders nothing and reserves the same space

## Phase 6 - Integration

- Full-season fixture regenerated, golden diff read line by line
- Budget arithmetic recomputed and restated in the README
- Browser verification of every tab at 375px and desktop, light and dark
- One live workflow dispatch against the real API, output read before trusting

## Sequencing note

Phases 1 through 4 are the ones with a deadline: they are corrections to a site
that is live and being read during a season already in progress. Phase 5 is
additive and can land a piece at a time. If the season gets ahead of the work,
ship phases 0-3 and take the rest at whatever pace.
