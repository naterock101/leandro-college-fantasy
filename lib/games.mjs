/**
 * Everything that reads a CFBD /games object, in one place.
 *
 * Plain ESM with JSDoc types rather than TypeScript: `allowJs` is on, so
 * `app/page.tsx` and `scripts/*.mjs` both import this file directly with no
 * build step and no second toolchain. The point of the shared module is that
 * the page and the builder cannot drift apart on what a game *is* - that
 * drift is the dead-week bug, where the page already knew a game abandoned
 * eight hours ago was not live and the builder did not.
 *
 * @typedef {Record<string, any>} Game  a raw CFBD game, either field convention
 */

/* ------------------------------------------------------------------ */
/* field access: v2 is camelCase, snake_case kept as a fallback        */
/* ------------------------------------------------------------------ */

/** @type {(g: Game, ...names: string[]) => any} */
export const pick = (g, ...names) => {
  for (const n of names) if (g[n] !== undefined && g[n] !== null) return g[n];
  return undefined;
};
export const home = (/** @type {Game} */ g) => pick(g, "homeTeam", "home_team");
export const away = (/** @type {Game} */ g) => pick(g, "awayTeam", "away_team");
export const homePts = (/** @type {Game} */ g) => pick(g, "homePoints", "home_points");
export const awayPts = (/** @type {Game} */ g) => pick(g, "awayPoints", "away_points");
export const homeConf = (/** @type {Game} */ g) => pick(g, "homeConference", "home_conference");
export const awayConf = (/** @type {Game} */ g) => pick(g, "awayConference", "away_conference");
export const startDate = (/** @type {Game} */ g) => pick(g, "startDate", "start_date");
export const seasonType = (/** @type {Game} */ g) => pick(g, "seasonType", "season_type") ?? "regular";
export const weekOf = (/** @type {Game} */ g) => pick(g, "week") ?? 0;
export const isDone = (/** @type {Game} */ g) => pick(g, "completed") === true;
export const isPost = (/** @type {Game} */ g) => seasonType(g) === "postseason";
export const sortKey = (/** @type {Game} */ g) =>
  `${isPost(g) ? 1 : 0}|${String(weekOf(g)).padStart(2, "0")}`;

/* ------------------------------------------------------------------ */
/* state                                                               */
/* ------------------------------------------------------------------ */

/* Nothing in college football runs past five and a half hours, so a game that
   kicked off longer ago than this has finished whatever the payload still
   says. Shared with the page so "live" means one thing in this repo. */
export const LIVE_WINDOW_MS = 5.5 * 60 * 60 * 1000;

/**
 * What state a game is in, from the feed and the wall clock alone.
 *
 * CFBD's /games carries no clock, period or status, so everything below is
 * inferred. `stalled` is the state that does not exist upstream and has to:
 * a game cancelled for weather, abandoned, or lost to a feed error is never
 * marked complete, and without this it stays "upcoming" for the rest of the
 * season - pinning games of the week, freezing the projection and inflating
 * every ceiling by a game that will never be played.
 *
 * A completed game with no score, or with equal scores, is `unusable` rather
 * than final. The league has no half wins, so a tie is not a result; and a
 * missing score is a feed defect that must be visible rather than skipped.
 *
 * @param {Game} g
 * @param {number} now  epoch ms
 * @returns {"scheduled" | "live" | "stalled" | "final" | "unusable"}
 */
export function classify(g, now) {
  if (isDone(g)) {
    const hp = homePts(g), ap = awayPts(g);
    if (typeof hp !== "number" || typeof ap !== "number" || hp === ap) return "unusable";
    return "final";
  }
  const kick = Date.parse(String(startDate(g)));
  /* No usable kickoff time means we cannot claim the game started. Calling it
     stalled on a malformed date would drop it from remaining and quietly cut
     a manager's ceiling, which is the wrong way to be wrong. */
  if (!Number.isFinite(kick) || kick > now) return "scheduled";
  return now - kick < LIVE_WINDOW_MS ? "live" : "stalled";
}
