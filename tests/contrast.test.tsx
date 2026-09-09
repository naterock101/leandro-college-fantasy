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

import { KARTS } from "../app/components/Karts";
import { EXP_STEPS, expStep } from "../app/components/Leaderboard";
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

describe("the drivers' colours", () => {
  /* Not decoration. Each manager's name in the race chart's gutter is painted
     in their driver's colour, and a name is text - so these have to clear the
     same bar the tokens do, on both grounds. The chart is the one place on
     this page where a colour arrives from a table of characters rather than
     from the palette, which is exactly why it is audited here with them. */
  for (const [manager, kart] of Object.entries(KARTS)) {
    test(`${kart.driver} reads on both grounds`, () => {
      expect(contrast(hex(kart.color), ink), `${manager} on --ink`).toBeGreaterThanOrEqual(AA);
      expect(contrast(hex(kart.color), panel), `${manager} on --panel`).toBeGreaterThanOrEqual(AA);
    });
  }

  test("no two drivers share a colour", () => {
    const seen = new Map<string, string>();
    for (const [manager, kart] of Object.entries(KARTS)) {
      const clash = seen.get(kart.color.toUpperCase());
      expect(clash, `${manager} and ${clash} are both ${kart.color}`).toBeUndefined();
      seen.set(kart.color.toUpperCase(), manager);
    }
  });

  /* Viénot, Brettel & Mollon (1999), applied to linearised sRGB: the standard
     cheap simulation of dichromatic vision, and enough for the only question
     asked of it here - do these two colours collapse into each other. */
  const simulate = (m: number[][]) => (c: RGB) => {
    const [r, g, b] = c.map(channel);
    const out = m.map(([x, y, z]) => x * r + y * g + z * b);
    return 0.2126 * out[0] + 0.7152 * out[1] + 0.0722 * out[2];
  };
  const CVD = {
    protanopia: simulate([[0.567, 0.433, 0], [0.558, 0.442, 0], [0, 0.242, 0.758]]),
    deuteranopia: simulate([[0.625, 0.375, 0], [0.7, 0.3, 0], [0, 0.3, 0.7]]),
    tritanopia: simulate([[0.95, 0.05, 0], [0, 0.433, 0.567], [0, 0.475, 0.525]]),
  };
  /* Two colours a dichromat sees at less than this contrast with each other
     are, for the purpose of telling two lines apart at two units wide, one
     colour. */
  const MERGED = 1.5;

  test("every driver has a stroke and marker combination of their own", () => {
    /* The property that makes the assertion below hold whatever anyone later
       does to the palette: two dashes and four markers is exactly eight
       combinations and the league is exactly eight, so no two series are ever
       separated by colour alone. */
    const combos = Object.values(KARTS).map((k) => `${k.dash} / ${k.marker}`);
    expect(new Set(combos).size, `${combos.join(", ")}`).toBe(combos.length);
  });

  test("no pair a dichromat sees as one colour is left relying on colour", () => {
    /* And the same thing measured from the other end, so a ninth manager or a
       recoloured driver fails here rather than in front of a reader who cannot
       tell Bowser's line from Mario's. Most of this palette does collapse -
       eleven of the twenty-eight pairs, under protanopia - which is the point:
       eight character-faithful colours cannot be made distinguishable, so they
       are not asked to be. */
    const entries = Object.entries(KARTS);
    let merged = 0;
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const [a, ka] = entries[i];
        const [b, kb] = entries[j];
        for (const [kind, see] of Object.entries(CVD)) {
          const ratio = (() => {
            const [hi, lo] = [see(hex(ka.color)), see(hex(kb.color))].sort((x, y) => y - x);
            return (hi + 0.05) / (lo + 0.05);
          })();
          if (ratio >= MERGED) continue;
          merged++;
          expect(
            ka.dash !== kb.dash || ka.marker !== kb.marker,
            `under ${kind} ${a} and ${b} are one colour (${ratio.toFixed(2)}:1) ` +
              `and share ${ka.dash} / ${ka.marker}`
          ).toBe(true);
        }
      }
    }
    expect(merged, "no pair collapsed at all, so this test measured nothing")
      .toBeGreaterThan(0);
  });
});

describe("the expected-record gradient", () => {
  /* Six shades that exist only in one component's own sheet, and every one of
     them is a number a reader has to be able to read. They are audited here
     with the tokens rather than trusted, which is also why they are a table of
     hex values the component both styles from and picks classes from - a blend
     computed at render time would be invisible to this file. */
  for (const side of ["hot", "cold"] as const) {
    EXP_STEPS[side].forEach((colour, i) => {
      test(`${side} step ${i + 1} reads on both grounds`, () => {
        expect(contrast(hex(colour), ink), `${colour} on --ink`).toBeGreaterThanOrEqual(AA);
        expect(contrast(hex(colour), panel), `${colour} on --panel`).toBeGreaterThanOrEqual(AA);
      });
    });
  }

  test("the steps actually separate, and run toward the token", () => {
    /* A gradient whose steps a reader cannot tell apart is a flat colour with
       extra classes. Each step has to move measurably further from the colour
       of an ordinary cell than the one before it. */
    const chalk = token("chalk");
    for (const side of ["hot", "cold"] as const) {
      let prev = 1;
      for (const colour of EXP_STEPS[side]) {
        const away = contrast(hex(colour), chalk);
        expect(away, `${side}: ${colour} is no further from an unshaded cell than the step before`)
          .toBeGreaterThan(prev);
        prev = away;
      }
      /* and the last step is the token itself, not a near miss */
      const end = side === "hot" ? token("teal") : token("red");
      expect(hex(EXP_STEPS[side][EXP_STEPS[side].length - 1])).toEqual(end);
    }
  });

  test("a row near expectation is not painted at all", () => {
    /* The whole point of the gradient. Most rows sit near the line most of the
       time, and a column that shouts at all of them says nothing. */
    expect(expStep(0)).toBe(0);
    expect(expStep(0.2)).toBe(0);
    expect(expStep(-0.2)).toBe(0);
    expect(expStep(0.3)).toBe(1);
    expect(expStep(-1)).toBe(2);
    expect(expStep(2.5)).toBe(3);
    /* symmetric: being two wins hot is as loud as being two wins cold */
    for (const gap of [0.1, 0.4, 0.9, 1.7, 4]) {
      expect(expStep(gap)).toBe(expStep(-gap));
    }
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
