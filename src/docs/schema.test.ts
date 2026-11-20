import assert from "node:assert/strict";
import { test } from "node:test";

import { colorFromCss, fontFromCss, keepPastedStyles, sizeFromCss } from "./schema.ts";

test("reads colors as CSS writes them", () => {
  assert.equal(colorFromCss("#1A5FB4"), "#1a5fb4");
  assert.equal(colorFromCss("#f00"), "#ff0000");
  assert.equal(colorFromCss("rgb(17, 85, 204)"), "#1155cc");
  assert.equal(colorFromCss("rgb(255 0 0 / 50%)"), "#ff0000");
  assert.equal(colorFromCss("rgba(0, 0, 0, 0)"), null);
  assert.equal(colorFromCss("transparent"), null);
  assert.equal(colorFromCss("#ffff0000"), null);
  assert.equal(colorFromCss("Navy"), "#000080");
  assert.equal(colorFromCss("url(x)"), null);
});

test("reads sizes in points", () => {
  assert.equal(sizeFromCss("12pt"), 12);
  assert.equal(sizeFromCss("16px"), 12);
  assert.equal(sizeFromCss("10.5pt"), 10.5);
  assert.equal(sizeFromCss("large"), 13.5);
  assert.equal(sizeFromCss("0pt"), null);
  assert.equal(sizeFromCss("calc(1px)"), null);
});

test("reads the first font that isn't generic", () => {
  assert.equal(fontFromCss('"Times New Roman", serif'), "Times New Roman");
  assert.equal(fontFromCss("sans-serif"), null);
  assert.equal(fontFromCss("url(x)"), null);
});

test("pasted styles are renamed only inside tags", () => {
  assert.equal(
    keepPastedStyles('<p style="color:red">a style="b"</p><SPAN\nSTYLE="x">'),
    '<p data-style="color:red">a style="b"</p><SPAN\ndata-style="x">',
  );
});
