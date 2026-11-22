import assert from "node:assert/strict";
import { test } from "node:test";

import * as Y from "yjs";

import { addPageNumbers, readParts, removePart, setDifferentFirst } from "./parts.ts";

test("page numbers go at the right of each page's footer", () => {
  const doc = new Y.Doc();
  addPageNumbers(doc, "footer", false);
  const parts = readParts(doc);
  assert.equal(parts.header, null);
  assert.equal(parts.differentFirst, false);
  const paragraph = parts.footer!.firstChild!;
  assert.equal(paragraph.attrs["align"], "right");
  assert.equal(paragraph.textContent, "#");
  assert.equal(paragraph.firstChild!.marks[0]!.type.name, "field");
  assert.equal(paragraph.firstChild!.marks[0]!.attrs["kind"], "page");
});

test("page numbers from page 2 leave the first page without", () => {
  const doc = new Y.Doc();
  addPageNumbers(doc, "header", true);
  const parts = readParts(doc);
  assert.equal(parts.differentFirst, true);
  assert.equal(parts.firstHeader, null);
  assert.equal(parts.header!.childCount, 1);
});

test("an empty part is none, and the first page's show only when it differs", () => {
  const doc = new Y.Doc();
  doc.getXmlFragment("header").insert(0, [new Y.XmlElement("paragraph")]);
  assert.equal(readParts(doc).header, null);
  addPageNumbers(doc, "footer", false);
  doc.getXmlFragment("first_footer").insert(0, [new Y.XmlElement("paragraph")]);
  const text = new Y.XmlText();
  text.insert(0, "Draft");
  (doc.getXmlFragment("first_footer").get(0) as Y.XmlElement).insert(0, [text]);
  assert.equal(readParts(doc).firstFooter, null);
  setDifferentFirst(doc, true);
  assert.equal(readParts(doc).firstFooter!.textContent, "Draft");
  removePart(doc, "footer");
  assert.equal(readParts(doc).footer, null);
});
