/**
 * The shape of the payload, in one place.
 *
 * Every section component reads some slice of `Data`, and before the split
 * these types were declared once at the top of a single file where that was
 * free. Re-declaring them per component would not be: two components would
 * eventually disagree about whether a field is optional, and the one that got
 * it wrong would be the one that crashes on a payload the bot wrote before
 * the field existed.
 *
 * The optionality here is load-bearing rather than defensive. A browser
 * holding cached JS must not break on a payload written before a section
 * shipped, and a page must not break on one written after; every `?` below is
 * one of those two windows.
 */

import { LAZY } from "../lib/payload.mjs";

export type Tab = "league" | "teams" | "h2h" | "trends";

/* The names of the files that are fetched only once a tab asks for them, taken
   from the module that defines the split rather than written out again here.
   The builder and the page have to agree about which key is in which file, and
   the consequence of them disagreeing is a section of the site that is
   silently empty rather than an error anyone would see. */
export type Lazy = keyof typeof LAZY;

/* idle: nobody has opened the tab that needs it. failed: we asked and did not
   get it, which is a different sentence from "nothing has happened yet" and
   must not be shown as one. */
export type Load = "idle" | "loading" | "ready" | "failed";

export type Tier = "p4" | "g5";

export type Spread = {
  spread: number;
  favorite: string | null;
  formatted: string;
  overUnder: number | null;
  provider: string;
};

export type TeamRow = {
  team: string; draft: string; conf: string; tier: Tier;
  wins: number; losses: number; points: number; remaining: number; ceiling: number;
};

export type Row = {
  manager: string; points: number; wins: number; losses: number;
  remaining: number; ceiling: number; collisionLoss: number;
  teams: Record<string, TeamRow>;
};

/* manager is null on the undrafted side of a game, where draft falls back to
   the school name. */
export type Side = { team: string; manager: string | null; tier: Tier | null; draft: string };

export type ScoredSide = { team: string; manager: string | null };

export type Game = {
  /* The CFBD game id, which the builder has always written and nothing has
     read until now. It is also, exactly, ESPN's event id, which is what makes
     the live overlay a join on a number rather than on a school string.
     Optional because a payload written before the builder emitted it must not
     break this page - the overlay simply finds nothing for that row. */
  id?: number | string;
  date: string; away: Side; home: Side; neutral: boolean; sameManager: boolean;
  stakes: number; h2h: boolean;
  /* only present when the feed happened to be carrying a score for a game
     that had started but was not yet final */
  partial?: { home: number; away: number };
  spread: Spread | null;
};

export type Unscored = {
  key: string; week: number; seasonType: string; date: string;
  away: ScoredSide; home: ScoredSide;
  reason: "no result" | "no score" | "tied";
};

export type Result = {
  key: string; week: number; seasonType: string; date: string;
  score: string; points: number; h2h: boolean; sameManager: boolean;
  upset: boolean; line: string | null;
  winner: ScoredSide; loser: ScoredSide;
};

export type Data = {
  generatedAt: string;
  season: number;
  postseasonScheduled: boolean;
  standings: Row[];
  byWeek: { key: string; label: string; seasonType: string; week: number; games: number;
            /* total rostered games the week holds; absent in snapshots built
               before it was added, so always read it through a fallback */
            scheduled?: number;
            delta: Record<string, number>;
            /* The running totals at the end of this week. `expectedWins` and
               `expectedLosses` are the record the closing lines expected by
               then - this week's expectation plus every week before it - and
               `priced` is how many of the games behind that pair carried a
               line. All of them postdate the rest of the block, so a cached
               page has to render a payload written before they existed; the
               board checks for each pair rather than assuming the week implies
               it. `priced` travels with them because two figures side by side
               are only comparable when a reader can see whether they cover the
               same games. */
            cumulative: Record<string, { points: number; wins: number; losses: number;
                                         expectedWins?: number; expectedLosses?: number;
                                         priced?: number;
                                         /* wins over the priced games alone, which is
                                            the only thing the expectation can honestly
                                            be compared against and cannot be derived
                                            from `wins` and `priced` on the page */
                                         pricedWins?: number;
                                         /* the same pair in points: what the lines
                                            expected a manager to be paid by then, and
                                            what they banked over those same games.
                                            Newer again than the record pair, so a
                                            payload can carry one and not the other and
                                            the board checks for each separately. */
                                         expectedPoints?: number;
                                         pricedPoints?: number }> }[];
  linesFetchedAt: string | null;
  projection: {
    label: string; games: number; projected: number; unprojected: number;
    managers: Record<string, { wins: number; losses: number; points: number;
                               gained: number; rankDelta: number;
                               /* The line-weighted projection, added alongside
                                  the naive one rather than replacing it. Absent
                                  from every snapshot written before it shipped,
                                  which is a window a cached page still has to
                                  render. */
                               expectedGained?: number;
                               expectedPoints?: number }>;
  } | null;
  /* Points banked against points the closing lines expected, over settled games
     that had a line. `unpriced` is the count that had none and were left out of
     both sides of that subtraction - it is published because a luck number over
     a third of the season, presented as a season, would be worse than none.
     Optional for the same reason as results and unscored.

     Nothing on the page reads this today: the luck column came off the
     leaderboard and the expected *record* lives in byWeek, where it
     accumulates. It stays in the payload because it is the season's only
     record of the points comparison, and the run log prints it. */
  luck?: {
    games: number; unpriced: number;
    managers: Record<string, { games: number; actual: number;
                               expected: number; delta: number }>;
  } | null;
  gamesOfWeek: { label: string | null; games: Game[] };
  byConference: Record<string, {
    team: string; tier: Tier; wins: number; losses: number;
    points: number; remaining: number; manager: string | null }[]>;
  headToHead: { week: number; seasonType: string;
                date: string; score: string; sameManager: boolean; upset: boolean;
                spread: Spread | null;
                winner: { team: string; manager: string }; loser: { team: string; manager: string } }[];
  /* Absent from any payload the bot wrote before the timeline shipped, so the
     page must render without it rather than assume the bot has caught up. */
  results?: Result[];
  /* Games that will never be scored: abandoned after kickoff, or completed with
     no usable score. Optional for the same reason as results - a browser
     holding cached JS must not break on a payload written before this shipped,
     and this page must not break on one written after. */
  unscored?: Unscored[];
};
