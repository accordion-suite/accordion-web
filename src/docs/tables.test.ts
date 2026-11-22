import assert from "node:assert/strict";
import { test } from "node:test";

import { Fragment, Slice } from "prosemirror-model";

import { schema } from "./schema.ts";
import { borderFromCss, fitTables } from "./tables.ts";

test("reads borders as Google Docs and Word write them", () => {
  assert.deepEqual(borderFromCss("solid #000000 1pt"), { width: 1, color: "#000000" });
  assert.deepEqual(borderFromCss("1.0pt solid windowtext"), { width: 1, color: "#000000" });
  assert.deepEqual(borderFromCss("dashed #2F5496 1.5pt"), { width: 1.5, color: "#2f5496" });
  assert.deepEqual(borderFromCss("none"), { width: 0, color: null });
  assert.deepEqual(borderFromCss("solid red"), { width: 2.25, color: "#ff0000" });
  assert.deepEqual(borderFromCss("thin solid"), { width: 0.75, color: null });
  // Nothing thicker than 12 points.
  assert.equal(borderFromCss("solid 40pt").width, 12);
});

test("pasted tables wider than the page fit it", () => {
  const { table, table_row, table_cell, paragraph } = schema.nodes;
  const cell = (width: number) => table_cell!.create({ colwidth: [width] }, paragraph!.create());
  const wide = table!.create(null, [table_row!.create({ height: 90 }, [cell(235), cell(437)])]);
  const fitted = fitTables(new Slice(Fragment.from(wide), 0, 0), 624).content.firstChild!;
  const widths: number[] = [];
  fitted.firstChild!.forEach((each) => widths.push(...(each.attrs["colwidth"] as number[])));
  assert.deepEqual(widths, [218, 405]);
  // The row keeps its height, and a table that fits stays as it is.
  assert.equal(fitted.firstChild!.attrs["height"], 90);
  const slice = new Slice(Fragment.from(wide), 0, 0);
  assert.equal(fitTables(slice, 800), slice);
});
