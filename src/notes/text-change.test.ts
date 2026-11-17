import assert from "node:assert/strict";
import { test } from "node:test";

import { shiftCaret, textChange, withAddedAtEnd } from "./text-change.ts";

test("finds the one change between two texts", () => {
  assert.equal(textChange("Milk", "Milk"), null);
  assert.deepEqual(textChange("Milk", "Milk and eggs"), { start: 4, removed: 0, inserted: " and eggs" });
  assert.deepEqual(textChange("Milk and eggs", "Milk eggs"), { start: 5, removed: 4, inserted: "" });
  assert.deepEqual(textChange("Buy milk", "Get milk"), { start: 0, removed: 3, inserted: "Get" });
});

test("never splits an emoji", () => {
  // The two smileys share their first code unit.
  const change = textChange("a😀b", "a😃b")!;
  assert.equal(change.start, 1);
  assert.equal(change.removed, 2);
  assert.equal(change.inserted, "😃");
});

test("keeps the caret with the words around it", () => {
  // Someone adds a line above the caret.
  assert.equal(shiftCaret("Eggs", "Milk\nEggs", 2), 7);
  // Or types after it, which leaves it where it is.
  assert.equal(shiftCaret("Eggs", "Eggs, jam", 2), 2);
  // Or replaces the words it was in.
  assert.equal(shiftCaret("Buy bread now", "Buy rolls now", 6), 9);
});

test("keeps the reader's change with what was added to the end meanwhile", () => {
  // A transcript arrived while the reader typed.
  assert.equal(withAddedAtEnd("Eggs\n", "Eggs and milk\n", "Eggs\n\nBuy bread.\n"), "Eggs and milk\n\nBuy bread.\n");
  assert.equal(withAddedAtEnd("", "Eggs", "Buy bread.\n"), "Eggs\n\nBuy bread.\n");
  assert.equal(withAddedAtEnd("Eggs\n", "", "Eggs\n\nBuy bread.\n"), "Buy bread.\n");
  // Anything else someone changed isn't merged.
  assert.equal(withAddedAtEnd("Eggs\n", "Eggs and milk\n", "Ham\n"), null);
  assert.equal(withAddedAtEnd("Eggs\n", "Eggs and milk\n", "Eggs\n"), null);
});
