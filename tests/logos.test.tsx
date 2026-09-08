/**
 * What a logo does on screen, which is three things and no more: it joins on
 * the exact school string, it never moves the text beside it, and it says
 * nothing to a screen reader.
 *
 * The third is the one worth stating. The logo sits beside the name it labels,
 * so a reader who is not looking at it has already been told which team this
 * is. An `alt` of "Miami" would make them hear it twice, which is why the
 * assertion below is that the attribute is present and empty rather than that
 * it is absent - a missing `alt` makes some readers announce the file name.
 */

import { render } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { TeamName, thumb } from "../app/components/TeamName";
import logos from "../data/logos.json" with { type: "json" };

const map = (logos as { teams: Record<string, { logo: string }> }).teams;

/* What the component should be asking the network for, derived the same way it
   derives it, so the join assertions below are about the school string and not
   about the URL shape. The URL shape has its own test. */
const src = (school: string) => thumb(map[school].logo);

/* The box, read from what the component actually rendered rather than restated
   here, so the two assertions this file makes about space are about the same
   number. */
const boxOf = (el: HTMLElement) => {
  const slot = el.querySelector<HTMLElement>("[data-logo]");
  if (!slot) throw new Error("nothing occupies the logo slot");
  return { width: slot.style.width, height: slot.style.height };
};

describe("the logo beside a school", () => {
  test("joins on the exact school string", () => {
    const { container } = render(<TeamName team="Miami" />);
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toBe(src("Miami"));
  });

  test("asks for the logo at the size it draws it", () => {
    /* The 500px original is a median of 36KB and a worst case of 119KB, and
       All teams puts 136 of them on one page: 5.9MB of images for a table of
       18px crests. Measured against the live CDN, not guessed. This assertion
       is the guard on that - a src that has stopped going through the resizer
       is a page that got 20x heavier without looking any different. */
    const img = render(<TeamName team="Miami" />).container.querySelector("img")!;
    expect(img.getAttribute("src")).toContain("/combiner/i?img=");
    expect(img.getAttribute("src")).toContain("w=40&h=40");
    /* Still the same underlying file, so the join is still exact. */
    expect(img.getAttribute("src")).toContain(new URL(map["Miami"].logo).pathname);
  });

  test("a URL from somewhere other than ESPN is left alone", () => {
    /* The resizer only exists on that one host. Rewriting a URL it cannot
       serve would turn a working logo into a 404, so the transform declines
       rather than assuming. */
    expect(thumb("https://example.test/x.png")).toBe("https://example.test/x.png");
  });

  test("Miami does not pick up Miami (OH)'s logo", () => {
    /* The whole reason this phase reads CFBD's own school strings instead of a
       friendlier name. A prefix match, a substring match or a normalise-then-
       compare would all hand Steve's MAC team's logo to Nathan's ACC one, or
       the reverse, and the page would look completely fine while doing it. */
    const miami = render(<TeamName team="Miami" />).container.querySelector("img");
    const redhawks = render(<TeamName team="Miami (OH)" />).container.querySelector("img");

    expect(miami!.getAttribute("src")).toBe(src("Miami"));
    expect(redhawks!.getAttribute("src")).toBe(src("Miami (OH)"));
    expect(miami!.getAttribute("src")).not.toBe(redhawks!.getAttribute("src"));
  });

  test("is fixed in both dimensions so a slow one shifts nothing", () => {
    const { container } = render(<TeamName team="Iowa" />);
    const img = container.querySelector("img")!;
    /* Both the attributes, which reserve the box before any CSS arrives, and
       the style, which holds it whatever the file's intrinsic size turns out
       to be. Either alone leaves a window in which the row moves. */
    expect(img.getAttribute("width")).toBe(img.getAttribute("height"));
    expect(Number(img.getAttribute("width"))).toBeGreaterThanOrEqual(18);
    expect(Number(img.getAttribute("width"))).toBeLessThanOrEqual(20);
    expect(img.style.width).toBe(img.style.height);
    expect(img.style.width).not.toBe("");
  });

  test("loads lazily", () => {
    const img = render(<TeamName team="Iowa" />).container.querySelector("img")!;
    expect(img.getAttribute("loading")).toBe("lazy");
  });

  test("says nothing a screen reader has not already been told", () => {
    const img = render(<TeamName team="Iowa" />).container.querySelector("img")!;
    expect(img.hasAttribute("alt")).toBe(true);
    expect(img.getAttribute("alt")).toBe("");
  });

  test("a school with no entry renders nothing, and reserves the same space", () => {
    /* Not a broken-image glyph and not a jumped-left row: no <img> at all, and
       a slot of identical size where it would have gone, so a table of names
       stays in one column the day CFBD adds a school. */
    const known = render(<TeamName team="Iowa" />);
    const unknown = render(<TeamName team="Not A Real School" />);

    expect(unknown.container.querySelector("img")).toBeNull();
    expect(boxOf(unknown.container as unknown as HTMLElement)).toEqual(
      boxOf(known.container as unknown as HTMLElement)
    );
  });

  test("still renders the name, with and without a class to hang on it", () => {
    /* The logo is an addition to this component, not a replacement for it.
       Games of the week colours the favourite through `className`, and the
       other callers pass none; both still have to end up with the words. */
    const plain = render(<TeamName team="Iowa" />);
    expect(plain.container.textContent).toBe("Iowa");

    const classed = render(<TeamName team="Iowa" label="Iowa Hawkeyes" className="fav" />);
    expect(classed.container.textContent).toBe("Iowa Hawkeyes");
    expect(classed.container.querySelector(".fav")).not.toBeNull();
  });
});
