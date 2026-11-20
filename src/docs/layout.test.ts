import assert from "node:assert/strict";
import { test } from "node:test";

import { lengthFromCss, lineFromCss, twentieths } from "./layout.ts";

test("reads lengths in points", () => {
  assert.equal(lengthFromCss("36pt"), 36);
  assert.equal(lengthFromCss("0.5in"), 36);
  assert.equal(lengthFromCss("-18pt"), -18);
  assert.equal(lengthFromCss("48px"), 36);
  assert.equal(lengthFromCss("0"), 0);
  assert.equal(lengthFromCss("auto"), null);
});

test("reads line spacing as Google Docs and Word write it", () => {
  // Google Docs writes its spacing times 1.2, Word a percentage.
  assert.equal(lineFromCss("1.38"), 1.15);
  assert.equal(lineFromCss("2.4"), 2);
  assert.equal(lineFromCss("115%"), 1.15);
  assert.equal(lineFromCss("normal"), null);
  assert.equal(lineFromCss("50"), 10);
});

test("rounds lengths as the server keeps them", () => {
  assert.equal(twentieths(28.3465), 28.35);
  assert.equal(twentieths(36), 36);
});
