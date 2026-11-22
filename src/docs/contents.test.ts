import assert from "node:assert/strict";
import { test } from "node:test";

import type { Node, NodeType } from "prosemirror-model";
import { EditorState, TextSelection } from "prosemirror-state";

import { contentsOf, hasContents, insertContents } from "./contents.ts";
import { schema } from "./schema.ts";

const nodes = schema.nodes as Record<string, NodeType>;
const paragraph = (text = "", attrs: Record<string, unknown> | null = null) =>
  nodes["paragraph"]!.create(attrs, text ? [schema.text(text)] : []);
const heading = (level: number, ...parts: (string | Node)[]) =>
  nodes["heading"]!.create(
    { level },
    parts.map((part) => (typeof part === "string" ? schema.text(part) : part)),
  );
const doc = (...blocks: Node[]) => nodes["doc"]!.create(null, blocks);

test("the entries are the headings with text, as the server lists them", () => {
  const note = nodes["footnote"]!.create(null, [schema.text("a note")]);
  const text = doc(
    paragraph("Report", { kind: "title" }),
    heading(1, "Plan", note),
    heading(2),
    nodes["bullet_list"]!.create(null, [nodes["list_item"]!.create(null, [heading(3, "In a  list")])]),
    heading(2, "Last", nodes["hard_break"]!.create(), "line"),
  );
  assert.deepEqual(
    contentsOf(text).map((entry) => [entry.level, entry.text]),
    [
      [1, "Plan"],
      [3, "In a list"],
      [2, "Last line"],
    ],
  );
  assert.equal(hasContents(text), false);
});

function insertAt(start: Node, pos: number): Node {
  const state = EditorState.create({ doc: start });
  const placed = state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos)));
  let next: EditorState | null = null;
  insertContents("dotted")(placed, (tr) => (next = placed.apply(tr)));
  return next!.doc;
}

test("a table of contents goes between the document's own blocks", () => {
  const names = (each: Node) => {
    const out: string[] = [];
    each.forEach((child) => out.push(child.type.name === "paragraph" ? child.textContent || "¶" : child.type.name));
    return out;
  };
  // In the middle of a paragraph, it splits it.
  assert.deepEqual(names(insertAt(doc(paragraph("Rivers run")), 7)), ["Rivers", "table_of_contents", " run"]);
  // At a paragraph's start, it goes before it.
  assert.deepEqual(names(insertAt(doc(paragraph("Rivers")), 1)), ["table_of_contents", "Rivers"]);
  // At the end of the last one, a line follows it for the caret.
  const after = insertAt(doc(paragraph("Rivers")), 7);
  assert.deepEqual(names(after), ["Rivers", "table_of_contents", "¶"]);
  assert.equal(after.child(1).attrs["style"], "dotted");
  assert.equal(hasContents(after), true);
  // In a list, it goes after the list.
  const list = nodes["bullet_list"]!.create(null, [nodes["list_item"]!.create(null, [paragraph("Milk")])]);
  assert.deepEqual(names(insertAt(doc(list, paragraph("Next")), 3)), ["bullet_list", "table_of_contents", "Next"]);
});
