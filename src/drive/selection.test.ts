import assert from "node:assert/strict";
import { test } from "node:test";

import { type Box, neighbor, overlaps, range } from "./selection.ts";

const ORDER = ["a", "b", "c", "d", "e"];

test("a Shift range runs from the anchor either way", () => {
  assert.deepEqual(range(ORDER, "b", "d"), ["b", "c", "d"]);
  assert.deepEqual(range(ORDER, "d", "b"), ["b", "c", "d"]);
  assert.deepEqual(range(ORDER, "c", "c"), ["c"]);
  // With no anchor, or one that's gone, it's just the item.
  assert.deepEqual(range(ORDER, null, "c"), ["c"]);
  assert.deepEqual(range(ORDER, "gone", "c"), ["c"]);
  assert.deepEqual(range(ORDER, "a", "gone"), []);
});

test("a box touches what it overlaps, not what it only meets", () => {
  const box: Box = { left: 0, top: 0, right: 10, bottom: 10 };
  assert.ok(overlaps(box, { left: 5, top: 5, right: 20, bottom: 20 }));
  assert.ok(overlaps(box, { left: 2, top: 2, right: 3, bottom: 3 }));
  assert.ok(!overlaps(box, { left: 10, top: 0, right: 20, bottom: 10 }));
  assert.ok(!overlaps(box, { left: 0, top: 11, right: 10, bottom: 20 }));
});

/** A grid of 100 by 50 boxes, `columns` across, named in order. */
function grid(names: string[], columns: number) {
  return names.map((id, at) => {
    const left = (at % columns) * 110;
    const top = Math.floor(at / columns) * 60;
    return { id, box: { left, top, right: left + 100, bottom: top + 50 } };
  });
}

test("arrow keys move through a grid by where items are", () => {
  const boxes = grid(["a", "b", "c", "d", "e", "f", "g"], 3);
  assert.equal(neighbor(boxes, "b", "ArrowRight"), "c");
  assert.equal(neighbor(boxes, "d", "ArrowLeft"), "c");
  assert.equal(neighbor(boxes, "b", "ArrowDown"), "e");
  assert.equal(neighbor(boxes, "e", "ArrowUp"), "b");
  // The last row is short, so down from the end of a row goes to the
  // closest item below.
  assert.equal(neighbor(boxes, "f", "ArrowDown"), "g");
  assert.equal(neighbor(boxes, "a", "ArrowUp"), null);
  assert.equal(neighbor(boxes, "g", "ArrowRight"), null);
});

test("arrow keys move through rows", () => {
  const boxes = grid(["a", "b", "c"], 1);
  assert.equal(neighbor(boxes, "a", "ArrowDown"), "b");
  assert.equal(neighbor(boxes, "c", "ArrowUp"), "b");
  assert.equal(neighbor(boxes, "c", "ArrowDown"), null);
});
