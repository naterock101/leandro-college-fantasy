# Handoff prompt

Paste everything below into your coding agent as the opening message, with the
repo attached or already checked out.

---

You are picking up a working, tested project. Read this whole brief before
changing anything. The repo is not a sketch: the compute script has been run
against fixtures and produces verified-correct output. Your job is to finish
deployment and build on it, not to redesign it.

## What this is

A live standings site for an 8-person college football squad league. Static
Next.js site on Vercel. A GitHub Actions cron fetches results, computes
standings, and commits a JSON file. No backend, no database, no auth.

## The league rules (these are fixed, do not reinterpret)

Eight managers drafted 10 FBS teams each, exactly one from each of the ten FBS
conferences. Scoring is total wins across the squad:

- Win by a Power conference team (ACC, Big Ten, Big 12, SEC): 3 points
- Win by any other conference team (American, Conference USA, Mid-American,
  Mountain West, Pac-12, Sun Belt): 2 points

Conference championship wins, bowl wins and playoff wins all count. Independents
(Notre Dame, UConn) were not draftable. Tiebreaker is head to head games.
$50 buy-in, pays $250 / $100 / $50. The managers are: nathan, tconn, leandro,
charlie, steve, devish, adam, clint.

## Current state

Working and tested:

- `scripts/build-standings.mjs` - fetches CFBD, validates, computes, writes JSON
- `scripts/verify-teams.mjs` - diffs roster names against CFBD `/teams`
- `data/rosters.json` - all 80 teams mapped, validated for the one-per-conference rule
- `app/page.tsx` - three-tab UI, leaderboard, all-teams and head-to-head
- `.github/workflows/poll.yml` - cron on a football-shaped schedule
- `fixtures/` - sample input and output so you can run everything with no API key

Not done:

1. **Run `npm run verify` and clear the `"verify": true` flags in
   `data/rosters.json`.** 22 entries are unconfirmed guesses at CFBD's exact
   school strings. This is the highest-priority task. Nothing else matters if a
   name is wrong, because that manager silently scores zero all season.
2. Set `SOURCE` at the top of `app/page.tsx` to the real repo URL.
3. Add `CFBD_API_KEY` as a GitHub Actions secret.
4. Deploy to Vercel, then run the workflow manually once to seed
   `public/standings.json`.

## Hard constraints

**API budget: 1,000 calls/month, free tier.** The current schedule uses 666.
Every call must be justified against that number. Do not add polling without
recomputing the budget.

**One call per run.** The script fetches `?year=2026&seasonType=both`, the whole
season in one request. This was considered carefully and is not naive:

- Fetching only the current week is the same 1 call but breaks score corrections
  and forfeits applied to earlier weeks.
- Fetching each week separately is ~16 calls per run, roughly 2,000/week. Twelve
  times over the free tier.

If you think you have a reason to change this, say so before doing it.

**The bot commit carries `[skip ci]`.** At 10-minute polling the Action can
commit 144 times a day. Without the tag every commit triggers a Vercel deploy
and blows the Hobby plan's daily deployment limit. Because the site therefore
never redeploys on data changes, `app/page.tsx` reads the JSON from
raw.githubusercontent with a cache-buster, not from its own `/standings.json`.
These two decisions are coupled. Change one and you must change the other.

**Exact string matching on team names, never substring.** The roster joins to
CFBD on the `school` field. Substring matching produces wrong standings that
look plausible:

- `Miami` (Nathan's Hurricanes) vs `Miami (OH)` (Steve's RedHawks)
- `Ohio` (Clint) vs `Ohio State` (Adam)
- `Louisiana` (Adam's Ragin' Cajuns) vs Louisiana Monroe and Louisiana Tech
- `Hawai'i` uses an okina (U+02BB), `San Jose State` is accented

**Scoring reads `tier`, never the API's conference field.** 2026 realignment
broke the correlation. Texas State, Washington State, Oregon State, Boise State,
Colorado State, Fresno State, San Diego State and Utah State are all Pac-12 and
all worth 2 points. North Dakota State moved up from FCS into the Mountain West
this year and is worth 2. The `conf` field exists only for the
one-team-per-conference validation and for grouping in the UI.

**Fail loudly, never silently.** Two guards exist and should stay:

1. Roster validation before any network call: 10 teams per manager, one per
   conference, 4 power teams, no duplicates across managers.
2. After the fetch, any roster team matching zero games in a full-season feed
   exits non-zero. That is a name mismatch, not a bye.

A failed Action sends email. Wrong standings do not.

## Ceiling semantics

`ceiling = points + (remaining scheduled games x point value) - collisionLoss`

`collisionLoss` covers two of the same manager's teams playing each other. Only
one can win, so subtract the lesser of the two values. Nathan's Texas A&M and
Arizona State meet on Sep 12, both worth 3, so his ceiling is docked 3.

Ceiling does **not** project the postseason. Bowls and playoff games are absent
from the feed until December; once present they count like any other scheduled
game. The UI caption says so, and the `postseasonScheduled` boolean flips the
wording automatically. Do not add speculative postseason projection.

## UI as built

Tab 1, Leaderboard: columns are Manager, W-L, Points, Games Left, Ceiling. Tap a
row to expand that manager's ten teams with per-team record and points. A week
selector switches the table to cumulative standings after any past week, which
is how you audit a number that moved. Below it, "Games of the week" lists
upcoming matchups where both teams are drafted.

Tab 2, All teams: every FBS team grouped by conference, ranked by points, tagged
with its drafter or "undrafted". Has an undrafted-only filter and a search box,
which is how you check whether a team is already taken. The search folds accents
and punctuation, so "san jose st" and "texas am" both hit.

Tab 3, Activity: two views over the same manager filter. "Head to head" is the
log of every scored game where both teams are drafted, newest first - the league
tiebreaker, with a manager's own two teams playing each other tagged "own goal".
"Timeline" opens with "On the field", the league games in progress right now,
and then every scored game with a drafted team on either side, grouped by week,
with the points the win was worth.

"On the field" costs nothing to produce. CFBD's /games carries no clock, period
or status, so a game in flight is inferred in the browser: it is still in the
upcoming list, its kickoff has passed, and it started less than five and a half
hours ago. That last bound matters because outside the Saturday window the bot
runs only every eight hours, so a finished game can sit in the upcoming list for
most of a day. Because it is computed against the wall clock rather than the
payload, the list is right the moment a game kicks off, with no refresh needed.
Scores are shown only if the feed happens to be carrying one, which in practice
it is not: live scoring lives on /scoreboard, a second call per run that would
put the cron over the free tier. Do not add it without redoing the API budget. Both views run newest first the whole
way down: the weeks descend and the games inside each week descend too. A team
that lost to an undrafted opponent appears with a blank points column, and under
a manager filter the week total counts only that manager's own wins - their team
losing to another manager's team is listed but its points are dimmed, because
they belong to the winner.

Styling is inline in a `<Style />` component, no CSS framework, no chart
library, zero runtime dependencies beyond React and Next. Keep it that way
unless there is a real reason.

## How to work on this

Run `npm run standings:fixture` to exercise the whole compute path with no API
key and no network. It should print devish 7, nathan 7, tconn 6, adam 2 and the
rest at 0, with nathan showing a 3-point own-matchup deduction. If your change
alters that output and you did not intend it, you broke something.

`fixtures/sample-standings.json` is real generated output and documents the JSON
shape.

## Good next features, roughly in order

1. Clear the 22 verify flags (blocking, do this first)
2. Deploy and seed
3. A points-over-time chart from the `byWeek` data already in the JSON
4. A Pac-12 view: all 8 teams are drafted, so that conference is strictly
   zero-sum between managers and is worth surfacing on its own
5. Per-manager permalink so people can share their own squad

Ask before adding dependencies, changing the fetch strategy, or altering the
scoring logic.
