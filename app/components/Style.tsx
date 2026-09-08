import { base } from "../styles";
import { css as tabs } from "./Tabs";
import { css as dropdown } from "./Dropdown";
import { css as leaderboard } from "./Leaderboard";
import { css as live } from "./LiveGames";
import { css as gamesOfWeek } from "./GamesOfWeek";
import { css as unscored } from "./Unscored";
import { css as allTeams } from "./AllTeams";
import { css as activity } from "./Activity";

/**
 * One `<style>` element, assembled from the tokens and each component's own
 * rules.
 *
 * The order below is the cascade, so it is not alphabetical and not arbitrary.
 * `base` first, because everything else narrows something it declares. Then
 * the sections in the order they appear down the page, which is also the order
 * that keeps the few same-specificity pairs resolving the way they did when
 * this was one string: the leaderboard's narrow-screen `.pts` override has to
 * land before All teams' `.sm2`, and both have to land after `base`'s `.pts`.
 *
 * Adding a component means adding a line here. That is the one shared edit the
 * split does not remove, and it is a one-line append rather than a hunk in the
 * middle of two hundred lines of somebody else's CSS.
 */
export const sheet = [
  base,
  tabs,
  dropdown,
  leaderboard,
  live,
  gamesOfWeek,
  unscored,
  allTeams,
  activity,
].join("");

export function Style() {
  return <style>{sheet}</style>;
}
