import assert from "node:assert/strict";
import { test } from "node:test";

import { inputRules } from "prosemirror-inputrules";
import type { Node, NodeType } from "prosemirror-model";
import { EditorState, TextSelection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";

import { autoLink, autoLinkOnEnter, linkInWord, saveTyping, smartQuotes } from "./autoformat.ts";
import { schema } from "./schema.ts";

const nodes = schema.nodes as Record<string, NodeType>;
const rules = inputRules({ rules: [...smartQuotes, autoLink] });

/** Types `text` one character at a time into an empty paragraph, as the
 * browser would, running the rules. */
function typed(text: string, block: NodeType = nodes["paragraph"]!): Node {
  let state = EditorState.create({ doc: nodes["doc"]!.create(null, [block.create()]), plugins: [rules] });
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1)));
  const view = {
    get state() {
      return state;
    },
    dispatch: (tr: Parameters<EditorView["dispatch"]>[0]) => (state = state.apply(tr)),
    composing: false,
  } as unknown as EditorView;
  for (const character of text) {
    const { from, to } = state.selection;
    const handled = rules.props.handleTextInput!.call(rules, view, from, to, character, () =>
      state.tr.insertText(character, from, to),
    );
    if (!handled) view.dispatch(state.tr.insertText(character, from, to));
  }
  return state.doc;
}

function links(doc: Node): string[] {
  const found: string[] = [];
  doc.descendants((node) => {
    const link = node.marks.find((mark) => mark.type.name === "link");
    if (link) found.push(`${node.text} -> ${link.attrs["href"] as string}`);
  });
  return found;
}

test("quotes curl open or closed by what's before them", () => {
  saveTyping({ smartQuotes: true, autoLinks: true });
  assert.equal(typed(`"Hi," she said. 'It's ('odd') "here"`).textContent, "“Hi,” she said. ‘It’s (‘odd’) “here”");
  // Code keeps straight quotes.
  assert.equal(typed(`"x"`, nodes["code_block"]).textContent, `"x"`);
  saveTyping({ smartQuotes: false, autoLinks: true });
  assert.equal(typed(`"x"`).textContent, `"x"`);
  saveTyping({ smartQuotes: true, autoLinks: true });
});

test("finds addresses in words, leaving punctuation out", () => {
  assert.deepEqual(linkInWord("example.com."), { start: 0, end: 11, href: "https://example.com" });
  assert.deepEqual(linkInWord("(www.example.org/a)"), { start: 1, end: 18, href: "https://www.example.org/a" });
  assert.equal(linkInWord("https://en.wikipedia.org/wiki/Fish_(animal)")?.href, "https://en.wikipedia.org/wiki/Fish_(animal)");
  assert.equal(linkInWord("me@example.com,")?.href, "mailto:me@example.com");
  for (const word of ["plans.html", "e.g.", "Node.js", "3.14", "https://", "hello", "javascript:alert(1)"]) {
    assert.equal(linkInWord(word), null, word);
  }
});

test("an address becomes a link when a space follows it", () => {
  assert.deepEqual(links(typed("See example.com/a, then www.test.org ")), [
    "example.com/a -> https://example.com/a",
    "www.test.org -> https://www.test.org",
  ]);
  saveTyping({ smartQuotes: true, autoLinks: false });
  assert.deepEqual(links(typed("example.com ")), []);
  saveTyping({ smartQuotes: true, autoLinks: true });
});

test("Enter links the address before it and lets Enter carry on", () => {
  const doc = typed("mail me@example.com");
  let state = EditorState.create({ doc });
  state = state.apply(state.tr.setSelection(TextSelection.atEnd(state.doc)));
  let next = state;
  assert.equal(
    autoLinkOnEnter(state, (tr) => (next = state.apply(tr))),
    false,
  );
  assert.deepEqual(links(next.doc), ["me@example.com -> mailto:me@example.com"]);
});
