import assert from "node:assert/strict";
import { test } from "node:test";

import { freeName, stemLength } from "./names.ts";

test("selects a file's name without its extension", () => {
  assert.equal(stemLength("Beach day.jpg"), "Beach day".length);
  assert.equal(stemLength("archive.tar.gz"), "archive.tar".length);
});

test("selects the whole name when there's no extension", () => {
  assert.equal(stemLength("README"), 6);
  assert.equal(stemLength(".bashrc"), 7);
  assert.equal(stemLength(""), 0);
});

test("keeps a name that's free", () => {
  assert.equal(freeName("Beach.jpg", new Set(["Other.jpg"])), "Beach.jpg");
});

test("numbers a file before its extension", () => {
  assert.equal(freeName("Beach.jpg", new Set(["Beach.jpg"])), "Beach (1).jpg");
  assert.equal(freeName("Beach.jpg", new Set(["Beach.jpg", "Beach (1).jpg"])), "Beach (2).jpg");
  assert.equal(freeName("README", new Set(["README"])), "README (1)");
});

test("counts up from a number the name already has", () => {
  assert.equal(freeName("test (4).txt", new Set(["test (4).txt"])), "test (5).txt");
  assert.equal(freeName("test (4).txt", new Set(["test (4).txt", "test (5).txt"])), "test (6).txt");
  assert.equal(freeName("Photos (2)", new Set(["Photos (2)"])), "Photos (3)");
  assert.equal(freeName("Taxes (2025).pdf", new Set(["Taxes (2025).pdf"])), "Taxes (2026).pdf");
});

test("numbers a name without an extension at its end", () => {
  assert.equal(freeName("Photos", new Set(["Photos"])), "Photos (1)");
  assert.equal(freeName(".config", new Set([".config"])), ".config (1)");
});
