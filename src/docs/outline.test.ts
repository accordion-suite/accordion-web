import assert from "node:assert/strict";
import { test } from "node:test";

import type { NodeType } from "prosemirror-model";
import { EditorState, TextSelection } from "prosemirror-state";

import { currentEntry, outlineOf } from "./outline.tsx";
import { schema } from "./schema.ts";

const nodes = schema.nodes as Record<string, NodeType>;

test("the outline lists the title and headings with text, and where the caret is", () => {
  const heading = (level: number, text: string) => nodes["heading"]!.create({ level }, text ? schema.text(text) : null);
  const doc = nodes["doc"]!.create(null, [
    nodes["paragraph"]!.create({ kind: "title" }, schema.text("Plans")),
    heading(1, "Spring"),
    nodes["paragraph"]!.create(null, schema.text("Seeds")),
    heading(2, ""),
    nodes["blockquote"]!.create(null, heading(3, "Quoted")),
  ]);
  const entries = outlineOf(doc);
  assert.deepEqual(
    entries.map((entry) => [entry.level, entry.text]),
    [
      [0, "Plans"],
      [1, "Spring"],
      [3, "Quoted"],
    ],
  );
  assert.equal(outlineOf(doc), entries);
  let state = EditorState.create({ doc });
  state = state.apply(state.tr.setSelection(TextSelection.create(doc, entries[1]!.pos + 3)));
  assert.equal(currentEntry(entries, state), 1);
  state = state.apply(state.tr.setSelection(TextSelection.create(doc, 1)));
  assert.equal(currentEntry(entries, state), 0);
});
