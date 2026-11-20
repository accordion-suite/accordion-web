import assert from "node:assert/strict";
import { test } from "node:test";

import type { Node, NodeType } from "prosemirror-model";
import { type Command, EditorState, TextSelection } from "prosemirror-state";

import { countDocument, countText } from "./counts.ts";
import { findCount, findMatches, findPlugin, findStep, replaceAll, replaceMatch, setSearch } from "./find.ts";
import { schema } from "./schema.ts";

const nodes = schema.nodes as Record<string, NodeType>;
const lineBreak = () => nodes["hard_break"]!.create();
const paragraph = (...parts: (string | Node)[]) =>
  nodes["paragraph"]!.create(
    null,
    parts.map((part) => (typeof part === "string" ? schema.text(part) : part)),
  );
const doc = (...blocks: Node[]) => nodes["doc"]!.create(null, blocks);

function texts(state: EditorState, matches = findMatches(state.doc, "plan", false)) {
  return matches.map((match) => state.doc.textBetween(match.from, match.to));
}

function run(state: EditorState, command: Command) {
  let next = state;
  command(state, (tr) => (next = next.apply(tr)));
  return next;
}

const start = () =>
  EditorState.create({
    doc: doc(paragraph("Plans for the plan"), paragraph("PLAN B and pl", lineBreak(), "an C")),
    plugins: [findPlugin()],
  });

test("finds matches in any case, or only the same case", () => {
  const state = start();
  assert.deepEqual(texts(state), ["Plan", "plan", "PLAN"]);
  assert.deepEqual(texts(state, findMatches(state.doc, "plan", true)), ["plan"]);
  assert.deepEqual(findMatches(state.doc, "", false), []);
  // Special characters are only text.
  assert.deepEqual(findMatches(doc(paragraph("a.b axb")), "a.b", false).length, 1);
});

test("a match never crosses a line break or a paragraph", () => {
  const state = start();
  assert.deepEqual(findMatches(state.doc, "plan C", false), []);
  assert.deepEqual(findMatches(state.doc, "planPLAN", false), []);
});

test("searching selects the first match from the caret, and steps go round", () => {
  let state = start();
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 3)));
  state = run(state, setSearch("plan", false));
  assert.deepEqual(findCount(state), { current: 2, total: 3 });
  state = run(state, findStep(1));
  assert.deepEqual(findCount(state), { current: 3, total: 3 });
  state = run(state, findStep(1));
  assert.deepEqual(findCount(state), { current: 1, total: 3 });
  state = run(state, findStep(-1));
  assert.deepEqual(findCount(state), { current: 3, total: 3 });
});

test("replacing selects the next match, even when the new text matches", () => {
  let state = run(start(), setSearch("plan", false));
  state = run(state, replaceMatch("plan plan"));
  assert.equal(state.doc.child(0).textContent, "plan plans for the plan");
  // The next match is the old second one, not what was just put in.
  assert.equal(state.selection.from, "plan plans for the ".length + 1);
  state = run(state, replaceAll("idea"));
  assert.equal(state.doc.child(0).textContent, "idea ideas for the idea");
  assert.equal(state.doc.child(1).textContent, "idea B and plan C");
  assert.deepEqual(findCount(state), { current: 0, total: 0 });
});

test("replacing with nothing removes the matches", () => {
  const state = run(run(start(), setSearch("plan", true)), replaceAll(""));
  assert.equal(state.doc.child(0).textContent, "Plans for the ");
});

test("counts words and characters as Google Docs does", () => {
  assert.deepEqual(countText("Hello, world. It's 2026!"), { words: 4, characters: 24, letters: 21 });
  assert.deepEqual(countText(""), { words: 0, characters: 0, letters: 0 });
  // An emoji with a skin tone is one character.
  assert.equal(countText("👋🏽").characters, 1);
  assert.ok(countText("東京に行きます").words > 1);
});

test("counts paragraphs as separate words and not as characters", () => {
  const state = start();
  assert.deepEqual(countDocument(state.doc), { words: 10, characters: 35, letters: 28 });
  assert.equal(countDocument(state.doc, 1, 6).words, 1);
});
