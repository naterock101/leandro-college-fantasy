import { cap } from "../../lib/format.mjs";
import type { ScoredSide } from "../types";

/**
 * The single place a school is turned into something on screen.
 *
 * Before the split there were three of these, one inlined into each block
 * that renders a game, and they had already drifted: one wrapped the school in
 * a span so the favourite could be coloured and two did not. Anything that
 * wants to change how a team is drawn - a logo, a rank, a colour - now has one
 * file to change, and every block gets it.
 *
 * `team` is the canonical CFBD school string and is what anything keyed on a
 * team should join on; `label` is what the reader sees, which for a drafted
 * team is the roster's own wording ("Arizona State Sun Devils") rather than
 * the school. They are different strings and the difference matters: the
 * spread names a favourite by `team`, and the leaderboard names a pick by
 * `label`.
 */
export function TeamName({
  team,
  label,
  className,
}: {
  team: string;
  label?: string;
  className?: string;
}) {
  const text = label ?? team;
  /* Games of the week needs a class on the school itself, to colour the
     favourite and the dog. The other callers have nothing to hang there, and
     wrapping them in an empty span for symmetry would be markup that exists
     to please the abstraction rather than the page. */
  return className === undefined ? <>{text}</> : <span className={className}>{text}</span>;
}

/**
 * "Adam's Buffalo", or the bare school when nobody drafted it. Undrafted sides
 * are the common case in the timeline, so they are labelled rather than left
 * sitting next to an owned team looking like missing data.
 */
export function Owned({ side }: { side: ScoredSide }) {
  return side.manager ? (
    <>
      <b>{cap(side.manager)}</b>&rsquo;s <TeamName team={side.team} />
    </>
  ) : (
    <>
      <TeamName team={side.team} />
      <span className="undr"> undrafted</span>
    </>
  );
}
