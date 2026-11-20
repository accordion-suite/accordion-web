// Find and replace in a document (decision 30, step 3, part 3). A plugin
// keeps what's being looked for and highlights every match. The match
// being looked at is the selection, so it moves with the document as others
// edit it, and closing the search leaves the caret on it.

import type { Node } from "prosemirror-model";
import { type Command, type EditorState, Plugin, PluginKey, TextSelection, type Transaction } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";

export interface Match {
  from: number;
  to: number;
}

interface Search {
  query: string;
  matchCase: boolean;
}

interface FindState extends Search {
  matches: Match[];
  decorations: DecorationSet;
}

const key = new PluginKey<FindState>("find");

/** Every place `query` appears in `doc`'s text, in order. A match stays in
 * one paragraph, and never runs across a picture or a line break. Without
 * `matchCase`, "Plans" also finds "plans" and "PLANS". */
export function findMatches(doc: Node, query: string, matchCase: boolean): Match[] {
  if (!query) return [];
  // A regular expression's own case folding never changes the text's
  // length, as lowercasing it can, so positions stay right.
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), matchCase ? "gu" : "giu");
  const matches: Match[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    let text = "";
    node.forEach((child) => {
      // Anything else, such as a picture, takes one position, as it does
      // in the document, and matches nothing.
      text += child.isText ? child.text! : "￼";
    });
    for (const found of text.matchAll(pattern)) {
      matches.push({ from: pos + 1 + found.index, to: pos + 1 + found.index + found[0].length });
    }
    return false;
  });
  return matches;
}

/** The plugin that keeps the search and highlights its matches. */
export function findPlugin(): Plugin<FindState> {
  return new Plugin<FindState>({
    key,
    state: {
      init: () => ({ query: "", matchCase: false, matches: [], decorations: DecorationSet.empty }),
      apply(tr, before, _old, state) {
        const search: Search | undefined = tr.getMeta(key);
        if (!search && !tr.docChanged && !tr.selectionSet) return before;
        const { query, matchCase } = search ?? before;
        const matches = search || tr.docChanged ? findMatches(state.doc, query, matchCase) : before.matches;
        return { query, matchCase, matches, decorations: decorate(state, matches) };
      },
    },
    props: {
      decorations: (state) => key.getState(state)?.decorations,
    },
  });
}

function decorate(state: EditorState, matches: readonly Match[]): DecorationSet {
  if (!matches.length) return DecorationSet.empty;
  const current = currentIndex(state, matches);
  return DecorationSet.create(
    state.doc,
    matches.map((match, index) =>
      Decoration.inline(match.from, match.to, { class: index === current ? "docs-find-match current" : "docs-find-match" }),
    ),
  );
}

/** Which match is selected, or -1. */
function currentIndex(state: EditorState, matches: readonly Match[]): number {
  const { from, to } = state.selection;
  return matches.findIndex((match) => match.from === from && match.to === to);
}

/** How many matches there are, and which one is selected (from 1, or 0 for
 * none). */
export function findCount(state: EditorState): { current: number; total: number } {
  const matches = key.getState(state)?.matches ?? [];
  return { current: currentIndex(state, matches) + 1, total: matches.length };
}

/** Looks for `query`, selecting the first match from the caret on, as
 * Google Docs does while you type. An empty query clears the highlights. */
export function setSearch(query: string, matchCase: boolean): Command {
  return (state, dispatch) => {
    if (!dispatch) return true;
    const tr = state.tr.setMeta(key, { query, matchCase });
    const matches = findMatches(state.doc, query, matchCase);
    const from = state.selection.from;
    const next = matches.find((match) => match.from >= from) ?? matches[0];
    dispatch(next ? select(tr, next) : tr);
    return true;
  };
}

/** Selects the next match, or the one before, going round at the end. */
export function findStep(direction: 1 | -1): Command {
  return (state, dispatch) => {
    const matches = key.getState(state)?.matches ?? [];
    if (!matches.length) return false;
    const { from } = state.selection;
    const selected = currentIndex(state, matches) >= 0;
    const next =
      direction === 1
        ? (matches.find((match) => (selected ? match.from > from : match.from >= from)) ?? matches[0]!)
        : (matches.findLast((match) => match.from < from) ?? matches.at(-1)!);
    dispatch?.(select(state.tr, next));
    return true;
  };
}

/** Replaces the selected match and selects the next. With no match
 * selected, it selects the next one first, so you see what you replace. */
export function replaceMatch(replacement: string): Command {
  return (state, dispatch) => {
    const matches = key.getState(state)?.matches ?? [];
    const current = matches[currentIndex(state, matches)];
    if (!current) return findStep(1)(state, dispatch);
    if (!dispatch) return true;
    const tr = replace(state.tr, current, replacement);
    const end = current.from + replacement.length;
    const search = key.getState(state)!;
    const after = findMatches(tr.doc, search.query, search.matchCase);
    const next = after.find((match) => match.from >= end) ?? after[0];
    dispatch(next ? select(tr, next) : tr.setSelection(TextSelection.create(tr.doc, end)).scrollIntoView());
    return true;
  };
}

/** Replaces every match, as one change that Undo takes back at once. */
export function replaceAll(replacement: string): Command {
  return (state, dispatch) => {
    const matches = key.getState(state)?.matches ?? [];
    if (!matches.length) return false;
    if (!dispatch) return true;
    // From the end, so the positions before each one stay right.
    let tr = state.tr;
    for (const match of [...matches].reverse()) tr = replace(tr, match, replacement);
    dispatch(tr.scrollIntoView());
    return true;
  };
}

function replace(tr: Transaction, match: Match, replacement: string): Transaction {
  // The new text takes the formatting of what it replaces.
  return replacement ? tr.insertText(replacement, match.from, match.to) : tr.delete(match.from, match.to);
}

function select(tr: Transaction, match: Match): Transaction {
  return tr.setSelection(TextSelection.create(tr.doc, match.from, match.to)).scrollIntoView();
}
