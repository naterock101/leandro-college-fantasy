import { useMemo } from "react";

import { TrendsChart, css as chart } from "./TrendsChart";
import { TrendsMatrix, css as matrix } from "./TrendsMatrix";
import type { Data } from "../types";

/**
 * The shape of the season, in two pictures.
 *
 * A fourth tab rather than two more blocks on the leaderboard, which is the
 * only reason this is a tab at all: the leaderboard answers "who is winning",
 * and these answer "how did it get like this" and "who beats whom" - questions
 * a reader asks occasionally and not on every visit.
 *
 * Both halves are fed from `results.json`, which is fetched when this tab is
 * first opened - the matrix needs `headToHead` and the race now draws game by
 * game rather than week by week. The race still opens on something either way:
 * it falls back to the week-by-week shape out of the always-fetched core and
 * refines when the file lands, so the tab is deliberately half-loaded for a
 * moment and `note` carries the page's word for why.
 *
 * `note` is not passed to the chart. A half-loaded race is a coarser race, not
 * an empty one, and an apology over a chart that is already drawing would be
 * explaining a state the reader cannot see.
 */
export function Trends({ data, note }: { data: Data; note: string | null }) {
  /* Alphabetical, and the same order in both halves. Deliberately not
     standings order: a colour that moves down the chart's key every time
     somebody wins on a Saturday makes the chart unreadable across two visits,
     and a matrix whose rows reorder weekly cannot be compared to a screenshot
     of last week's. */
  const managers = useMemo(
    () => data.standings.map((r) => r.manager).slice().sort(),
    [data]
  );

  const scored = data.byWeek.length;

  return (
    <>
      <h2>
        The race
        <span className="cw">
          {scored} week{scored === 1 ? "" : "s"} scored
        </span>
      </h2>
      {/* The caption moved into the chart, because it now has to say which of
          the three things the chart is measuring - and that is the chart's
          state, not this component's. */}
      <TrendsChart byWeek={data.byWeek} managers={managers} results={data.results} />

      <h2>
        Head to head
        <span className="cw">the tiebreaker</span>
      </h2>
      <p className="asof">
        Every game with a drafted team on both sides, as a record. Read a row
        against a column: the cell is that row&rsquo;s wins first. The diagonal
        is own goals &ndash; a manager&rsquo;s own two teams playing each other.
      </p>

      <TrendsMatrix games={data.headToHead} managers={managers} note={note} />
    </>
  );
}

export const css = chart + matrix;
