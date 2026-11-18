import assert from "node:assert/strict";
import { test } from "node:test";

import { pageLines } from "./page-lines.ts";

test("reads each kind of line with its styles", () => {
  const lines = pageLines({
    version: 1,
    lines: [
      { kind: "heading", level: 2, runs: [{ text: "Trip to " }, { text: "Lisbon", italic: true }] },
      { kind: "item", mark: "2.", runs: [{ text: "Pack" }] },
      { kind: "item", mark: "•", depth: 1, runs: [{ text: "Shoes", bold: true, link: true }] },
      { kind: "check", checked: true, runs: [{ text: "Book" }] },
      { kind: "paragraph", quote: true, runs: [] },
      { kind: "row", cells: [[{ text: "Day", bold: true }], [{ text: "Mon" }]] },
      { kind: "code", runs: [{ text: "x = 1" }] },
    ],
  });
  assert.deepEqual(lines, [
    {
      kind: "heading",
      level: 2,
      depth: 0,
      quote: false,
      runs: [
        { text: "Trip to ", styles: [] },
        { text: "Lisbon", styles: ["italic"] },
      ],
    },
    { kind: "item", mark: "2.", depth: 0, quote: false, runs: [{ text: "Pack", styles: [] }] },
    { kind: "item", mark: "•", depth: 1, quote: false, runs: [{ text: "Shoes", styles: ["bold", "link"] }] },
    { kind: "check", checked: true, depth: 0, quote: false, runs: [{ text: "Book", styles: [] }] },
    { kind: "paragraph", depth: 0, quote: true, runs: [] },
    {
      kind: "row",
      depth: 0,
      quote: false,
      cells: [[{ text: "Day", styles: ["bold"] }], [{ text: "Mon", styles: [] }]],
    },
    { kind: "code", depth: 0, quote: false, runs: [{ text: "x = 1", styles: [] }] },
  ]);
});

test("draws an unknown kind of line as a paragraph", () => {
  assert.deepEqual(pageLines({ version: 1, lines: [{ kind: "picture", runs: [{ text: "Map" }] }] }), [
    { kind: "paragraph", depth: 0, quote: false, runs: [{ text: "Map", styles: [] }] },
  ]);
});

test("refuses thumbnails it can't draw", () => {
  assert.equal(pageLines({ version: 2, lines: [] }), null);
  assert.equal(pageLines({ lines: [] }), null);
  assert.equal(pageLines("Trip"), null);
  assert.equal(pageLines({ version: 1, lines: [{ kind: "paragraph", runs: [{ text: 3 }] }] }), null);
  assert.equal(pageLines({ version: 1, lines: [{ kind: "row", cells: [null] }] }), null);
});
