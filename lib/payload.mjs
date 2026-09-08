/**
 * How the payload is cut up for the wire, and put back together in the page.
 *
 * One file was refetched whole by every open tab every two minutes. Three of
 * its keys are ~70% of the bytes and none of them is on screen when the page
 * opens: `results` and `headToHead` belong to the Activity tab, `byConference`
 * to All teams. Splitting them out takes the always-fetched core from 92KB to
 * 27KB raw (7.1KB to 3.1KB gzipped) on the live season, and takes the growth
 * term - `results`, at ~64 entries a week - off the polling path entirely.
 *
 * Both directions live here rather than in the builder and the page separately,
 * because the two have to agree about which key is in which file, and the
 * consequence of them disagreeing is a section of the site that is silently
 * empty rather than an error anyone would see.
 */

/* Keyed by file, so the partition is defined by what is *lazy* and everything
   else falls to the core by default. That default is the safe direction: a key
   a later phase adds and forgets to classify costs a few bytes on every poll,
   where a key that belongs to no file at all is a section that disappears with
   nothing to notice it. */
export const LAZY = {
  results: ["results", "headToHead"],
  teams: ["byConference"],
};

/** The keys the builder writes into the always-fetched file, in payload order. */
export const CORE = [
  "generatedAt", "season", "scoring", "postseasonScheduled", "linesFetchedAt",
  "standings", "projection", "byWeek", "gamesOfWeek", "unscored",
];

const lazyOwner = new Map(
  Object.entries(LAZY).flatMap(([file, keys]) => keys.map((k) => [k, file]))
);

/**
 * Cuts a built payload into the files that get written.
 *
 * A key absent from the payload stays absent from its file: a snapshot built
 * before `results` existed has no `results`, and inventing an empty one would
 * turn "not written yet" into "nothing happened", which the page renders as
 * two different sentences on purpose.
 *
 * @param {Record<string, any>} full
 * @returns {{ core: Record<string, any>, results: Record<string, any>, teams: Record<string, any> }}
 */
export function splitPayload(full) {
  /** @type {Record<string, Record<string, any>>} */
  const out = { core: {} };
  for (const file of Object.keys(LAZY)) out[file] = {};
  for (const [k, v] of Object.entries(full)) out[lazyOwner.get(k) ?? "core"][k] = v;
  return /** @type {any} */ (out);
}

/**
 * Puts the core and whatever lazy files have arrived back into one object.
 *
 * Every lazy section comes back as an empty collection when its file is
 * missing, still in flight, or 404ing - which is the whole cutover window,
 * before the `data` branch has its first commit. `undefined` is what throws a
 * render; `[]` and `{}` are what draw an empty state. Stating that once here
 * is what keeps six read sites in the page from each needing their own guard
 * and one of them eventually not having it.
 *
 * A part that parsed to something other than an object is dropped rather than
 * spread: raw.githubusercontent answers a missing file with a `404: Not Found`
 * body, and a `.json()` that somehow succeeded on one must not reach the page.
 *
 * @param {Record<string, any>} core
 * @param {Record<string, any>} parts  by file name, each the parsed file or nothing
 */
export function mergePayload(core, parts) {
  const out = { results: [], headToHead: [], byConference: {}, ...core };
  for (const file of Object.keys(LAZY)) {
    const part = parts?.[file];
    if (!part || typeof part !== "object" || Array.isArray(part)) continue;
    for (const k of LAZY[file]) if (part[k] !== undefined) out[k] = part[k];
  }
  return out;
}
