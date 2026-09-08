# `data`

The payload the site reads. An orphan branch: it shares no commit with `main`,
which is the point - `main` is code and its history stays readable, and Vercel,
which builds from `main`, never sees a data commit.

Written only by `.github/workflows/poll.yml`. Nothing here is edited by hand.

| File | Read by |
|---|---|
| `standings.json` | the page, on every poll |
| `results.json` | the page, when the Activity tab is opened |
| `teams.json` | the page, when the All teams tab is opened |
| `lines.json` | `build-standings.mjs`, to attach spreads |
| `vercel.json` | Vercel, to say this branch does not deploy |

**`lines.json` is the only copy of the season's closing lines**, and it is
merge-only: a game that has ever had a price keeps it, because ESPN deletes the
odds object the moment a game goes final. Never force-push this branch, never
rebase it, and never overwrite that file with an older one. Losing it loses
every upset tag and every closing line back to the start of the season.
