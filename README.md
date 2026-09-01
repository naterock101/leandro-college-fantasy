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

The free tier is **1,000 calls/month**. The cron schedule uses **666**, leaving
334 for manual runs and testing.

| Window | Frequency | Calls/week |
|---|---|---|
| Sat 12pm-1am ET | 10 min | 84 |
| Thu/Fri 7pm-midnight ET | 15 min | 48 |
| Baseline | 8 hours | 21 |
| Betting lines, baseline runs only | 8 hours | 21 |
| | | **174** |

That is 174/week, about **759/month**, leaving ~240 for manual runs and testing.

One run is one call regardless of how many teams or weeks: the script fetches
`?year=2026&seasonType=both`, which returns the whole season including
conference championship games and the playoff. Every run re-reads every week,
so a score correction or a forfeit in an earlier week propagates automatically.
Do not "optimize" this into per-week calls. Fetching only the current week
breaks corrections to old weeks; fetching every week separately is ~16x the
calls and blows the free tier.

## Betting lines

Spreads come from `/lines`, a **second endpoint and therefore a second call**.
`scripts/build-lines.mjs` runs only on the 8-hourly baseline cron and on manual
dispatch, not on the 10-minute game-day polling. On every run it would cost
another ~666 calls/month and blow the free tier; at 8-hour freshness it costs
~93. Spreads do not move meaningfully between polls and stop mattering at
kickoff, so this is not a real loss.

It writes its own file, `public/lines.json`, rather than folding into
`standings.json`. That way the frequent standings runs re-read it and re-attach
whatever the last baseline run wrote, instead of spreads flickering in and out
depending on which cron fired.

`build-standings.mjs` treats the file as optional: missing or unparseable means
no spreads this run and a warning, never a failure. Standings must not depend on
the betting feed. DraftKings is preferred, Bovada is the fallback, and provider
names are normalised because CFBD has returned both `DraftKings` and
`Draft Kings`.

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
