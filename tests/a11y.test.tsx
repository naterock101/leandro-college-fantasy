/**
 * The keyboard, which is the part nobody exercises by accident.
 *
 * Every case here was reachable with a mouse and unreachable without one, or
 * reachable but with no way back out. They are asserted as behaviour - focus
 * moved here, this expanded, that closed - rather than as attributes, because
 * the attribute is the means and the reader getting somewhere is the end.
 */

import { describe, expect, test } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";

import { TABS } from "../app/components/Tabs";
import { renderPage, stubFetch } from "./helpers";

const tabs = () => screen.getByRole("tablist");
const tab = (name: string) => within(tabs()).getByRole("tab", { name });
/* Read off the list rather than named, so adding a fifth tab is one line in
   components/Tabs and not a hunt through this file for whichever assertion
   happened to be about the end of the strip. */
const first = () => tab(TABS[0].label);
const last = () => tab(TABS[TABS.length - 1].label);

describe("the leaderboard row", () => {
  /* It was a <tr onClick> with no tabIndex, no role and no key handler, so the
     team detail - ten teams, their conferences, their records - could not be
     opened at all without a pointer. */
  test("opens with the keyboard and says what it controls", async () => {
    stubFetch();
    await renderPage();

    const toggle = screen.getByRole("button", { name: /Devish/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    toggle.focus();
    expect(document.activeElement).toBe(toggle);
    fireEvent.click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const detail = document.getElementById(toggle.getAttribute("aria-controls")!);
    expect(detail, "aria-controls must point at the row it opens").not.toBeNull();
    expect(detail!.textContent).toContain("Clemson Tigers");
  });

  test("closes again on a second press", async () => {
    stubFetch();
    await renderPage();
    const toggle = screen.getByRole("button", { name: /Devish/ });
    fireEvent.click(toggle);
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });
});

describe("a dropdown", () => {
  /* It had aria-expanded and nothing else: no way to dismiss it from the
     keyboard, and no way back to the control that opened it. */
  const open = () => screen.getByRole("button", { name: /Head to head only/ });

  test("closes on Escape and puts focus back on its trigger", async () => {
    stubFetch();
    await renderPage();
    const trigger = open();
    trigger.focus();
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    /* From inside the menu, which is where focus actually is by the time
       anyone wants to escape it. */
    const first = screen.getAllByRole("checkbox")[1];
    first.focus();
    fireEvent.keyDown(first, { key: "Escape" });

    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement, "focus must come back to the trigger").toBe(trigger);
  });

  test("names the menu it controls", async () => {
    stubFetch();
    await renderPage();
    const trigger = open();
    fireEvent.click(trigger);
    const menu = document.getElementById(trigger.getAttribute("aria-controls")!);
    expect(menu, "aria-controls must point at the menu").not.toBeNull();
    expect(within(menu as HTMLElement).getAllByRole("checkbox").length).toBeGreaterThan(1);
  });
});

describe("the tab strip", () => {
  /* Three unrelated buttons. A screen reader had no way to know it was three
     views of one thing, and moving between them meant tabbing through each. */
  test("is a tablist, and only the selected tab is in the tab order", async () => {
    stubFetch();
    await renderPage();
    expect(tab("Leaderboard").getAttribute("aria-selected")).toBe("true");
    expect(tab("Leaderboard").getAttribute("tabindex")).toBe("0");
    expect(tab("All teams").getAttribute("tabindex")).toBe("-1");
  });

  test("moves with the arrow keys, and wraps", async () => {
    stubFetch();
    await renderPage();
    tab("Leaderboard").focus();

    fireEvent.keyDown(tab("Leaderboard"), { key: "ArrowRight" });
    expect(document.activeElement).toBe(tab("All teams"));
    expect(tab("All teams").getAttribute("aria-selected")).toBe("true");

    fireEvent.keyDown(tab("All teams"), { key: "ArrowRight" });
    expect(document.activeElement).toBe(tab("Activity"));

    /* Walk whatever is left of the strip, so this stays a test of wrapping
       rather than a test of how many tabs there were the day it was written. */
    while (document.activeElement !== last()) {
      fireEvent.keyDown(document.activeElement as HTMLElement, { key: "ArrowRight" });
    }

    fireEvent.keyDown(last(), { key: "ArrowRight" });
    expect(document.activeElement, "the end wraps to the start").toBe(first());

    fireEvent.keyDown(first(), { key: "ArrowLeft" });
    expect(document.activeElement, "the start wraps to the end").toBe(last());
  });

  test("Home and End go to the ends", async () => {
    stubFetch();
    await renderPage();
    first().focus();
    fireEvent.keyDown(first(), { key: "End" });
    expect(document.activeElement).toBe(last());
    fireEvent.keyDown(last(), { key: "Home" });
    expect(document.activeElement).toBe(first());
  });

  test("the panel is labelled by its tab", async () => {
    stubFetch();
    await renderPage();
    const panel = screen.getByRole("tabpanel");
    expect(panel.getAttribute("aria-labelledby")).toBe(tab("Leaderboard").id);
  });
});

describe("the live block", () => {
  /* A red dot that pulses. Colour and motion were the whole of it, so a
     screen reader got a decorative span and a reader with the animation
     turned off got a dot with no explanation. */
  test("says in words that these games are in progress", async () => {
    stubFetch();
    await renderPage();
    const heading = screen.getByRole("heading", { name: /on the field/i });
    expect(heading.textContent).toMatch(/in progress/i);
  });
});
