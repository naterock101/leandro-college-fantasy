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
 * The two halves are fed from different files. The race chart reads `byWeek`
 * out of the always-fetched core, so it draws immediately; the matrix reads
 * `headToHead` out of `results.json`, which is fetched when this tab is first
 * opened. So the tab is deliberately half-loaded for a moment, and `note`
 * carries the page's word for why.
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
      <p className="asof">
        Points after each week, cumulative. Names sit at the end of their own
        line; the number beside each is that manager&rsquo;s total.
      </p>

      <TrendsChart byWeek={data.byWeek} managers={managers} />

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
