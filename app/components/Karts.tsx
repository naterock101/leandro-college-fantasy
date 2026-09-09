/**
 * One driver per manager, for the race chart.
 *
 * The chart used to separate eight series with four colours used twice over,
 * telling each pair apart by stroke pattern and marker shape. That worked and
 * read as a chart. This reads as a race: every manager has a face at the head
 * of their line, and the line is drawn in a colour taken out of that face.
 *
 * Three things worth knowing:
 *
 * - **The colours are sampled, not remembered.** Each one is a colour that
 *   actually occurs in its own icon, picked off a histogram of the file rather
 *   than from an idea of what Wario looks like, then pushed to whatever
 *   lightness clears 4.5:1 on both page grounds - because the manager's name
 *   at the end of the line is painted in it, and a name is text.
 * - **Characters are not an excuse to drop the accessibility work.** Eight
 *   distinguishable hues do not exist on a dark ground for a deuteranope, and
 *   giving every manager their own face does not change that - it only moves
 *   the problem. Simulate protanopia over this palette and eleven of the
 *   twenty-eight pairs come back under 1.3:1 with each other; the best
 *   possible pairing of eight character-faithful colours still leaves one at
 *   1.42:1. So both colour-free channels survive: every driver carries a
 *   `dash` and a `marker`, and the eight combinations of the two are all
 *   different, which tests/contrast.test.tsx checks rather than trusts.
 * - **This is not the source of truth for who is in the league.** A manager
 *   with no entry gets the old token-and-dash treatment from the chart. The
 *   draft changes and the roster file is where that is recorded; an unknown
 *   name should cost a plain line, not a crash and not a blank square.
 *
 * The art is eight PNGs under public/karts/, cropped to heads by
 * scripts/build-karts.mjs and 92KB in total. They are fetched only when the
 * Trends tab is opened, so the leaderboard pays nothing for them. Inline SVG
 * was the first attempt and is not what shipped: a drawn Mario is a drawn
 * Mario, and these are the renders the league recognises.
 *
 * Internal use. These are Nintendo's characters on a private league page that
 * is not sold, not advertised against, and not offered to anyone outside it.
 */

/** The four silhouettes the chart draws at each week's point. */
export type Marker = "circle" | "square" | "diamond" | "triangle";

export type Kart = {
  /** the character, and the alt text nothing reads - see KartIcon */
  driver: string;
  /** the file under public/karts/, without the extension */
  file: string;
  /** sampled from that file, and what the manager's line is drawn in */
  color: string;
  /** an SVG stroke-dasharray, or "none" */
  dash: string;
  marker: Marker;
};

/**
 * The grid, keyed by the manager id in the roster file.
 *
 * Two dashes times four markers is exactly eight combinations and the league
 * is exactly eight, so every driver has one to themselves - which is the
 * property worth having, because it holds whatever the colours later become.
 * The assignment puts a different marker on each member of the warm cluster
 * the simulation collapses (Mario, Wario, Peach, Bowser, DK) and a different
 * dash on the pairs left sharing one - Yoshi against Luigi, both of whom are
 * simply green and always will be.
 */
export const KARTS: Record<string, Kart> = {
  /* his own highlight green rather than his body green: the body reads 3.77:1
     on the ink, which is under the floor for the name that carries it */
  leandro: { driver: "Yoshi", file: "yoshi", color: "#3ADD63", dash: "6 4", marker: "circle" },
  /* the cap, which is the most common colour in the icon and the one thing
     nobody else on the grid is */
  nathan: { driver: "Toad", file: "toad", color: "#E4E4E4", dash: "6 4", marker: "square" },
  adam: { driver: "Mario", file: "mario", color: "#F5564A", dash: "none", marker: "circle" },
  devish: { driver: "Luigi", file: "luigi", color: "#17A82B", dash: "none", marker: "triangle" },
  /* the dress, not the hair: the hair is the larger share of the icon and it
     is Wario's yellow to within a few points */
  clint: { driver: "Peach", file: "peach", color: "#FC9CCC", dash: "none", marker: "diamond" },
  charlie: { driver: "Wario", file: "wario", color: "#FCCC0C", dash: "none", marker: "square" },
  steve: { driver: "Bowser", file: "bowser", color: "#E8A33C", dash: "6 4", marker: "diamond" },
  tconn: { driver: "Donkey Kong", file: "donkey-kong", color: "#B48454", dash: "6 4", marker: "triangle" },
};

/**
 * One driver, centred on a point in the chart's coordinate system.
 *
 * No `alt` and nothing in the accessibility tree, on purpose: the whole svg is
 * `aria-hidden` and the hidden table below it is what a screen reader reads.
 * A face announcing "Yoshi" from inside a hidden drawing would be the only
 * part of the chart that speaks, and it would say the least useful thing in it.
 */
export function KartIcon({
  kart,
  x,
  y,
  size,
}: {
  kart: Kart;
  x: number;
  y: number;
  size: number;
}) {
  return (
    <image
      href={`/karts/${kart.file}.png`}
      x={x - size / 2}
      y={y - size / 2}
      width={size}
      height={size}
      /* The crops are square and the art is centred in them, so this only
         matters if a future crop is not - in which case a letterboxed face is
         a better failure than a stretched one. */
      preserveAspectRatio="xMidYMid meet"
    />
  );
}
