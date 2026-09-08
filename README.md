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
                      +--------------------- main ----------------------+
GitHub Actions cron --| scripts/build-lines.mjs      ESPN, free          |
                      | scripts/build-standings.mjs  CFBD /games, 1/run  |
                      +-------------------------+-----------------------+
                                                |  writes into a worktree of
                                                v
                      +--------------------- data ----------------------+
                      | standings.json results.json teams.json          |
                      | lines.json                                      |
                      +-------------------------+-----------------------+
                                                |  raw.githubusercontent
                                                v
                        app/page.tsx, deployed from main by Vercel
```

### Two branches

`main` is code. `data` is an **orphan branch** carrying the payload and nothing
else - no shared commit with `main`, no code history on it at all.

That split is the whole architecture. Before it, 34 of the repo's first 49
commits were the bot's, one week into the season, on course for roughly 5,000
by December and burying every real change in the log. Both branches got worse
together when betting lines started refreshing on every run, taking a quiet
weekday from about zero commits to three.

Two things fall out of it, and both used to need work:

- **Vercel builds from `main`, and `main` no longer receives data commits**, so
  there is nothing to suppress. `vercel.json` used to carry an `ignoreCommand`
  that inspected each commit's diff and exited 0 on a data-only one, because
  `[skip ci]` alone had been observed deploying anyway. That whole workaround is
  gone, along with the coupling it created between the page's data source and
  the deploy configuration.
- **`main`'s log is readable.** `git log` shows the changes somebody made.

What replaces the workaround is a setting rather than a trick. Vercel would
otherwise build a *preview* deployment for every push to `data` - up to 144 on
a Saturday, which is the same daily-limit problem in a different branch - so
`git.deploymentEnabled` names the branch as one that does not deploy. It is set
in two places on purpose: in `main`'s `vercel.json`, and again in a two-line
`vercel.json` on `data` itself, because Vercel reads that configuration from
the branch being pushed and the second one is the copy it will actually find.

`[skip ci]` stays in the bot's commit message and is still doing work, for a
different reason than before. It says nothing to Vercel now. It is there for
**GitHub Actions**, which honours it, and which would otherwise run the whole
`test.yml` suite - `npm ci`, tests, a Next build - on every one of those
pushes. `test.yml` also excludes the branch outright; the message is the lock
that keeps holding if someone re-adds `push:` without a filter.

### How the Action writes to a branch it is not checked out on

`poll.yml` checks out `main` as usual, then adds a `git worktree` of `data`
at `.data`, and passes both scripts an explicit `--out` (and `--lines`) into
it. Nothing is copied between the two trees: the scripts read and write the
data files in place, so there is no copy step to forget, and forgetting one
would have been quiet and expensive - a run that read a lines file that was not
there would publish a season with no spreads on it and exit 0.

The worktree is a working tree of the same repository, so it inherits the
credentials `actions/checkout` configured and needs no token of its own. It is
created with `rm -rf .data && git worktree prune` in front and
`git worktree remove --force` behind under `if: always()`. On a GitHub runner
none of that can matter - the machine is destroyed after the job - but running
these steps by hand on a real checkout is exactly where a worktree left
registered after a failure makes the *next* attempt fail on something unrelated
to whatever broke.

If `data` does not exist on the remote, the run stops on its first step with a
message pointing at the bootstrap below, rather than half-succeeding.

### Four files, not one

The payload used to be a single 91KB file (10.4KB gzipped) that every open tab
refetched every two minutes, and `results` is the term that grows - about 64
entries a week, so roughly 1,000 and 275KB raw by the time the playoff is over.

| File | Holds | Fetched |
|---|---|---|
| `standings.json` | standings, projection, byWeek, gamesOfWeek, unscored, and the meta fields | always |
| `results.json` | results, headToHead | first time the Activity tab is opened |
| `teams.json` | byConference | first time the All teams tab is opened |
| `lines.json` | every spread the books have shown | never by the page; `build-standings.mjs` reads it |

On the live season that takes the always-fetched file from 92.7KB raw / 7.1KB
gzipped to **27.4KB / 3.1KB**, and takes the growing term off the polling path
entirely.

`lib/payload.mjs` owns the split in both directions, because the builder and
the page have to agree about which key is in which file and the cost of them
disagreeing is a section of the site that is silently empty rather than an
error anyone would see. It is keyed by what is *lazy*, so a key a later phase
adds falls into the always-fetched core by default: a few wasted bytes on every
poll is a much better failure than a section that belongs to no file at all.

A lazy file that is missing, still in flight, or 404ing gives its tab an empty
collection and a sentence saying so - never `undefined`, which is what throws a
render. That matters most during the cutover window described below, when every
lazy fetch fails by design.

### Polling

- **No cache-busting query string, and `cache: "no-cache"`.** Both of the old
  settings defeated revalidation, and the second is the subtle one: `no-store`
  reads as the stronger choice and is the wrong one, because it tells the
  browser not to keep a copy it could later revalidate against, so every poll
  transferred the whole body. `no-cache` still goes to the network every single
  time - it is not weaker - but it goes conditionally, and raw.githubusercontent
  sends a weak ETag and answers a matching `If-None-Match` with a 304 and no
  body. Verified against the live host, not assumed.
- **60 seconds while a tracked game is live, five minutes otherwise.** The old
  flat 120s ran against a bot that writes every 10 minutes at its fastest,
  behind a 300s CDN cache, so most polls could not return anything new. Whether
  anything is live comes from the shared `classify()` in `lib/games.mjs` rather
  than a second copy of the live-window arithmetic - that drift is what caused
  the dead-week bug.
- **Nothing polls while the tab is hidden.** A phone left open through a twelve
  hour Saturday used to poll about 360 times in a pocket. Coming back fetches
  immediately rather than waiting out an interval that was never running.

Two traps found in the browser rather than in the code. Cancelling in-flight
requests from the effect cleanup meant a page that resolved `document.hidden` a
tick after mount threw away its own first response and sat on "Loading" - so
the guard is mounted-or-not, not per-effect-run. And gating *every* fetch on
visibility swallowed the one fetch a newly opened tab needs, because a document
can report hidden while it is being clicked; intent and the timer are separate
effects for that reason.

### The copy bundled with the deploy

`main` still holds `public/standings.json`, `public/results.json` and
`public/teams.json`. The page falls back to them, per file, when the
raw.githubusercontent fetch fails: local development, an offline visitor, a
GitHub outage, and the cutover window.

**They are frozen deliberately and the bot never touches them.** Keeping them
current is precisely what would put data commits back on `main`, which is the
thing this whole section is about. They are refreshed only by hand, and only
when someone is deploying for another reason anyway and their staleness has
started to look silly - a fallback dated some weeks ago is honestly old, which
is a much better failure than one that is subtly wrong.

`public/lines.json` was **deleted** rather than frozen with them. Nothing on
the page reads it, and a stale duplicate of a merge-only file that holds every
closing line of the season is the kind of thing somebody eventually copies back
over the live one. `data` is now the only copy: never force-push that branch,
and never rebase it. `.gitignore` covers `public/lines.json` so a local
`npm run lines` cannot recreate the duplicate by accident.

## Setup

1. `npm install`
2. Get a free CFBD key at <https://collegefootballdata.com/key>
3. Add it as repo secret `CFBD_API_KEY` (Settings > Secrets and variables > Actions)
4. `npm run verify` locally to confirm all 80 school names resolve
5. Edit `SOURCE` at the top of `app/page.tsx` to point at your repo, on the
   `data` branch
6. Create and push the `data` branch, below. **Nothing works until it exists.**
7. Deploy to Vercel from `main`, then run the workflow once manually

## Bootstrapping the `data` branch

One-time, by hand, and the site is not fully working until it is done. The
branch exists locally already; this publishes it.

```sh
# 1. Confirm it is genuinely an orphan: this prints one sha and no parent.
git rev-list --parents -1 refs/heads/data

# 2. Publish it.
git push -u origin data

# 3. Publish the code that reads it.
git push origin main
```

Then, in the two web UIs:

- **Vercel** → the project → Settings → Git. Confirm `main` is the production
  branch. Push something to `data` (or wait for the first bot run) and confirm
  no deployment appears for it. `vercel.json` on the `data` branch should
  already prevent one; if a preview deployment shows up anyway, turn branch
  deployments off there rather than reaching for another commit-message trick.
- **GitHub** → Actions. Run **Update standings** manually once, and read the
  log rather than trusting the green tick: it should check out `data`, write
  four files into `.data`, and commit and push there. Then confirm no new
  commit landed on `main`, and that the **Tests** workflow did not run for the
  bot's push.

To recreate the branch from scratch - if it is ever lost, and with the caveat
that its `lines.json` history is not recoverable this way:

```sh
git checkout --orphan data
git rm -r --cached .
# copy standings.json, results.json, teams.json, lines.json and a vercel.json
# saying {"git":{"deploymentEnabled":false}} into the working tree, then
git add standings.json results.json teams.json lines.json vercel.json
git commit -m "Seed the data branch"
git checkout -f main
```

### What breaks during the cutover

Between pushing `main` and the first bot run landing on `data`, every fetch of
`https://raw.githubusercontent.com/.../data/*.json` returns 404 and the page
falls back per file to the copies bundled with the deploy. A visitor sees a
complete, working site showing the standings as of whenever `public/*.json` was
last committed, with the "Updated" line honestly saying so. Nothing is blank and
nothing throws.

A tab left open across the deploy keeps rendering the payload it already has
until it next polls, and then picks up the fallback or the live file, whichever
answers. The window closes at the first bot run - within eight hours on the
baseline cron, or immediately if the workflow is dispatched by hand, which is
what step 7 above is for.

## Commands

| Command | What it does |
|---|---|
| `npm run verify` | Diffs `data/rosters.json` against CFBD `/teams`. 1 API call. |
| `npm run standings` | Fetches the season, writes `standings.json`, `results.json` and `teams.json`. 1 API call. |
| `npm run standings:dry` | Same, prints the table, writes nothing. |
| `npm run standings:fixture` | Runs against `fixtures/sample-games.json`. No API call, no key needed. |
| `npm run fixture:regen` | Rebuilds `fixtures/sample-standings.json` from the sample games. No API call. |
| `npm test` | Both runners: `node --test` then `vitest run`. No network, no key. |
| `npm run test:node` | The pure suites only. No dependency at all. |
| `npm run test:dom` | The component suites only, under jsdom. |
| `npm run lines` | Fetches betting lines, writes `public/lines.json`. 1 API call. |
| `npm run lines:dry` | Same, writes nothing. |
| `npm run logos -- --espn` | Rebuilds `data/logos.json` from ESPN. No API call, no key. |
| `npm run logos` | Same from CFBD. 1 API call, needs a key, **currently refuses to write** - see "Crests". |
| `npm run dev` | Next.js dev server. |

Both builders take `--out` to say where their files go, and
`build-standings.mjs` also takes `--lines` to say where to read the spreads
from. That is how `poll.yml` points them at the `data` worktree, and it is how
to run either one locally without touching `public/`. Run `npm run standings`
with no flags and it overwrites the frozen fallback copies in `public/`; that
is harmless but it is a change to `main`, so read the diff before committing it.

`npm run fixture:regen` passes `--union`, which writes the whole payload to one
file instead of three. The golden fixture stays a single file on purpose: three
goldens would be three diffs to read, and could not state the invariant that
actually matters, which is that the split loses nothing. That invariant is
`tests/payload.test.mjs`, which builds the split into a temporary directory and
compares its union against the golden.

## Tests

`npm test` runs two runners, because the suite has two halves and they want
different things.

**`node --test`** owns everything pure - the builders, `lib/`, the payload
split. It needs no config, no transform and no dependency, and that is worth
keeping exactly as it is.

- `tests/lib.test.mjs` - the pure functions in `lib/`: the field pickers across
  both CFBD conventions, sort keys, game classification, formatting
- `tests/lines.test.mjs` - merge-only retention, both sign conventions, both
  provider spellings, and every way ESPN can fail
- `tests/build.test.mjs` - the builder end to end against the fixtures, as a
  golden file plus invariants that hold for any input at all
- `tests/payload.test.mjs` - the four-file split: that its union is exactly the
  payload, that no key is in two files or in none, and that a lazy file which
  never arrives leaves every tab an empty collection rather than `undefined`

**`vitest run`** owns the components, because rendering one needs a DOM and
`node --test` has not got one.

- `tests/page.test.tsx` - the fetch layer, rendered: a stable URL, a
  conditional request, the bundled fallback, the cadence, and the pause when
  the tab is hidden
- `tests/a11y.test.tsx` - the keyboard, which is the part nobody exercises by
  accident: the row toggle, Escape and focus return on the dropdowns, arrow
  keys along the tab strip
- `tests/contrast.test.tsx` - the token pairs, computed rather than eyeballed

The split between them is by extension - `tests/*.test.mjs` against
`tests/**/*.test.tsx` - so neither runner can pick up the other's files and
nothing runs twice. `npm test` chains them with `&&`, so a red pure suite stops
before the slower one starts; `npm run test:node` and `npm run test:dom` run
either half alone.

jsdom is the only thing this costs, and it is a `devDependency`. **Runtime
dependencies are still zero**, which is the rule the whole repo is built on.

Every run is hermetic. `--fixture` reads `fixtures/sample-games.json` and
`fixtures/sample-lines.json` and nothing else, so the suite makes no network
call, needs no `CFBD_API_KEY`, and cannot flake on CFBD being slow. That is also
why `.github/workflows/test.yml` costs nothing to run on every push - to every
branch except `data`, which is payload rather than code and has no
`package.json` on it at all.

Two things had to be pinned to make a golden file diffable:

1. **Lines.** A fixture build never reads the live lines file, which carries a
   wall-clock `fetchedAt` that moves every eight hours. `--lines` overrides
   that, because naming a file outright is an instruction rather than a
   default; leaving it off is what the golden depends on.
2. **The clock.** Whether a game is live or stalled is a function of *now*, so a
   fixture build pins one instant (`FIXTURE_NOW` in `scripts/build-standings.mjs`)
   rather than inheriting the wall clock. Without it the sample would classify
   week 3 one way today and another way next week, and stop being diffable on a
   date nobody chose. `--now <iso>` overrides it, and is refused without
   `--fixture` so a live run can never write a false `generatedAt`.

The golden file is regenerated as a deliberate step with the diff read, never as
a reflex to turn a red test green. The invariants are there precisely so that a
regenerated golden still has something biting it.

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
writes into the lines file, so the schedule and the budget are enforced in
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
dates a run actually asks for. `build-lines.mjs` asks for yesterday through a
week out, Eastern - and yesterday is in that list precisely so a game that went
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

**Why a week and not a day.** The window started at yesterday-to-tomorrow, and
the first run after the cutover - a Tuesday - priced nothing at all: it reached
Wednesday, and the games anyone cared about were the following Saturday. That
made "ESPN is the primary source" true only from Thursday, leaving Sunday to
Wednesday on the CFBD call at 7-hour granularity, which is the freshness this
was all meant to improve. Seven days out is the number that reaches the next
Saturday from any day, including from a Saturday. Re-run on the same Tuesday it
went from 0 priced games to 55, all 49 of that Saturday's included.

Nine requests a run rather than three. None of them touches the CFBD budget -
ESPN is unmetered, cached at `max-age=3`, and fetched per date independently,
so a date it has nothing for costs an empty array and nothing else. The CFBD
call remains throttled to one per seven hours and remains the only spend.

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
unparseable lines file, which is refused rather than rebuilt: that file
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

One payload across three files - see "Four files, not one" above for which key
lands where. Listed together here because it is one object as far as the page
is concerned: `lib/payload.mjs` cuts it up for the wire and puts it back
together on arrival.

- `standings[]` - per manager: points, wins, losses, remaining, ceiling, collisionLoss, and a `teams` map
- `byWeek[]` - cumulative standings snapshot after each week, regular then postseason
- `gamesOfWeek` - upcoming games where both teams are drafted, in the next week
  that has any. "Upcoming" is `scheduled` or `live` and nothing else, so a game
  that kicked off and was never completed cannot hold the week open
- `unscored[]` - rostered games that will never produce a winner, each with
  `key`, `week`, `seasonType`, `date`, lean `{team, manager}` sides and a
  `reason`: `"no result"` (kicked off, never completed), `"no score"` (marked
  final with no score in the feed) or `"tied"`. None of them count toward
  points, `remaining` or `ceiling`, and none of them appear in `gamesOfWeek`,
  `results` or `headToHead`
- `projection` - the next scheduled week if every betting favourite wins, plus
  `expectedGained` and `expectedPoints` per manager, which is the same week
  weighted by win probability instead. Both are kept: the naive one is what the
  arrow in the table means and has been on screen since before this existed,
  and a browser holding cached JS must not break on the new fields
- `luck[]` - points banked against points expected, over settled rostered games
  with a stored line. Carries `games` (how many counted) and `unpriced` (how
  many were excluded for having no line). See "Win probability" below
- `byConference` - every FBS team ranked by points within its conference, with drafter or null
- `headToHead[]` - completed games where both teams are drafted. The league
  tiebreaker. Each entry carries `spread` (the closing line, or null if the
  books never priced it) and `upset`, true when the winner was not the
  favourite. A pick-em has no favourite and is never an upset.
- `linesFetchedAt` - when the lines file was last refreshed, or null
- each `gamesOfWeek.games[]` entry carries a `spread` object (or null): `spread`
  (negative means the home team is favoured, CFBD's convention), `favorite`,
  `formatted`, `overUnder`, `provider`

See `fixtures/sample-standings.json` for a filled-in example. It is built from
`fixtures/sample-games.json` and `fixtures/sample-lines.json`, a hand-made pair
covering the cases the live feed only produces occasionally: an abandoned game,
a completed game with no score, a tie, two of one manager's teams playing each
other, a neutral site, a postseason game, and an undrafted team beating a
drafted one. Regenerate it with `npm run fixture:regen` after any change to the
compute logic or the rosters, and read the diff.

### Game states

`lib/games.mjs` classifies every game from the feed and the clock alone, and the
builder and the page share it so they cannot drift apart on what "live" means.

| State | Test | Counts toward `remaining`? |
|---|---|---|
| `scheduled` | not complete, kickoff in the future | yes |
| `live` | not complete, kicked off < 5.5h ago | yes |
| `stalled` | not complete, kicked off > 5.5h ago | **no**, and goes in `unscored` |
| `final` | complete, two different numeric scores | no |
| `unusable` | complete, scores missing or equal | **no**, and goes in `unscored` |

`stalled` is the state that does not exist upstream and has to. CFBD never marks
a game cancelled for weather, abandoned, or lost to a feed error as complete, so
without this it stays upcoming for the rest of the season. Because the next week
is the lowest sort key among upcoming games, one such game in week 1 pinned
"Games of the week" to week 1 forever, froze the projection on a week already
played, and inflated every affected ceiling by a game that will never happen.

A tie is `unusable` rather than `final` because this league has no half wins, and
a completed game with no score is a feed defect that must be visible rather than
skipped in silence. Both were previously invisible, which is the worst of the
three options when the number they are quietly wrong about is a ceiling.

5.5 hours is `LIVE_WINDOW_MS`, the window the page has always used: nothing in
college football runs longer, so a game that kicked off further back than that
has finished whatever the payload still says.

`--out` exists so a fixture build never lands in the file the site reads. Even
a few seconds of synthetic standings there is visible to anyone with the page
open, so the script refuses to write a `--fixture` build to `public/standings.json`.
It also refuses an `--out` whose name does not end in `standings.json`, because
the sibling files are named from that prefix and guessing at a name instead
would put the payload somewhere nobody looks - which reads as a missing section
on the site and as a successful run in the log.

### Ceiling

`points + (remaining scheduled games x point value) - collisionLoss`

"Remaining" is `scheduled` and `live` games only, per the table above. A stalled
game is not remaining: it cannot be won, so counting it overstated the ceiling
by 2 or 3 points for the rest of the season.

**`byWeek[].scheduled` deliberately still counts a stalled game.** So a week
that holds one reads "8/9 scored" for the rest of the season, and the ninth
game never arrives. That is a decision, not an oversight, and it was taken
knowing how it looks: the ninth game is named in "Never scored" directly below,
so the fraction is the honest count of what that week held rather than a total
quietly revised down to match what happened. Do not "fix" it to 8/8 without
deciding the same question again - the alternative is defensible, it just is
not what was chosen.

`collisionLoss` handles the case where two of one manager's own teams play each
other. Only one of them can win, so the lesser of the two point values is
subtracted. Nathan has Texas A&M vs Arizona State on Sep 12, both worth 3, so
his ceiling is docked 3.

Ceiling deliberately does **not** project the postseason. Bowl and playoff games
are not in the feed until December; when they appear they are counted like any
other scheduled game. The page shows a caption explaining this, and the
`postseasonScheduled` flag flips the wording once bowls exist.

## The page

`app/page.tsx` is the shell and nothing else: which tab is open, what has been
fetched, and where each section goes. Everything that draws anything is a
component, and the split is by seam rather than by size - each file is one
thing one person can change without touching another.

| File | Draws |
|---|---|
| `app/components/Tabs.tsx` | the tab strip, and the list of tabs itself |
| `app/components/Leaderboard.tsx` | the week strip, the table, the expanded squad |
| `app/components/LiveGames.tsx` | "On the field" |
| `app/components/GamesOfWeek.tsx` | the upcoming week and its spreads |
| `app/components/Unscored.tsx` | "Never scored" |
| `app/components/AllTeams.tsx` | the flat FBS table and its filters |
| `app/components/Activity.tsx` | head to head, and the timeline |
| `app/components/Trends.tsx` | the Trends tab, and its lazy fetch |
| `app/components/TrendsChart.tsx` | the points race |
| `app/components/TrendsMatrix.tsx` | the head-to-head grid |
| `app/components/TeamName.tsx` | one school, wherever it appears |
| `app/components/Dropdown.tsx` | the multi-select, used three times |
| `app/components/Style.tsx` | composes the stylesheet, in cascade order |

Styles live with their components, as a `css` export next to the JSX they
apply to. `app/styles.ts` keeps only what has more than one caller: the tokens,
the page frame, the table primitives and the `.gow` row shape. There is no CSS
framework and there will not be one - runtime dependencies are zero.

Three hooks. `useLiveScores` is described under "Live scores" below.
`useDismiss` closes a dropdown on an outside click or on Escape and
puts focus back on the trigger. `useViewState` is `useState` that outlives its
own component: sections unmount when you switch tab, and without it the week
you had selected, the row you had expanded and the team you had typed would all
reset on the way back.

### Trends

Two views, both from data the payload already carries. The **points race** is
`byWeek[].cumulative`; the **head-to-head matrix** is `headToHead`, which
matters because head to head is the league tiebreaker and until now existed
only as a chronological list. Rows and columns mirror each other, and the
diagonal is a manager's own two teams playing each other.

`headToHead` lives in `results.json`, the lazy file, so opening Trends warms
Activity and vice versa - both declare the same need and the fetch is shared.
A 404 there renders the chart and an explanation rather than throwing, which is
the whole cutover window and any GitHub outage.

Hand-rolled inline SVG. There is no charting dependency and there will not be
one, for the same reason there is no CSS framework.

Three things that are less obvious than they look:

- **Eight series cannot be told apart by hue.** Four tokens are used twice
  over, and the two that share a colour differ in *both* stroke pattern and
  marker shape - so no two series match on all three, and the four colours are
  also four separated lightnesses, which survives greyscale and red-green
  confusion. Names sit at the end of their own lines; there is no legend to
  cross-reference.
- **Colours are assigned in alphabetical manager order, not standings order.**
  A colour that moves when somebody wins on a Saturday makes the chart
  unreadable across two visits.
- **`viewBox` alone is not responsive.** Type inside an SVG scales with the
  box, so a 720-unit chart rendered 12px labels at 19px on desktop and 6px on a
  phone. The chart is capped at 1:1 and the type is fixed at the sizes the rest
  of the page uses.

With one week scored there is nothing to draw a line through, so it collapses
to a dot plot and becomes a race at the second Saturday. That is the live case
today, not an edge case.

The SVG is `aria-hidden`; a visually-hidden `<table>` carries the same numbers,
and a test inverts the plotted coordinates back into points and compares them
to it - the failure worth catching is the half nobody sighted can see drifting
away from the half they can.

### Accessibility

The things that were wrong, and what they are now:

- The leaderboard row was a `<tr onClick>` with no `tabIndex`, `role` or key
  handler, so the squad detail could not be opened without a pointer at all.
  The manager cell is a real `<button>` driving `aria-expanded` and
  `aria-controls`. The row is still clickable, because on a phone the row is
  the target anyone actually hits.
- The three dropdowns had `aria-expanded` and nothing behind it: no way to
  dismiss one from the keyboard and no way back to the control that opened it.
- The tab strip was three unrelated buttons. It is now `role="tablist"` with a
  roving `tabindex`, arrow keys, Home and End, and a labelled panel.
- The live dot said "these are happening now" in red and in motion and in
  nothing else. The count beside it now says it in words, visibly, and the dot
  is `aria-hidden`.
- Every control had its focus ring left to the user agent and the search box
  switched its own off. There is a `:focus-visible` ring in the tokens.

The contrast audit is `tests/contrast.test.tsx`, and it found the opposite of
what was expected. `--muted` at `#7E8FA3` on `--ink` was **5.54:1** - already
past the 4.5:1 WCAG AA asks of text this size. What failed was every rule that
then dimmed it with `opacity`, none of which is visible from the palette:

| Rule | Before | After |
|---|---|---|
| `.caption` at `opacity:.85` | 4.34:1 | 7.28:1 |
| `.wk` at `.75` | 3.65:1 | 5.54:1 |
| `.undr`, `.owner.un` at `.65` | 3.05:1 | 5.54:1 |
| `.arrow.flat` at `.6` | 2.78:1 | 5.54:1 |
| `.stakes.them` at `.55` | 2.53:1 | 5.54:1 |
| `.err` (`#C4566B`, body size) | 4.27:1 | 5.48:1 |

So the dimming is a second token rather than an opacity. `--dim` is the old
`--muted` exactly, and `--muted` moves up to `#94A5B8` to make room above it.
The test asserts both halves: that every token clears AA on both grounds, and
that the hierarchy the dimming was for still exists. It also fails on any new
`opacity` in a text rule, because that is the thing an eye lets past.

## Live scores

CFBD's `/games` carries no clock, period or status, so until this the page could
only say a game had kicked off and was not yet final. Live detail proper is
`/scoreboard`, a second metered endpoint that on the 10-minute cron would cost
another ~666 calls a month against a 1,000 cap.

ESPN's public scoreboard gives the same thing for nothing, and the page fetches
it **directly from the browser** - no Action, no commit, no CFBD call:

```
https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=YYYYMMDD&groups=80
```

No auth, `access-control-allow-origin: *`, `cache-control: max-age=3`. Verified
from a browser origin, not just from curl.

**The join is the game id, and the id is a string on one side and a number on
the other.** ESPN's event id and CFBD's game id are the same value -
`401858212` is SMU/FSU in both feeds - which is why none of the name traps
below apply to any of this. But `"401858212" === 401858212` is `false`, and a
strict-equality join would have matched nothing, forever, with no error
anywhere to say so. Both sides go through `String()`.

`useLiveScores(games)` derives its dates from the kickoff times of the games it
is handed rather than from a fixed window - usually one date - and polls every
30s only while something is inside `LIVE_WINDOW_MS` **and** the tab is visible.

Two things the payload shape forces:

- **`status` appears in two places**, on the event and on `competitions[0]`.
  Reading only one is a coin flip. `e.status ?? comp.status`.
- **`type.detail` is needed and cannot always be shown.** At halftime the state
  is still `"in"` and the clock is `"0:00"`, so score/period/clock alone can
  only ever render "Q2 0:00". `detail` is what says Halftime, End of 3rd,
  Delayed or Final/3OT. For a game that has not started it reads "Sat,
  September 12th at 12:00 PM EDT", so it is suppressed in that state and the
  row keeps its own kickoff in the reader's timezone.

Degradation is asserted as **byte identity**, not hoped for: unreachable, 429,
a 200 with an HTML body, a reshaped `{events:{items:[...]}}` and an empty
`{events:[]}` all render exactly the block that shipped before this existed. A
round where every date fails leaves the previous scores alone rather than
blanking them - a score that stops updating beats a score that vanishes.

This is the second external host the page talks to at runtime, and the first
that is undocumented. It costs nothing against the CFBD budget and it is
allowed to disappear.

## Win probability, expected points and luck

```
P(favourite wins) = Phi(|spread| / sigma),  sigma = 16
```

**Sigma is a modelling assumption, not a fact**, and lives in one named
constant saying so. 16 approximates the standard deviation of college football
margins against the spread. Calibrated against this season so far: the model
expected 55.8 favourite wins from 65 settled games and 59 happened, which is
inside noise at that sample size.

Three things are built on it. **Per-game win probability** beside the spread in
Games of the week. **Expected points** - `wp(team) x tier value` summed per
manager over the coming week, which is a better projection than "every
favourite wins" because it does not throw away the size of the line. And
**luck**: points banked minus points expected over settled games, so positive
means running hot.

Two rules, both enforced by tests rather than convention:

- **A game with no line is in neither half of the calculation**, and the count
  of excluded games is carried in the payload and shown in the caption. A luck
  number that quietly ignores part of the season is worse than no luck number.
- **Nothing reads the `closed` flag.** It is only ever set by a run that
  fetches that game's date, so every game that finished before it shipped will
  never carry it - 1 of 287 stored lines has it today. The spread survives
  regardless, and the spread is what the maths needs.

A pick-em is 50/50 both ways and can never be an upset. Note it is *invisible*
to the naive projection, which skips any line with no favourite, and *visible*
to the weighted one at half a win each side - the two loops are therefore not
the same loop, which is easy to get wrong by combining them.

One asymmetry worth stating because it reads wrong at first: a season in which
every favourite won is **not** positive luck for everyone. It is positive for
whoever owned the favourites and negative for whoever owned the beaten
underdogs, because an underdog is expected to win sometimes and losing all of
them is below expectation. Luck sums to roughly zero across the league.

## Crests

`data/logos.json` maps the exact CFBD school string to `{logo, color, altColor}`,
committed by hand and rebuilt only when a school rebrands or joins FBS. It is
bundled rather than fetched - 186 entries, 28KB raw and 3.8KB gzipped - so there
is no request and no loading state.

**Run `npm run logos -- --espn`, not `npm run logos`.** CFBD's `/teams` is
authoritative for the *keys*, which is the join and the reason the CFBD path
exists at all. Its *image URLs* are a different matter: run against the live API
on 2026-09-08 it wrote 642 entries whose every logo 403s from
`cdn.collegefootballdata.com`, the CDN its own response names, while reporting
"80/80 rostered schools resolve" - because resolving meant the school string had
an entry, and nothing had ever fetched the image. The script now fetches a
sample before writing and refuses that outcome.

**The host is load-bearing, not just the bytes.** `thumb()` in `TeamName.tsx`
rewrites an `a.espncdn.com` path through ESPN's combiner down to 40px. The 500px
originals are a median 36KB and 5.9MB for the 136-row All teams table; through
the combiner that is 1.5KB and 270KB, a 22x cut. Every other host is returned
untouched, so a map that merely *loads* can still be 22x heavier with nothing
saying so. The guard warns about the host separately from the fetch.

A school with no entry renders no `<img>` at all - not a broken-image glyph and
not an empty `src` - but does render an empty box of the same size, because one
row's name starting 23px left of every other is worse than the gap. The crest is
decorative beside the name it labels, so `alt=""`: a screen reader says the
school once.

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
- `Louisiana` (Adam) vs `Louisiana Tech`, a real opponent and a real prefix
  trap. The third school is `UL Monroe` in CFBD, **not** "Louisiana Monroe" as
  an earlier revision of this list claimed - that string appears nowhere in the
  feed.
- `Hawai'i` is a plain apostrophe, **U+0027**. An earlier revision of this list
  said it was an okina (U+02BB) and it never was: the roster, the CFBD feed and
  ESPN all agree on U+0027, verified by code point. That entry was the most
  dangerous line in this file - anyone "fixing" the roster to match it would
  have broken the join and scored that team zero for the season, which is
  precisely the failure this section exists to prevent. Check a claim about a
  character against the bytes, never against prose.
- `San José State` is accented in CFBD - **é**, U+00E9
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
