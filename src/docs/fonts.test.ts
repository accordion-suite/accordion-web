import assert from "node:assert/strict";
import { test } from "node:test";

import { fitSize, FONTS, fontStack, safeFontName, stepSize } from "./fonts.ts";

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

test("each font falls back to one like it", () => {
  assert.equal(fontStack("Lobster"), '"Lobster", sans-serif');
  assert.equal(fontStack("Times New Roman"), '"Times New Roman", serif');
  assert.equal(fontStack("Caveat"), '"Caveat", cursive');
  assert.equal(fontStack("Segoe UI"), '"Segoe UI", sans-serif');
});

test("the menu is in order", () => {
  const names = FONTS.map((font) => font.name);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)));
});
