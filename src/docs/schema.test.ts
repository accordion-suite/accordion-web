import assert from "node:assert/strict";
import { test } from "node:test";

import { colorFromCss, keepPastedStyles, sizeFromCss, weightAttrs, weightFromCss } from "./schema.ts";

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

test("reads weights, keeping only those that aren't regular or bold", () => {
  assert.equal(weightFromCss("300"), 300);
  assert.equal(weightFromCss("normal"), 400);
  assert.equal(weightFromCss("bold"), 700);
  assert.equal(weightFromCss("540"), 500);
  assert.equal(weightFromCss("1000"), 900);
  assert.equal(weightFromCss("bolder"), null);
  assert.deepEqual(weightAttrs(300), { weight: 300 });
  assert.equal(weightAttrs(400), false);
  assert.equal(weightAttrs(700), false);
  assert.equal(weightAttrs(350), false);
  assert.equal(weightAttrs(null), false);
});

test("pasted styles are renamed only inside tags", () => {
  assert.equal(
    keepPastedStyles('<p style="color:red">a style="b"</p><SPAN\nSTYLE="x">'),
    '<p data-style="color:red">a style="b"</p><SPAN\ndata-style="x">',
  );
});
