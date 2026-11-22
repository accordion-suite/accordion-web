import assert from "node:assert/strict";
import { test } from "node:test";

import type { Node, NodeType } from "prosemirror-model";
import { type Command, EditorState, TextSelection } from "prosemirror-state";

import { countDocument } from "./counts.ts";
import { findMatches } from "./find.ts";
import { footnoteBefore, insertFootnote } from "./footnotes.ts";
import { schema } from "./schema.ts";

const nodes = schema.nodes as Record<string, NodeType>;
const note = (text: string) => nodes["footnote"]!.create(null, text ? [schema.text(text)] : []);
const paragraph = (...parts: (string | Node)[]) =>
  nodes["paragraph"]!.create(
    null,
    parts.map((part) => (typeof part === "string" ? schema.text(part) : part)),
  );
const doc = (...blocks: Node[]) => nodes["doc"]!.create(null, blocks);

function run(state: EditorState, command: Command): EditorState | null {
  let next: EditorState | null = null;
  command(state, (tr) => (next = state.apply(tr)));
  return next;
}

test("a footnote goes where the caret is", () => {
  const start = EditorState.create({ doc: doc(paragraph("Rivers run")) });
  const state = start.apply(start.tr.setSelection(TextSelection.create(start.doc, 7)));
  const next = run(state, insertFootnote)!;
  const pos = footnoteBefore(next)!;
  assert.equal(pos, 7);
  assert.equal(next.doc.nodeAt(pos)!.type.name, "footnote");
  assert.equal(next.doc.textBetween(1, pos), "Rivers");
  // Code has no footnotes.
  const code = EditorState.create({ doc: doc(nodes["code_block"]!.create(null, [schema.text("let x")])) });
  assert.equal(run(code.apply(code.tr.setSelection(TextSelection.create(code.doc, 2))), insertFootnote), null);
});

test("find and word count step over footnotes", () => {
  const text = doc(paragraph("One plan", note("see the plan book"), " and a plan"));
  const matches = findMatches(text, "plan", false);
  // The note's words aren't the text's, and positions after it are right.
  assert.deepEqual(
    matches.map((match) => text.textBetween(match.from, match.to)),
    ["plan", "plan"],
  );
  assert.equal(countDocument(text).words, 5);
});
