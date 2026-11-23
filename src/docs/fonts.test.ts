import assert from "node:assert/strict";
import { test } from "node:test";

import { fitSize, FONTS, fontNamed, fontStack, nearestWeight, resolveFont, safeFontName, shownWeight, STAND_INS, stepSize } from "./fonts.ts";

test("sizes stay within limits, to the half point", () => {
  assert.equal(fitSize(10.26), 10.5);
  assert.equal(fitSize(0), 1);
  assert.equal(fitSize(1000), 400);
  assert.equal(fitSize(Number.NaN), null);
});

test("sizes step a point at a time, as in Google Docs", () => {
  assert.equal(stepSize(11, 1), 12);
  assert.equal(stepSize(10.5, 1), 11);
  assert.equal(stepSize(10.5, -1), 10);
  assert.equal(stepSize(1, -1), 1);
});

test("font names the server would keep", () => {
  assert.equal(safeFontName("  Open   Sans "), "Open Sans");
  assert.equal(safeFontName("x'};body{"), null);
  assert.equal(safeFontName(""), null);
  for (const font of FONTS) assert.equal(safeFontName(font.name), font.name);
});

test("each font falls back to one like it while it loads", () => {
  assert.equal(fontStack("Lobster"), '"Lobster", sans-serif');
  assert.equal(fontStack("Tinos"), '"Tinos", serif');
  assert.equal(fontStack("Caveat"), '"Caveat", cursive');
});

test("fonts Docs doesn't have get one it has, and say so", () => {
  assert.deepEqual(resolveFont("Arial,sans-serif"), {
    name: "Arimo",
    weight: null,
    replaced: { from: "Arial", to: "Arimo", kind: "same" },
  });
  assert.deepEqual(resolveFont('"Times New Roman", serif').replaced, { from: "Times New Roman", to: "Tinos", kind: "same" });
  assert.deepEqual(resolveFont("Comic Sans MS").replaced, { from: "Comic Sans MS", to: "Comic Relief", kind: "same" });
  assert.deepEqual(resolveFont("Verdana").replaced, { from: "Verdana", to: "Noto Sans", kind: "like" });
  // A font named after the first, which the page would show, comes before
  // one that only looks like the first.
  assert.deepEqual(resolveFont('"Segoe UI", Roboto, sans-serif').replaced, { from: "Segoe UI", to: "Roboto", kind: "other" });
  assert.deepEqual(resolveFont("Wingdings 9, serif").replaced, { from: "Wingdings 9", to: "Tinos", kind: "other" });
  assert.deepEqual(resolveFont("Mystery").replaced, { from: "Mystery", to: "Arimo", kind: "other" });
  assert.deepEqual(resolveFont("monospace"), { name: "Cousine", weight: null, replaced: null });
  assert.deepEqual(resolveFont("raleway"), { name: "Raleway", weight: null, replaced: null });
});

test("a weight in a font's name is the font in that weight", () => {
  assert.deepEqual(resolveFont("Raleway Light"), { name: "Raleway", weight: 300, replaced: null });
  assert.deepEqual(resolveFont("Montserrat SemiBold"), { name: "Montserrat", weight: 600, replaced: null });
  assert.deepEqual(resolveFont("Arial Bold").weight, 700);
  // Carlito has no light, so it isn't Calibri Light's widths.
  assert.deepEqual(resolveFont("Calibri Light"), {
    name: "Carlito",
    weight: null,
    replaced: { from: "Calibri Light", to: "Carlito", kind: "like" },
  });
  assert.deepEqual(resolveFont("Source Sans 3"), { name: "Source Sans 3", weight: null, replaced: null });
});

test("weights snap to the font's own, and bold makes them bolder", () => {
  assert.equal(nearestWeight(fontNamed("Lato")!, 200), 100);
  assert.equal(nearestWeight(fontNamed("Amatic SC")!, 600), 700);
  assert.equal(nearestWeight(fontNamed("Lobster")!, 900), 400);
  assert.equal(shownWeight(300, true), 400);
  assert.equal(shownWeight(500, true), 700);
  assert.equal(shownWeight(800, true), 800);
  assert.equal(shownWeight(300, false), 300);
  assert.equal(shownWeight(null, true), 700);
});

test("every stand-in is a font Docs has, and every font has regular", () => {
  for (const [name, stand] of Object.entries(STAND_INS)) {
    assert.ok(fontNamed(stand.font), stand.font);
    assert.equal(name, name.toLowerCase());
    assert.equal(fontNamed(name), undefined, name);
  }
  for (const font of FONTS) {
    assert.ok(font.weights.includes(400), font.name);
    assert.deepEqual([...font.weights], [...font.weights].sort((a, b) => a - b));
  }
});

test("the menu is in order", () => {
  const names = FONTS.map((font) => font.name);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)));
});
