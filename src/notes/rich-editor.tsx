// A note's text, edited as formatted text: headings, bold, italic, and
// underline show as they look, not as Markdown's marks, as in Google Keep.
// The file stays Markdown (rich-text.ts). Others' carets in a shared note
// show in the text, and a change from someone else keeps the reader's caret
// with its words.

import { baseKeymap, chainCommands, setBlockType, splitBlockAs, toggleMark } from "prosemirror-commands";
import { history, redo, undo } from "prosemirror-history";
import { InputRule, inputRules, undoInputRule } from "prosemirror-inputrules";
import { keymap } from "prosemirror-keymap";
import { Fragment, type MarkType, type Node, Slice } from "prosemirror-model";
import { type Command, EditorState, Plugin, PluginKey, Selection } from "prosemirror-state";
import { Decoration, DecorationSet, EditorView } from "prosemirror-view";
import { useEffect, useLayoutEffect, useRef } from "preact/hooks";

import { BoldIcon, ClearFormatIcon, ItalicIcon, UnderlineIcon } from "../docs/icons.tsx";
import { t } from "../i18n.ts";
import { Heading1Icon, Heading2Icon, NormalTextIcon } from "./icons.tsx";
import { noteSchema, offsetAt, parseNote, positionAt, sameLine, writeNote } from "./rich-text.ts";

const { nodes, marks } = noteSchema;

/** A transaction that brings in someone else's change, which isn't the
 * reader's to undo or to send back. */
const OUTSIDE = "notes-outside";

/** Someone else's caret, at an offset in the note's Markdown. */
export interface TextCaret {
  key: number;
  name: string;
  color: string;
  at: number;
}

export function RichText({
  value,
  onChange,
  readOnly = false,
  placeholder,
  label,
  autofocus = false,
  carets = [],
  onCaret,
  onView,
}: {
  /** The note's text, as Markdown. */
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  placeholder: string;
  label: string;
  autofocus?: boolean;
  carets?: readonly TextCaret[];
  /** Where the reader's caret is, as offsets in the Markdown. */
  onCaret?: (caret: { start: number; end: number }) => void;
  /** The editor, as it starts and after each change, for the formatting
   * bar; null once it's gone. */
  onView?: (view: EditorView | null) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  /** The Markdown the editor last wrote or took in. */
  const written = useRef(value);
  const latest = useRef({ onChange, onCaret, onView, readOnly });
  latest.current = { onChange, onCaret, onView, readOnly };

  useLayoutEffect(() => {
    const reportCaret = (editor: EditorView) => {
      if (!editor.hasFocus()) return;
      const { from, to } = editor.state.selection;
      latest.current.onCaret?.({ start: offsetAt(editor.state.doc, from), end: offsetAt(editor.state.doc, to) });
    };
    const editor = new EditorView(host.current, {
      state: EditorState.create({ doc: parseNote(value), plugins: plugins(placeholder) }),
      editable: () => !latest.current.readOnly,
      attributes: { class: "note-rich", "aria-label": label, "aria-multiline": "true", role: "textbox" },
      clipboardTextParser: plainLines,
      transformPastedHTML: semanticHtml,
      handleClickOn: () => false,
      handleDOMEvents: {
        // ProseMirror keeps Escape to itself. Here it goes on to close the
        // note, as it does from the title.
        keydown: (_, event) => event.key === "Escape",
        focus: (editorView) => {
          reportCaret(editorView);
          return false;
        },
        click: (editorView, event) => {
          const link = (event.target as Element).closest<HTMLElement>(".note-link");
          if (!link || !(event.ctrlKey || event.metaKey || !editorView.editable)) return false;
          const address = safeAddress(link.dataset["target"] ?? "");
          if (!address) return false;
          event.preventDefault();
          window.open(address, "_blank", "noopener,noreferrer");
          return true;
        },
      },
      dispatchTransaction(this: EditorView, transaction) {
        const state = this.state.apply(transaction);
        this.updateState(state);
        if (transaction.docChanged && !transaction.getMeta(OUTSIDE)) {
          const text = writeNote(state.doc);
          if (text !== written.current) {
            written.current = text;
            latest.current.onChange(text);
          }
        }
        if (transaction.docChanged || transaction.selectionSet) reportCaret(this);
        latest.current.onView?.(this);
      },
    });
    view.current = editor;
    if (autofocus) {
      editor.focus();
      // The caret goes at the end, as it did in the text box.
      editor.dispatch(editor.state.tr.setSelection(Selection.atEnd(editor.state.doc)));
    }
    latest.current.onView?.(editor);
    return () => {
      editor.destroy();
      view.current = null;
      latest.current.onView?.(null);
    };
  }, []);

  useEffect(() => view.current?.setProps({}), [readOnly]);

  // Someone else's change, or the draft switching from a checklist.
  useLayoutEffect(() => {
    const editor = view.current;
    if (!editor || value === written.current) return;
    written.current = value;
    const next = parseNote(value);
    // Lines are compared without the Markdown each was read from, which
    // the reader's own edits leave behind, so only what changed is
    // replaced and the reader's caret stays where it was.
    const before = withoutSources(editor.state.doc);
    const after = withoutSources(next);
    const transaction = editor.state.tr.setMeta("addToHistory", false).setMeta(OUTSIDE, true);
    // Lines that read the same, apart from formatting on spaces, which
    // Markdown can't keep, stay as they are.
    let first = 0;
    while (first < before.childCount && first < after.childCount && sameLine(before.child(first), after.child(first))) first++;
    let lastBefore = before.childCount;
    let lastAfter = after.childCount;
    while (lastBefore > first && lastAfter > first && sameLine(before.child(lastBefore - 1), after.child(lastAfter - 1))) {
      lastBefore--;
      lastAfter--;
    }
    if (first < lastBefore || first < lastAfter) {
      const from = blockPosition(before, first);
      const toBefore = blockPosition(before, lastBefore);
      const toAfter = blockPosition(after, lastAfter);
      const partBefore = before.content.cut(from, toBefore);
      const partAfter = after.content.cut(from, toAfter);
      const start = partBefore.findDiffStart(partAfter, from) ?? from;
      let { a: endOld, b: endNew } = partBefore.findDiffEnd(partAfter, toBefore, toAfter) ?? { a: toBefore, b: toAfter };
      const overlap = start - Math.min(endOld, endNew);
      if (overlap > 0) {
        endOld += overlap;
        endNew += overlap;
      }
      transaction.replace(start, endOld, next.slice(start, endNew));
    }
    // Then each line takes the Markdown it now reads from.
    next.forEach((block, offset) => {
      const source = block.attrs["source"] as string | null;
      if (transaction.doc.nodeAt(offset)?.attrs["source"] !== source) transaction.setNodeAttribute(offset, "source", source);
    });
    if (transaction.docChanged) editor.dispatch(transaction);
  }, [value]);

  // Others' carets, placed in the text as it is now.
  const caretKey = carets.map((caret) => `${caret.key}:${caret.at}:${caret.name}:${caret.color}`).join(",");
  useLayoutEffect(() => {
    const editor = view.current;
    if (!editor) return;
    const shown = carets.map((caret) => ({ ...caret }));
    editor.dispatch(editor.state.tr.setMeta(caretsKey, (doc: Node) => caretDecorations(doc, shown)));
  }, [caretKey, value]);

  return <div class="note-rich-host" ref={host} />;
}

/** Where the `index`th line starts. */
function blockPosition(doc: Node, index: number): number {
  let position = 0;
  for (let at = 0; at < index; at++) position += doc.child(at).nodeSize;
  return position;
}

/** The document with no line's Markdown remembered. */
function withoutSources(doc: Node): Node {
  const blocks: Node[] = [];
  doc.forEach((block) => blocks.push(block.type.create({ ...block.attrs, source: null }, block.content, block.marks)));
  return doc.copy(Fragment.fromArray(blocks));
}

const caretsKey = new PluginKey<DecorationSet>("note-carets");

function caretDecorations(doc: Node, carets: readonly TextCaret[]): DecorationSet {
  return DecorationSet.create(
    doc,
    carets.map((caret) =>
      Decoration.widget(Math.min(positionAt(doc, caret.at), doc.content.size - 1), () => caretElement(caret), {
        key: `${caret.key}:${caret.at}`,
        side: 1,
      }),
    ),
  );
}

/** Someone else's caret: a line in their color, with their name, which
 * shows each time it moves, then fades. */
function caretElement(caret: TextCaret): HTMLElement {
  const element = document.createElement("span");
  element.className = "docs-caret";
  element.style.setProperty("--caret", caret.color);
  const name = document.createElement("span");
  name.className = "docs-caret-name";
  name.textContent = caret.name;
  element.setAttribute("aria-hidden", "true");
  // Joiners keep the caret from splitting a word across lines.
  element.append("⁠", name, "⁠");
  return element;
}

function plugins(placeholder: string): Plugin[] {
  return [
    history(),
    inputRules({
      rules: [
        // "# " and "## " at the start of a line make headings, as in
        // Markdown, for those who know it.
        new InputRule(/^(#{1,2}) $/, (state, match, start, end) => {
          const $start = state.doc.resolve(start);
          if ($start.parent.type !== nodes["paragraph"]) return null;
          return state.tr
            .delete(start, end)
            .setBlockType(start, start, nodes["heading"]!, { level: match[1]!.length, source: null });
        }),
      ],
    }),
    keymap({
      "Mod-z": chainCommands(undoInputRule, undo),
      "Shift-Mod-z": redo,
      "Mod-y": redo,
      "Mod-b": toggleMark(marks["strong"]!),
      "Mod-i": toggleMark(marks["em"]!),
      "Mod-u": toggleMark(marks["underline"]!),
      "Mod-\\": clearFormatting,
      // Google Docs' shortcuts for styles.
      "Mod-Alt-0": setStyle(0),
      "Mod-Alt-1": setStyle(1),
      "Mod-Alt-2": setStyle(2),
      // A line of a code block from a file carries on as code, and a
      // heading's next line is normal text.
      Enter: splitBlockAs((node, atEnd) =>
        node.type === nodes["code_line"] ? { type: nodes["code_line"]! } : atEnd ? { type: nodes["paragraph"]! } : null,
      ),
    }),
    keymap(baseKeymap),
    new Plugin({
      key: caretsKey,
      state: {
        init: () => DecorationSet.empty,
        apply: (transaction, set) => {
          const build = transaction.getMeta(caretsKey) as ((doc: Node) => DecorationSet) | undefined;
          return build ? build(transaction.doc) : set.map(transaction.mapping, transaction.doc);
        },
      },
      props: { decorations: (state) => caretsKey.getState(state) },
    }),
    new Plugin({
      props: {
        decorations: (state) => {
          const decorations: Decoration[] = [];
          const doc = state.doc;
          const first = doc.firstChild;
          if (doc.childCount === 1 && first && first.content.size === 0) {
            decorations.push(Decoration.node(0, first.nodeSize, { class: "note-placeholder", "data-placeholder": placeholder }));
          }
          // Addresses typed as text show as links, as Markdown reads them.
          doc.forEach((block, offset) => {
            if (block.type === nodes["code_line"]) return;
            const text = block.textContent;
            for (const found of text.matchAll(BARE_ADDRESS)) {
              const from = offset + 1 + found.index;
              decorations.push(
                Decoration.inline(
                  from,
                  from + found[0].length,
                  { class: "note-link", "data-target": found[0] },
                  { inclusiveEnd: false },
                ),
              );
            }
          });
          return DecorationSet.create(doc, decorations);
        },
      },
    }),
  ];
}

const BARE_ADDRESS = /(?<![^\s(])(?:https?:\/\/|www\.)[^\s<]*[^\s<?!.,:;*_~)'"]/gi;

/** An address that's safe to open: a web page or an email address. */
function safeAddress(target: string): string | null {
  const trimmed = target.trim();
  if (/^www\./i.test(trimmed)) return `https://${trimmed}`;
  return /^(?:https?:\/\/|mailto:)/i.test(trimmed) ? trimmed : null;
}

/** Makes the lines the selection touches normal text (0) or a heading. */
export function setStyle(level: 0 | 1 | 2): Command {
  return (state, dispatch) => {
    const { from, to } = state.selection;
    let applies = false;
    state.doc.nodesBetween(from, to, (node) => {
      if (node.type === nodes["paragraph"] || node.type === nodes["heading"]) applies = true;
      return false;
    });
    if (!applies) return false;
    if (dispatch) {
      const transaction = state.tr;
      state.doc.nodesBetween(from, to, (node, pos) => {
        if (node.type !== nodes["paragraph"] && node.type !== nodes["heading"]) return false;
        if (level === 0) transaction.setNodeMarkup(pos, nodes["paragraph"], { source: null });
        else transaction.setNodeMarkup(pos, nodes["heading"], { level, source: null });
        return false;
      });
      dispatch(transaction.scrollIntoView());
    }
    return true;
  };
}

/** Takes bold, italic, underline, and the like off the selection, and makes
 * its lines normal text. */
export const clearFormatting: Command = (state, dispatch) => {
  const { from, to, empty } = state.selection;
  if (dispatch) {
    const transaction = state.tr;
    if (!empty) {
      for (const name of ["strong", "em", "underline", "del", "code"]) transaction.removeMark(from, to, marks[name]);
    } else {
      transaction.setStoredMarks([]);
    }
    state.doc.nodesBetween(from, to, (node, pos) => {
      if (node.type === nodes["heading"]) transaction.setNodeMarkup(pos, nodes["paragraph"], { source: null });
      return false;
    });
    dispatch(transaction);
  }
  return true;
};

/** Whether the selection, or what's typed next, has `type`. */
export function markActive(state: EditorState, type: MarkType): boolean {
  const { from, $from, to, empty } = state.selection;
  if (empty) return !!type.isInSet(state.storedMarks ?? $from.marks());
  return state.doc.rangeHasMark(from, to, type);
}

/** The style of the line with the caret: 0 for normal text, or the
 * heading's level. */
export function styleAt(state: EditorState): number {
  const parent = state.selection.$from.parent;
  return parent.type === nodes["heading"] ? (parent.attrs["level"] as number) : 0;
}

/** The bar of formatting buttons, as in Google Keep: headings, normal text,
 * bold, italic, underline, and clearing it all. */
export function FormatBar({ view }: { view: EditorView }) {
  const state = view.state;
  const style = styleAt(state);
  const run = (command: Command) => {
    command(view.state, view.dispatch);
    view.focus();
  };
  const button = (label: string, icon: preact.ComponentChild, active: boolean | null, command: Command) => (
    <button
      type="button"
      class={active ? "icon-button active" : "icon-button"}
      title={label}
      aria-label={label}
      aria-pressed={active ?? undefined}
      // Keeps the selection in the text.
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => run(command)}
    >
      {icon}
    </button>
  );
  return (
    <div class="note-format-bar" role="toolbar" aria-label={t("notes.formatting")}>
      {button(t("notes.heading1"), <Heading1Icon />, style === 1, setStyle(1))}
      {button(t("notes.heading2"), <Heading2Icon />, style === 2, setStyle(2))}
      {button(t("notes.normalText"), <NormalTextIcon />, style === 0, setStyle(0))}
      <span class="note-format-divider" aria-hidden="true" />
      {button(t("notes.bold"), <BoldIcon />, markActive(state, marks["strong"]!), toggleMark(marks["strong"]!))}
      {button(t("notes.italic"), <ItalicIcon />, markActive(state, marks["em"]!), toggleMark(marks["em"]!))}
      {button(t("notes.underline"), <UnderlineIcon />, markActive(state, marks["underline"]!), toggleMark(marks["underline"]!))}
      <span class="note-format-divider" aria-hidden="true" />
      {button(t("notes.clearFormatting"), <ClearFormatIcon />, null, clearFormatting)}
    </div>
  );
}

/** Pasted plain text, a line of the note for each line, rather than
 * ProseMirror's paragraph for each blank-line-separated block. */
function plainLines(text: string): Slice {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  return new Slice(
    Fragment.from(lines.map((line) => nodes["paragraph"]!.create(null, line ? noteSchema.text(line) : null))),
    1,
    1,
  );
}

/** Pasted HTML with bold, italic, underline, and strikethrough written as
 * tags. The page's security policy keeps the browser from reading style
 * attributes, so styles such as Google Keep's and Google Docs' spans are
 * read here first. */
export function semanticHtml(html: string): string {
  const page = new DOMParser().parseFromString(html, "text/html");
  for (const element of Array.from(page.body.querySelectorAll("[style]"))) {
    const style = (element.getAttribute("style") ?? "").toLowerCase();
    const weight = /font-weight\s*:\s*([a-z0-9]+)/.exec(style)?.[1];
    const tags: string[] = [];
    if (weight && (weight === "bold" || weight === "bolder" || Number(weight) >= 600)) tags.push("strong");
    if (/font-style\s*:\s*italic/.test(style)) tags.push("em");
    if (/text-decoration[^;]*underline/.test(style)) tags.push("u");
    if (/text-decoration[^;]*line-through/.test(style)) tags.push("s");
    let inner: Element = element;
    // Google Docs wraps everything it copies in <b style="font-weight:normal">.
    if (element.tagName === "B" && weight !== undefined && tags[0] !== "strong") {
      inner = page.createElement("span");
      inner.append(...Array.from(element.childNodes));
      element.replaceWith(inner);
    }
    for (const tag of tags) {
      const wrapper = page.createElement(tag);
      wrapper.append(...Array.from(inner.childNodes));
      inner.append(wrapper);
      inner = wrapper;
    }
  }
  return page.body.innerHTML;
}
