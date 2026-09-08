/**
 * The contrast audit, computed rather than eyeballed.
 *
 * The plan guessed that `--muted` failed on `--ink` and would need lightening.
 * It did not: 5.54:1, comfortably over the 4.5:1 that WCAG AA asks of text
 * this size. What failed was everything the page then stacked `opacity` on top
 * of it - a caption at .85 is 4.34:1, an "undrafted" marker at .65 is 3.05:1,
 * a dimmed points badge at .55 is 2.53:1 - and none of that is visible from
 * the token, which is exactly why it is worth a test rather than a look.
 *
 * So the rule this file enforces is not "the token passes" but "every colour
 * a reader actually sees passes", opacity composited in. That is what makes it
 * a guard for the four agents about to add sections: a new caption with a new
 * `opacity` on it fails here rather than in front of the league.
 *
 * This is a vitest file rather than a `node --test` one only because it reads
 * the same stylesheet the components export.
 */

import { describe, expect, test } from "vitest";

import { sheet } from "../app/components/Style";
import { base } from "../app/styles";

type RGB = [number, number, number];

const hex = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;

/* WCAG 2.1, relative luminance and contrast ratio, verbatim. */
const channel = (c: number) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const luminance = ([r, g, b]: RGB) =>
  0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
export const contrast = (a: RGB, b: RGB) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
/* What the eye receives when a colour is drawn at less than full opacity: the
   ground shows through, and the result is what has to pass. */
const over = (fg: RGB, bg: RGB, alpha: number): RGB =>
  fg.map((c, i) => c * alpha + bg[i] * (1 - alpha)) as RGB;

/* Read the tokens out of the stylesheet rather than restating them, so
   changing one is what this test is measuring. */
const token = (name: string) => {
  const m = base.match(new RegExp(`--${name}:(#[0-9A-Fa-f]{6})`));
  if (!m) throw new Error(`no --${name} in the tokens`);
  return hex(m[1]);
};

const ink = token("ink");
const panel = token("panel");

/* AA for text under 18.66px bold / 24px normal, which is everything on this
   page - the captions it is really about are 9 to 11px. */
const AA = 4.5;

describe("text contrast", () => {
  for (const name of ["chalk", "muted", "dim", "amber", "teal", "red"]) {
    test(`--${name} reads on both grounds`, () => {
      expect(contrast(token(name), ink), `--${name} on --ink`).toBeGreaterThanOrEqual(AA);
      expect(contrast(token(name), panel), `--${name} on --panel`).toBeGreaterThanOrEqual(AA);
    });
  }

  test("the hierarchy still exists", () => {
    /* Passing is not the only requirement. Three greys that all pass and are
       indistinguishable would lose the thing the dimming was for, so the
       order is asserted too. */
    expect(contrast(token("chalk"), ink)).toBeGreaterThan(contrast(token("muted"), ink));
    expect(contrast(token("muted"), ink)).toBeGreaterThan(contrast(token("dim"), ink));
  });
});

describe("no rule dims text below the floor", () => {
  /* The failure mode this file exists for. `opacity` on a text rule is
     invisible from the palette and lands on top of whatever colour the rule
     already had, so the audit has to be of the stylesheet and not of the
     tokens. */
  test("nothing anywhere in the stylesheet carries a text opacity", () => {
    /* Keyframes are exempt, and only keyframes: the live dot fades in and out
       and is now marked aria-hidden with the words alongside it, so it is
       decoration and has nothing to be legible about. */
    const rules = sheet
      .replace(/@keyframes[^{]*\{[\s\S]*?\}\s*\}/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    const dimmed = [...rules.matchAll(/([^{}]+)\{([^}]*opacity:\s*([0-9.]+)[^}]*)\}/g)]
      .filter(([, , , alpha]) => Number(alpha) < 1)
      .map(([, selector]) => selector.replace(/\s+/g, " ").trim());
    expect(dimmed, "use --dim rather than opacity; opacity is not auditable").toEqual([]);
  });

  test("and the worst case if one came back would be caught", () => {
    /* The old `.stakes.them`: muted at .55 over the ink. Kept as a live
       demonstration that the maths above finds the thing the eye let past. */
    expect(contrast(over(hex("#7E8FA3"), ink, 0.55), ink)).toBeLessThan(AA);
  });
});
