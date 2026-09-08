# CFB Squad Standings

Live standings for an 8-person college football squad league. Static site on
Vercel, data refreshed by a GitHub Actions cron. No backend, no database.

## The league

Eight managers each drafted 10 FBS teams, exactly one from each of the ten FBS
conferences. Scoring is total wins across your squad:

- Power conference win (ACC, Big Ten, Big 12, SEC): **3 points**
- Every other conference win (American, C-USA, MAC, Mountain West, Pac-12, Sun Belt): **2 points**

Conference championship, bowl and playoff wins all count. Independents were not
draftable. Tiebreaker is head to head games. $50 buy-in, pays 250/100/50.

## Architecture

```
GitHub Actions cron  ->  scripts/build-standings.mjs  ->  public/standings.json  (committed)
                                    |                              |
                              CFBD /games                    raw.githubusercontent
                             (1 call per run)                        |
                                                          app/page.tsx (static, Vercel)
```

The bot's data commits must not trigger a Vercel build. `[skip ci]` in the
commit message is **not** sufficient - it was observed deploying anyway - so
`vercel.json` carries an `ignoreCommand` that skips the build whenever a commit
touched nothing outside `public/standings.json` and `public/lines.json`. It
exits 0 (skip) only on a data-only commit; any code change, or any git error
such as a shallow clone with no `HEAD^`, exits non-zero and the build proceeds.

This matters at scale: during the Saturday window the bot commits every 10
minutes, ~144/day, which would exhaust the Hobby plan's daily deployment limit
within hours and freeze the site.

Because the site therefore does not rebuild on data changes, the page reads the
live JSON from raw.githubusercontent rather than its own bundled copy. These two
decisions are coupled - change one and you must change the other.

## Setup

1. `npm install`
2. Get a free CFBD key at <https://collegefootballdata.com/key>
3. Add it as repo secret `CFBD_API_KEY` (Settings > Secrets and variables > Actions)
4. `npm run verify` locally to confirm all 80 school names resolve
5. Edit `SOURCE` at the top of `app/page.tsx` to point at your repo
6. Deploy to Vercel. Run the workflow once manually to seed `public/standings.json`

## Commands

| Command | What it does |
|---|---|
| `npm run verify` | Diffs `data/rosters.json` against CFBD `/teams`. 1 API call. |
| `npm run standings` | Fetches the season, writes `public/standings.json`. 1 API call. |
| `npm run standings:dry` | Same, prints the table, writes nothing. |
| `npm run standings:fixture` | Runs against `fixtures/sample-games.json`. No API call, no key needed. |
| `npm run fixture:regen` | Rebuilds `fixtures/sample-standings.json` from the sample games. No API call. |
| `npm run lines` | Fetches betting lines, writes `public/lines.json`. 1 API call. |
| `npm run lines:dry` | Same, writes nothing. |
| `npm run dev` | Next.js dev server. |

## API budget

The free tier is **1,000 calls/month**. Two numbers get quoted for what we
spend and both are right, which is why they are now labelled: **~665/month is
the standings schedule alone**, and **~757/month is standings plus the CFBD
betting lines**. The second is the one to compare against the cap. It leaves
~240/month for manual runs, `verify-teams.mjs` and testing.

The arithmetic below is per week, converted at 365.2425/12/7 = 4.348 weeks per
month. Older revisions of this file used a slightly coarser factor and quoted
666 and 759; same schedule, same calls, rounder divisor.

Every cron deliberately avoids `:00`, `:15`, `:30` and `:45`. GitHub's scheduler
is best effort and queues behind the whole platform on the round minutes. The
original baseline fired only at `:00`, and its 08:00 slot did not actually run
until 13:22 - 5h22m late on an 8 hour cycle, so the site sat stale all morning.

If the schedule ever looks dead again, run `gh run list` first. A run that is
simply absent means the scheduler has not dispatched it yet, which is a delay
rather than a failure, and is not something the repo can fix. A run that exists
and failed is a real problem worth reading the logs for.

The crons are no longer coupled to anything. The lines step used to be gated on
an `if:` matching the baseline cron string character for character, so re-timing
the baseline would have silently stopped betting lines from refreshing.
`build-lines.mjs` now throttles its own CFBD call against the `cfbdFetchedAt` it
writes into `public/lines.json`, so the schedule and the budget are enforced in
one place instead of two files agreeing about a string.

| Window | Frequency | Calls/week |
|---|---|---|
| Sat 12pm-1am ET | 10 min | 84 |
| Thu/Fri 7pm-midnight ET | 15 min | 48 |
| Baseline | 8 hours | 21 |
| **Standings subtotal** | | **153** |
| CFBD betting lines, self-throttled to one per 7h | | 21 |
| | | **174** |

174/week is about **757/month**. The lines throttle is 7 hours rather than 8, so
on a Saturday - when the 10-minute schedule is still running seven hours after
the 16:17 baseline - it can admit one extra call, for a worst case of 24/week
and **~770/month**. Both are comfortably inside the cap.

ESPN's scoreboard is the primary lines source and costs nothing here: no key, no
quota, not a CFBD endpoint. Adding it moved spread freshness from 8 hours to 10
minutes without moving this table at all.

One run is one call regardless of how many teams or weeks: the script fetches
`?year=2026&seasonType=both`, which returns the whole season including
conference championship games and the playoff. Every run re-reads every week,
so a score correction or a forfeit in an earlier week propagates automatically.
Do not "optimize" this into per-week calls. Fetching only the current week
breaks corrections to old weeks; fetching every week separately is ~16x the
calls and blows the free tier.

## Betting lines

Two sources, joined on the game id and never on a school name.

**ESPN's public scoreboard is primary** and runs on every standings run. No key,
no quota, `access-control-allow-origin: *`, `cache-control: max-age=3`. Its
event id is byte identical to the CFBD game id - `401858212` is the SMU/FSU game
in both feeds - so the join is an integer comparison and none of the name traps
below apply to it.

**CFBD `/lines` is the gap fill**: it prices games ESPN has not, and it is the
cross-check if ESPN reshapes itself. It is a paid-budget call, so
`build-lines.mjs` throttles it to one per 7 hours by comparing against the
`cfbdFetchedAt` it wrote last time.

### The file is merge-only

**ESPN deletes the odds object once a game goes final.** Checked on 2026-09-05:
68 completed games, not one with a `competitions[0].odds`. A builder that wrote
a fresh map every ten minutes against a source that forgets would erase the
spread of every completed game, taking with it upset tagging on the head-to-head
list and the timeline, and every closing line.

So: **a game that has ever had a price keeps its last observed price forever. A
refresh may add a game or update a price; it may never remove one.** That is the
first test in `tests/lines.test.mjs`, and `build-lines.mjs` refuses to write a
map smaller than the one it read.

Each entry carries two fields beyond what the page renders:

- `closed` - true once ESPN reported the game complete, so a closing line is
  identifiable as such rather than guessed at from the file's mtime. It is
  sticky: a finished game cannot un-finish, and CFBD cannot see status at all.
- `seenAt` - when the stored price was established. It deliberately does not
  move on a re-observation that found the same price; the file-level
  `fetchedAt` already says when we last looked, and bumping ~280 entries every
  ten minutes would make every run a 280-line diff carrying no information.

Both fields are optional. Every entry already in the file predates them: those
keep their price and can still be marked `closed`, but no `seenAt` is invented
for a price we did not watch arrive.

**What `closed` can and cannot tell you.** It comes from ESPN's
`competitions[0].status.type.completed`, which is reliable but only for the
dates a run actually asks for. `build-lines.mjs` asks for yesterday, today and
tomorrow, Eastern - and yesterday is in that list precisely so a game that went
final overnight is seen as final before it scrolls out of the window. Two
honest limits follow. Games already complete before this was deployed will
never be marked, because nothing will ask for their date again. And if the
workflow is down across a game's entire final-and-plus-one-day window, that
game keeps its last live price and no `closed` flag. CFBD `/lines` carries no
status field at all, so it can never set the flag - its observations say
"unknown", never "not finished". Treat `closed: true` as proof the stored price
is a closing line, and its absence as no information either way.

That parameter is an **Eastern** calendar day, not a UTC one: `dates=20260905`
returns games from 16:00Z that day through 02:30Z the next. Computing the
window in UTC would put every Saturday night game on the wrong date, which on a
Saturday night poll is the only game anyone is looking at.

### Normalisation

The two feeds disagree, and `lib/lines.mjs` is where that is settled. Output
keeps the shape the page already renders - `{spread, favorite, formatted,
overUnder, provider}` - so nothing downstream knows ESPN exists.

- **Sign.** CFBD states the spread from the home team's perspective: negative
  means home is favoured. ESPN's is signed the same way, but the favourite is
  taken from its explicit `homeTeamOdds.favorite` / `awayTeamOdds.favorite`
  flags and the sign is then rebuilt from that, so a change to ESPN's sign
  convention cannot quietly invert a favourite.
- **Provider.** CFBD has returned both `DraftKings` and `Draft Kings`, so names
  are normalised for the preference order (DraftKings, then Bovada) while the
  book's own spelling is kept for display. On ESPN, `provider.displayName` was
  present on 1 of 53 priced games and `provider.name` on all 53; both are read,
  displayName first.
- **Names.** `formatted` always states the favourite laying points, using the
  full CFBD school string: `"SMU -3"`, never ESPN's `details` field, which says
  `"SMU -3"` with an abbreviation that would not match a winner's name and would
  tag a false upset. ESPN's school string is the competitor's `team.location`;
  all 80 rostered schools matched one exactly.
- **Pick-ems** have `spread: 0`, `favorite: null` and `formatted: "PK"`, which is
  what makes them untaggable as upsets.

### Failure

ESPN is undocumented, so every way it can fail - unreachable, rate limited,
non-JSON, reshaped, empty for a date - leaves the stored file untouched and
exits 0, and each of those is asserted. The only non-zero exit is an
unparseable `public/lines.json`, which is refused rather than rebuilt: that file
is the season's only copy of every closing line.

It writes its own file rather than folding into `standings.json`, so a run whose
lines step degraded still re-attaches the spreads already on disk instead of
blanking them. `build-standings.mjs` treats the file as optional: missing or
unparseable means no spreads this run and a warning, never a failure. Standings
must not depend on the betting feed.

`node scripts/build-lines.mjs --espn-fixture path.json` replays a captured
scoreboard payload instead of calling the network. That is how the tests stay
hermetic, and how to reproduce a run that produced a surprising file.

## Data model

`public/standings.json`:

- `standings[]` - per manager: points, wins, losses, remaining, ceiling, collisionLoss, and a `teams` map
- `byWeek[]` - cumulative standings snapshot after each week, regular then postseason
- `gamesOfWeek` - upcoming games where both teams are drafted, in the next week that has any
- `byConference` - every FBS team ranked by points within its conference, with drafter or null
- `headToHead[]` - completed games where both teams are drafted. The league
  tiebreaker. Each entry carries `spread` (the closing line, or null if the
  books never priced it) and `upset`, true when the winner was not the
  favourite. A pick-em has no favourite and is never an upset.
- `linesFetchedAt` - when `public/lines.json` was last refreshed, or null
- each `gamesOfWeek.games[]` entry carries a `spread` object (or null): `spread`
  (negative means the home team is favoured, CFBD's convention), `favorite`,
  `formatted`, `overUnder`, `provider`

See `fixtures/sample-standings.json` for a filled-in example. Regenerate it with
`npm run fixture:regen` after any change to the compute logic or the rosters.

`--out` exists so a fixture build never lands in `public/standings.json`. The
page polls every two minutes, so even a few seconds of synthetic standings in
the live file is visible to anyone with the page open. The script refuses to
write a `--fixture` build to the live path.

### Ceiling

`points + (remaining scheduled games x point value) - collisionLoss`

`collisionLoss` handles the case where two of one manager's own teams play each
other. Only one of them can win, so the lesser of the two point values is
subtracted. Nathan has Texas A&M vs Arizona State on Sep 12, both worth 3, so
his ceiling is docked 3.

Ceiling deliberately does **not** project the postseason. Bowl and playoff games
are not in the feed until December; when they appear they are counted like any
other scheduled game. The page shows a caption explaining this, and the
`postseasonScheduled` flag flips the wording once bowls exist.

## Correctness guards

The script exits non-zero rather than producing wrong-but-plausible standings:

1. **Roster validation**, before any network call. Every manager must have 10
   teams, exactly one per conference, exactly 4 power teams, no team drafted twice.
2. **Name resolution**, after the fetch. Any roster team matching zero games in a
   full-season feed is a name mismatch, not a bye. Skipped for small fixtures.

A failed Action emails you. That is the point. Silently scoring a manager at 0
all season because of one wrong string is the failure mode worth engineering
against.

### Name traps

`data/rosters.json` joins on the CFBD `school` string with **exact equality**.
Never substring match. The traps that make this non-negotiable:

- `Miami` (FL, Nathan) vs `Miami (OH)` (Steve)
- `Ohio` (Clint) vs `Ohio State` (Adam)
- `Louisiana` (Adam) vs Louisiana Monroe and Louisiana Tech, both real opponents
- `Hawai'i` uses an okina (U+02BB), not an apostrophe
- `San Jose State` is accented in CFBD
- `UTSA`, not `UT San Antonio`
- `Southern Miss`, not `Southern Mississippi`
- `App State`, not `Appalachian State`

All 80 names were confirmed against a live `/teams` response for 2026 and every
conference matched. Any entry added later should carry `"verify": true` until
`npm run verify` clears it.

## 2026 realignment notes

The conference field is load-bearing for validation but **not** for scoring.
Point values come from the hardcoded `tier` field, because conference and value
have come apart this season:

- North Dakota State moved FCS to FBS, football-only Mountain West. Ineligible
  for the MW title game during transition, bowl-eligible at 6-6.
- Boise State, Colorado State, Fresno State, San Diego State and Utah State left
  the Mountain West for the re-formed Pac-12.
- UTEP and Northern Illinois joined the Mountain West. Sacramento State joined the MAC.
- Texas State, Washington State and Oregon State are Pac-12, worth 2 points.

The Pac-12 has exactly 8 football schools and this league drafted all 8, so
every Pac-12 conference game is a head to head between two managers.
