import assert from "node:assert/strict";
import { test } from "node:test";

import * as Y from "yjs";

import {
  defaultPageSize,
  fromPoints,
  marginPreset,
  newPageSetup,
  normalized,
  PAGE,
  readPage,
  toPoints,
  usesInches,
  writePage,
} from "./page-setup.ts";

test("paper follows the browser's region", () => {
  assert.equal(defaultPageSize("en-US"), "letter");
  assert.equal(defaultPageSize("fr-CA"), "letter");
  assert.equal(defaultPageSize("es-MX"), "letter");
  assert.equal(defaultPageSize("en-GB"), "a4");
  assert.equal(defaultPageSize("nl"), "a4");
  assert.equal(defaultPageSize("de-DE"), "a4");
  assert.equal(usesInches("en-US"), true);
  assert.equal(usesInches("en-AU"), false);
});

test("margins always leave room for text, as the server keeps them", () => {
  const page = normalized({ size: "a5", landscape: false, margins: [-5, 288, Number.NaN, 288] });
  assert.equal(page.margins[0], 0);
  assert.equal(page.margins[2], 72);
  assert.equal(page.margins[1], page.margins[3]);
  assert.ok(page.margins[1] + page.margins[3] <= (148 * 72) / 25.4 - 72);
  const wide = normalized({ size: "a5", landscape: true, margins: [72, 200, 72, 200] });
  assert.deepEqual(wide.margins, [72, 200, 72, 200]);
});

test("the page setup goes through the shared map", () => {
  const doc = new Y.Doc();
  const map = doc.getMap<unknown>(PAGE);
  assert.equal(readPage(map), null);
  const setup = { ...newPageSetup("a4"), landscape: true, margins: [36, 72, 36, 72] as [number, number, number, number] };
  let changes = 0;
  doc.on("update", () => changes++);
  writePage(map, setup);
  assert.equal(changes, 1);
  assert.deepEqual(readPage(map), setup);
  assert.equal(map.get("orientation"), "landscape");
  // Writing the same again changes nothing.
  writePage(map, setup);
  assert.equal(changes, 1);
});

test("margins convert to the reader's unit and back", () => {
  assert.equal(fromPoints(72, true), 1);
  assert.equal(fromPoints(72, false), 2.54);
  assert.equal(Math.round(toPoints(2.54, false) * 100) / 100, 72);
  assert.equal(marginPreset([72, 144, 72, 144]), "wide");
  assert.equal(marginPreset([72, 144, 72, 143]), null);
});
