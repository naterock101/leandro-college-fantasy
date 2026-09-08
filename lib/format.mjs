/**
 * Presentation helpers with no React in them.
 *
 * They live here rather than in the page so the same string appears whether it
 * was produced by a component, a script or a test. Anything that returns JSX
 * stays in the component that owns it.
 */

/** @type {(s: string) => string} */
export const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * "8/9", or just "8" when the snapshot predates the scheduled field.
 * Defaulting the denominator to the played count would read as a finished
 * week, so a missing total drops the fraction rather than inventing one.
 *
 * @param {number} played
 * @param {number} [total]
 */
export const tally = (played, total) =>
  typeof total === "number" ? `${played}/${total}` : `${played}`;

/**
 * Folds accents and punctuation so "san jose st" finds "San Jose State" and
 * "texas am" finds "Texas A&M".
 *
 * @param {string} s
 */
export const norm = (s) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** @param {string} [d] */
export const shortDate = (d) =>
  d ? new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";

/* a game in flight started today, so the clock is the useful part, not the date */
/** @param {string} d */
export const kickoff = (d) =>
  new Date(d).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

/** @param {string} d */
export const shortTime = (d) =>
  new Date(d).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
