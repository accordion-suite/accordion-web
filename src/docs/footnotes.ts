// Footnotes (decision 30, step 4): a number in the text, and its note at
// the bottom of the page the number is on, as in Google Docs and Word.
//
// A footnote is a node in the text that holds its note (schema.ts), so it
// moves, copies, and goes with its number, and the server keeps it where it
// is (accordion-docs' `Inline::Footnote`). The pages draw each page's notes
// under a short line at its bottom (pages.ts). A note is edited in place
// there, in an editor of its own whose changes go into the document's, so
// undo and co-editing work as they do for the rest of the text.

import { baseKeymap, toggleMark } from "prosemirror-commands";
import { keymap } from "prosemirror-keymap";
import type { MarkType, Node } from "prosemirror-model";
import { type Command, EditorState, NodeSelection, TextSelection, type Transaction } from "prosemirror-state";
import { StepMap } from "prosemirror-transform";
import { EditorView } from "prosemirror-view";
import { redo, undo, ySyncPluginKey } from "y-prosemirror";

import { noteAt, setNoteEditing } from "./pages.ts";
import { schema } from "./schema.ts";
import { clearFormatting, stepFontSize, styleMarkViews } from "./text-style.ts";

const marks = schema.marks as Record<string, MarkType>;

/** y-prosemirror's link between the document's nodes and their Yjs
 * elements. */
interface Binding {
  mapping: Map<unknown, Node | Node[]>;
}

function bindingOf(state: EditorState): Binding | null {
  return (ySyncPluginKey.getState(state) as { binding?: Binding } | undefined)?.binding ?? null;
}

/** The Yjs element that holds `node`, if the document is co-edited. */
function elementOf(state: EditorState, node: Node): unknown {
  const binding = bindingOf(state);
  if (binding) for (const [element, mapped] of binding.mapping) if (mapped === node) return element;
  return null;
}

/** Puts a new footnote where the caret is, or in place of what's
 * selected, where the text can have one. */
export const insertFootnote: Command = (state, dispatch) => {
  const type = schema.nodes["footnote"]!;
  const { $from } = state.selection;
  if (!$from.parent.inlineContent || !$from.parent.canReplaceWith($from.index(), $from.index(), type)) return false;
  dispatch?.(state.tr.replaceSelectionWith(type.create(), false).scrollIntoView());
  return true;
};

/** The footnote just before the caret, as after inserting one. */
export function footnoteBefore(state: EditorState): number | null {
  const { $from } = state.selection;
  const before = $from.nodeBefore;
  return before?.type.name === "footnote" ? $from.pos - before.nodeSize : null;
}

/** The footnote the selection is, as after clicking its number. */
export function selectedFootnote(state: EditorState): number | null {
  const selection = state.selection;
  return selection instanceof NodeSelection && selection.node.type.name === "footnote" ? selection.from : null;
}

/** A note open for editing, in an element the bottom of its page shows. */
export class NoteEditor {
  readonly element: HTMLElement;
  readonly view: EditorView;
  /** The footnote's Yjs element. Someone else's change replaces the whole
   * document, so the footnote is found again by its element. */
  private yElement: unknown;

  constructor(
    private outer: EditorView,
    pos: number,
    private options: {
      onChange: () => void;
      onLink: () => void;
      onClose: () => void;
    },
  ) {
    const node = outer.state.doc.nodeAt(pos);
    if (node?.type.name !== "footnote") throw new Error("no footnote there");
    this.element = document.createElement("div");
    this.element.className = "docs-note-text docs-note-editing";
    const undoInOuter: Command = () => undo(this.outer.state);
    const redoInOuter: Command = () => redo(this.outer.state);
    const lineBreak: Command = (state, dispatch) => {
      dispatch?.(state.tr.replaceSelectionWith(schema.nodes["hard_break"]!.create()).scrollIntoView());
      return true;
    };
    this.view = new EditorView(this.element, {
      state: EditorState.create({
        doc: node,
        selection: TextSelection.atEnd(node),
        plugins: [
          keymap({
            // Undo takes back the document's changes, notes' among them.
            "Mod-z": undoInOuter,
            "Shift-Mod-z": redoInOuter,
            "Mod-y": redoInOuter,
            Escape: () => (this.options.onClose(), true),
            // A note is one paragraph, so Enter starts a new line in it.
            Enter: lineBreak,
            "Shift-Enter": lineBreak,
            "Mod-Enter": () => true,
            "Mod-b": toggleMark(marks["bold"]!),
            "Mod-i": toggleMark(marks["italic"]!),
            "Mod-u": toggleMark(marks["underline"]!),
            "Alt-Shift-5": toggleMark(marks["strike"]!),
            "Mod-.": toggleMark(marks["superscript"]!),
            "Mod-,": toggleMark(marks["subscript"]!),
            "Mod-\\": clearFormatting,
            "Shift-Mod-.": stepFontSize(1),
            "Shift-Mod-,": stepFontSize(-1),
            "Mod-k": () => (this.options.onLink(), true),
          }),
          keymap(baseKeymap),
        ],
      }),
      attributes: { spellcheck: "true" },
      markViews: styleMarkViews,
      dispatchTransaction: (transaction) => this.apply(transaction),
    });
    this.yElement = elementOf(outer.state, node);
    setNoteEditing(outer, {
      pos,
      element: this.element,
      sync: (next) => this.sync(next),
      relocate: (tr, state) => this.relocate(tr, state),
    });
  }

  private relocate(tr: Transaction, state: EditorState): number | undefined {
    const change = tr.getMeta(ySyncPluginKey) as { isChangeOrigin?: boolean } | undefined;
    if (!change?.isChangeOrigin || !this.yElement) return undefined;
    const node = bindingOf(state)?.mapping.get(this.yElement);
    if (!node || Array.isArray(node)) return -1;
    let found = -1;
    state.doc.descendants((each, pos) => {
      if (found >= 0) return false;
      if (each === node) found = pos;
      return found < 0 && !each.isLeaf;
    });
    return found;
  }

  /** Applies a change made in the note, and makes the same change in the
   * document. */
  private apply(transaction: Transaction) {
    const { state, transactions } = this.view.state.applyTransaction(transaction);
    this.view.updateState(state);
    if (!transaction.getMeta(FROM_DOCUMENT)) {
      const pos = noteAt(this.outer);
      if (pos !== null) {
        const outer = this.outer.state.tr;
        // Inside the note is one position after its start in the document.
        const offset = StepMap.offset(pos + 1);
        for (const each of transactions) {
          for (const step of each.steps) {
            const mapped = step.map(offset);
            if (mapped) outer.step(mapped);
          }
        }
        if (outer.docChanged) this.outer.dispatch(outer);
      }
    }
    this.options.onChange();
  }

  /** Takes in the note's text as the document has it now, after someone
   * else's change or an undo. A note that's gone closes. */
  private sync(node: Node | null) {
    if (!node) {
      // The document is in the middle of changing, so the note closes
      // once it's done.
      queueMicrotask(() => this.options.onClose());
      return;
    }
    // Changing the note can give it a new Yjs element.
    this.yElement = elementOf(this.outer.state, node) ?? this.yElement;
    const doc = this.view.state.doc;
    const start = doc.content.findDiffStart(node.content);
    if (start === null) return;
    let { a: endA, b: endB } = doc.content.findDiffEnd(node.content)!;
    const overlap = start - Math.min(endA, endB);
    if (overlap > 0) {
      endA += overlap;
      endB += overlap;
    }
    this.view.dispatch(this.view.state.tr.replace(start, endA, node.slice(start, endB)).setMeta(FROM_DOCUMENT, true));
  }

  focus() {
    this.view.focus();
  }

  close() {
    setNoteEditing(this.outer, null);
    this.view.destroy();
  }
}

/** Marks a change to an open note that came from the document. */
const FROM_DOCUMENT = "docs-note-from-document";
