/**
 * Crops the eight character renders down to the head icons the race chart
 * draws, and writes them into public/karts/.
 *
 * Run by hand, never by the Action and never by the build. The inputs are
 * one-off files that arrived once and will not change; what ships is the
 * output, which is committed. This exists so the crop boxes are a record
 * rather than an afternoon somebody spent squinting - re-cropping one
 * character is a number in the table below, not the whole exercise again.
 *
 *   npm run karts
 *
 * **macOS only.** It shells out to `sips`, which is in the base system, and
 * that is deliberate: the alternative is a runtime image dependency in a repo
 * whose first ground rule is that there are none, to run a script that is
 * invoked about once a season. If this ever has to run elsewhere, the honest
 * fix is to commit the outputs (they already are) and port the script when
 * somebody actually needs it.
 *
 * The sources live in assets/karts/ and are gitignored: 12MB of full-size
 * render for 92KB of icon, and anything under public/ is deployed. Without
 * them this script cannot run, and nothing else notices.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "assets/karts");
const OUT = join(ROOT, "public/karts");

/**
 * A square crop, in the source image's own pixels, framing the character's
 * head - and only the head. A whole Mario Kart render at 26px is a smudge:
 * the thing that has to survive being that small is the face, so the body is
 * cropped away here rather than scaled into mush by the browser.
 *
 * `x`/`y` are the top-left corner and `size` is both sides. Each was read off
 * the source with a 10% grid ruled over it, then checked at 22, 34 and 64px
 * against the page's own ink - which is the size that matters and the reason
 * none of these are simply "the top third of the image".
 *
 * @type {Record<string, {x: number, y: number, size: number}>}
 */
export const CROPS = {
  yoshi: { x: 625, y: 0, size: 470 },
  toad: { x: 56, y: 23, size: 808 },
  mario: { x: 445, y: 75, size: 790 },
  luigi: { x: 1009, y: 0, size: 1360 },
  peach: { x: 313, y: 0, size: 750 },
  wario: { x: 950, y: 0, size: 1150 },
  /* shifted right of his own raised claw, which sits directly under the head
     and at 26px reads as a beige brick rather than as an arm */
  bowser: { x: 618, y: 0, size: 245 },
  "donkey-kong": { x: 925, y: 308, size: 590 },
};

/* Drawn at 26 units in a chart that is never rendered above 1:1, so 72 covers
   a 2.7x display and there is no fourth size worth carrying. The eight come to
   92KB, and they are fetched only when the Trends tab is opened - the
   leaderboard costs nothing for them. */
const PX = 72;

if (!existsSync(SRC)) {
  console.error(`no ${SRC}. The full-size renders are gitignored; put them back
before re-cropping. public/karts/ is committed and needs nothing to serve.`);
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });

const sips = (...args) => execFileSync("sips", args, { stdio: ["ignore", "ignore", "pipe"] });

let n = 0;
for (const [name, { x, y, size }] of Object.entries(CROPS)) {
  const from = join(SRC, `${name}.png`);
  if (!existsSync(from)) {
    console.error(`missing source: ${from}`);
    process.exit(1);
  }
  const to = join(OUT, `${name}.png`);
  /* --cropOffset is (y, x) from the top left, which is the one thing about
     this tool worth writing down: every other crop flag it has is centred. */
  sips("-c", String(size), String(size), "--cropOffset", String(y), String(x), from, "--out", to);
  sips("-z", String(PX), String(PX), to);
  n++;
}

/* Every driver in the component has to have a file, and every file has to have
   a driver. A missing icon is an empty square at the head of somebody's line,
   which is the kind of thing that ships. */
const written = new Set(readdirSync(OUT).filter((f) => f.endsWith(".png")));
const expected = new Set(Object.keys(CROPS).map((k) => `${k}.png`));
for (const f of written) {
  if (!expected.has(f)) console.warn(`public/karts/${f} has no entry in CROPS`);
}

console.log(`wrote ${n} icons at ${PX}px into public/karts/`);
console.log(`check them against app/components/Karts.tsx: every driver there names one of these`);
