import assert from "node:assert/strict";
import { test } from "node:test";

import { stemLength } from "./names.ts";

test("selects a file's name without its extension", () => {
  assert.equal(stemLength("Beach day.jpg"), "Beach day".length);
  assert.equal(stemLength("archive.tar.gz"), "archive.tar".length);
});

test("selects the whole name when there's no extension", () => {
  assert.equal(stemLength("README"), 6);
  assert.equal(stemLength(".bashrc"), 7);
  assert.equal(stemLength(""), 0);
});
