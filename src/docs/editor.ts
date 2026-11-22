// The document editor (decision 30): ProseMirror bound to the document's
// Yjs fragment with y-prosemirror, so everyone's edits merge, with the
// commands the toolbar and keys use.

import {
  baseKeymap,
  chainCommands,
  createParagraphNear,
  exitCode,
  lift,
  liftEmptyBlock,
  newlineInCode,
  toggleMark,
  wrapIn,
} from "prosemirror-commands";
import { dropCursor } from "prosemirror-dropcursor";
import { gapCursor } from "prosemirror-gapcursor";
import { InputRule, inputRules, textblockTypeInputRule, undoInputRule, wrappingInputRule } from "prosemirror-inputrules";
import { keymap } from "prosemirror-keymap";
import type { MarkType, Node, NodeType, ResolvedPos } from "prosemirror-model";
import { liftListItem, sinkListItem, splitListItem, wrapInList } from "prosemirror-schema-list";
import { type Command, EditorState, NodeSelection, Selection, TextSelection, type Transaction } from "prosemirror-state";
import {
  addColumnAfter,
  addColumnBefore,
  addRowAfter,
  addRowBefore,
  CellSelection,
  columnResizing,
  deleteColumn,
  deleteRow,
  deleteTable,
  goToNextCell,
  isInTable,
  mergeCells,
  selectionCell,
  setCellAttr,
  splitCell,
  tableEditing,
  toggleHeaderRow,
} from "prosemirror-tables";
import { Decoration, EditorView, type NodeView } from "prosemirror-view";
import { redo, undo, yCursorPlugin, ySyncPlugin, yUndoPlugin } from "y-prosemirror";
import type * as Y from "yjs";

import { CARET_COLORS, type LiveDocument } from "../shell/coedit.ts";
import { t } from "../i18n.ts";
import { addFonts } from "./font-faces.ts";
import type { Align, Layout } from "./layout.ts";
import {
  changeIndent,
  currentLayout,
  currentListStyle,
  currentStyle,
  inNumberedList,
  insertPageBreak,
  listsPlaceText,
  setAlign,
  setStyle,
  splitKeepingLayout,
} from "./paragraph.ts";
import { autoLink, autoLinkOnEnter, smartQuotes } from "./autoformat.ts";
import { ContentsView, contentsPlugin } from "./contents.ts";
import { findPlugin } from "./find.ts";
import { pagesPlugin, type PartKind } from "./pages.ts";
import { keepPastedStyles, schema } from "./schema.ts";
import { BORDER_ATTRS, fitTables } from "./tables.ts";
import { clearFormatting, stepFontSize, styleMarkViews, type TextStyle, textStyle } from "./text-style.ts";

const nodes = schema.nodes as Record<string, NodeType>;
const marks = schema.marks as Record<string, MarkType>;

/** The fragment y-prosemirror binds the editor to, which the server reads
 * and writes as the file (accordion-docs' `yjs::FRAGMENT`). */
export const FRAGMENT = "prosemirror";

/** Makes the editor in `mount` for `live`'s document. `onChange` runs after
 * every change, of the text or the selection, so the toolbar can follow. */
export function createEditor(
  mount: HTMLElement,
  live: LiveDocument,
  {
    readOnly,
    onChange,
    onLink,
    pictureAddress,
    onPictures,
    onAltText,
    onOpenPart,
    onOpenNote,
    onInsertFootnote,
  }: {
    readOnly: boolean;
    onChange: () => void;
    onLink: () => void;
    /** Where the picture with a hash is shown from. */
    pictureAddress: (hash: string) => string;
    /** Picture files someone pasted or dropped, to add where the caret is. */
    onPictures: (files: File[]) => void;
    /** Someone asked to change the selected picture's alt text. */
    onAltText: () => void;
    /** Someone double-clicked a sheet's header or footer. */
    onOpenPart: (kind: PartKind, sheet: number) => void;
    /** Someone clicked the note of the footnote at `pos`. */
    onOpenNote: (pos: number) => void;
    /** Someone asked for a footnote where the caret is. */
    onInsertFootnote: () => void;
  },
): EditorView {
  addFonts();
  const fragment: Y.XmlFragment = live.doc.getXmlFragment(FRAGMENT);
  const state = EditorState.create({
    schema,
    plugins: [
      ySyncPlugin(fragment),
      yCursorPlugin(live.awareness, { cursorBuilder, selectionBuilder }),
      yUndoPlugin(),
      keymap({ Enter: autoLinkOnEnter, "Shift-Enter": autoLinkOnEnter }),
      // Google Docs' shortcut for a footnote.
      keymap({ "Mod-Alt-f": () => (onInsertFootnote(), true) }),
      keymap(keys(onLink, onAltText)),
      keymap(baseKeymap),
      typingShortcuts(),
      listsPlaceText(),
      findPlugin(),
      dropCursor(),
      gapCursor(),
      columnResizing(),
      tableEditing(),
      contentsPlugin(),
      pagesPlugin(mount, onOpenPart, onOpenNote),
    ],
  });
  const view: EditorView = new EditorView(mount, {
    state,
    editable: () => !readOnly,
    attributes: { class: "docs-text", spellcheck: "true" },
    nodeViews: {
      check_item: (node, editorView, getPos) => new CheckItemView(node, editorView, getPos),
      page_break: () => pageBreakView(),
      image: (node, editorView, getPos) => new ImageView(node, editorView, getPos, pictureAddress, !readOnly, onAltText),
      footnote: () => footnoteView(),
      table_of_contents: (node, editorView, getPos, decorations) =>
        new ContentsView(node, editorView, getPos, decorations, !readOnly),
    },
    markViews: styleMarkViews,
    transformPastedHTML: keepPastedStyles,
    transformPasted: (slice, editorView) => fitTables(slice, textWidth(editorView)),
    handlePaste(editorView, event) {
      const files = pictureFiles(event.clipboardData);
      if (!files.length || !editorView.editable) return false;
      onPictures(files);
      return true;
    },
    handleDrop(editorView, event) {
      const files = pictureFiles(event.dataTransfer);
      if (!files.length || !editorView.editable) return false;
      event.preventDefault();
      // The pictures go where they were dropped.
      const at = editorView.posAtCoords({
        left: event.clientX,
        top: event.clientY,
      });
      if (at) editorView.dispatch(editorView.state.tr.setSelection(Selection.near(editorView.state.doc.resolve(at.pos))));
      onPictures(files);
      return true;
    },
    // y-prosemirror dispatches while the view is still being made, so this
    // uses the view it's called on.
    dispatchTransaction(this: EditorView, transaction: Transaction) {
      this.updateState(this.state.apply(transaction));
      onChange();
    },
  });
  return view;
}

/** An editor in `mount` for a header or footer, the fragment `name` of
 * `live`'s document. Escape closes it. */
export function createPartEditor(
  mount: HTMLElement,
  live: LiveDocument,
  name: string,
  {
    onChange,
    onLink,
    onClose,
    pictureAddress,
  }: { onChange: () => void; onLink: () => void; onClose: () => void; pictureAddress: (hash: string) => string },
): EditorView {
  const state = EditorState.create({
    schema,
    plugins: [
      ySyncPlugin(live.doc.getXmlFragment(name)),
      yUndoPlugin(),
      // Pages don't break in a header.
      keymap({ Escape: () => (onClose(), true), "Mod-Enter": () => true }),
      keymap({ Enter: autoLinkOnEnter, "Shift-Enter": autoLinkOnEnter }),
      keymap(keys(onLink, () => undefined)),
      keymap(baseKeymap),
      typingShortcuts(),
      listsPlaceText(),
      dropCursor(),
      gapCursor(),
      columnResizing(),
      tableEditing(),
    ],
  });
  return new EditorView(mount, {
    state,
    attributes: { class: "docs-text docs-part", spellcheck: "true" },
    nodeViews: {
      check_item: (node, editorView, getPos) => new CheckItemView(node, editorView, getPos),
      image: (node, editorView, getPos) => new ImageView(node, editorView, getPos, pictureAddress, true, () => undefined),
    },
    markViews: styleMarkViews,
    transformPastedHTML: keepPastedStyles,
    transformPasted: (slice, editorView) => fitTables(slice, textWidth(editorView)),
    dispatchTransaction(this: EditorView, transaction: Transaction) {
      this.updateState(this.state.apply(transaction));
      onChange();
    },
  });
}

/** Puts a page number or the number of pages where the caret is, in a
 * header or footer. */
export function insertField(kind: "page" | "pages"): Command {
  return (state, dispatch) => {
    const mark = marks["field"]!.create({ kind });
    dispatch?.(state.tr.replaceSelectionWith(schema.text("#", [...state.selection.$from.marks(), mark]), false).scrollIntoView());
    return true;
  };
}

/** A copy of `doc` that can't be changed, on pages in `mount`, for
 * printing. */
export function createPrintView(mount: HTMLElement, doc: Node, pictureAddress: (hash: string) => string): EditorView {
  const state = EditorState.create({ schema, doc, plugins: [contentsPlugin(), pagesPlugin(mount)] });
  return new EditorView(mount, {
    state,
    editable: () => false,
    attributes: { class: "docs-text" },
    nodeViews: {
      check_item: (node, editorView, getPos) => new CheckItemView(node, editorView, getPos),
      page_break: () => pageBreakView(),
      image: (node, editorView, getPos) => new ImageView(node, editorView, getPos, pictureAddress, false, () => undefined),
      footnote: () => footnoteView(),
      table_of_contents: (node, editorView, getPos, decorations) =>
        new ContentsView(node, editorView, getPos, decorations, false),
    },
    markViews: styleMarkViews,
  });
}

/** A footnote's number in the text. The style sheet numbers footnotes in
 * order; its note shows at the bottom of the page (pages.ts). */
function footnoteView(): NodeView {
  const dom = document.createElement("sup");
  dom.className = "docs-footnote-ref";
  return {
    dom,
    update: (node) => node.type.name === "footnote",
    ignoreMutation: () => true,
  };
}

/** Someone else's caret: a line in their color, with their name. Colors go
 * through the element's style properties, since the page's security policy
 * doesn't allow style attributes. */
function cursorBuilder(user: { name: string; color: string }): HTMLElement {
  const caret = document.createElement("span");
  caret.className = "docs-caret";
  caret.style.setProperty("--caret", user.color);
  const name = document.createElement("span");
  name.className = "docs-caret-name";
  name.textContent = user.name;
  // Joiners keep the caret from splitting a word across lines.
  caret.append("⁠", name, "⁠");
  return caret;
}

/** Someone else's selection, shaded in their color, by class for the same
 * reason. */
function selectionBuilder(user: { color: string }) {
  const index = Math.max(0, CARET_COLORS.indexOf(user.color));
  return {
    class: `docs-selection docs-color-${index}`,
    nodeName: "span",
  } as Parameters<typeof Decoration.inline>[2];
}

function keys(onLink: () => void, onAltText: () => void): Record<string, Command> {
  const splitItem = chainCommands(splitListItem(nodes["list_item"]!), splitListItem(nodes["check_item"]!, { checked: false }));
  const sink = chainCommands(sinkListItem(nodes["list_item"]!), sinkListItem(nodes["check_item"]!));
  const liftItem = chainCommands(liftListItem(nodes["list_item"]!), liftListItem(nodes["check_item"]!));
  const lineBreak = chainCommands(exitCode, (state, dispatch) => {
    dispatch?.(state.tr.replaceSelectionWith(nodes["hard_break"]!.create()).scrollIntoView());
    return true;
  });
  return {
    // Right after a change made while typing, such as a curly quote or a
    // link, Ctrl+Z takes back only that, as in Google Docs.
    "Mod-z": chainCommands(undoInputRule, undo),
    "Shift-Mod-z": redo,
    "Mod-y": redo,
    "Mod-b": toggleMark(marks["bold"]!),
    "Mod-i": toggleMark(marks["italic"]!),
    "Mod-u": toggleMark(marks["underline"]!),
    "Alt-Shift-5": toggleMark(marks["strike"]!),
    // Google Docs' shortcuts for lists.
    "Shift-Mod-7": toggleList("numbers"),
    "Shift-Mod-8": toggleList("bullets"),
    "Shift-Mod-9": toggleList("checks"),
    "Mod-e": toggleMark(marks["code"]!),
    // Google Docs' shortcuts for these.
    "Mod-.": toggleMark(marks["superscript"]!),
    "Mod-,": toggleMark(marks["subscript"]!),
    "Mod-\\": clearFormatting,
    "Shift-Mod-.": stepFontSize(1),
    "Shift-Mod-,": stepFontSize(-1),
    "Mod-k": () => {
      onLink();
      return true;
    },
    // Google Docs' shortcut for a picture's alt text.
    "Mod-Alt-y": (state) => {
      if (!selectedPicture(state)) return false;
      onAltText();
      return true;
    },
    // Google Docs' shortcuts for styles, alignment, and page breaks.
    "Mod-Alt-0": setStyle("paragraph"),
    "Mod-Alt-1": setStyle("heading-1"),
    "Mod-Alt-2": setStyle("heading-2"),
    "Mod-Alt-3": setStyle("heading-3"),
    "Mod-Alt-4": setStyle("heading-4"),
    "Mod-Alt-5": setStyle("heading-5"),
    "Mod-Alt-6": setStyle("heading-6"),
    "Shift-Mod-l": setAlign("left"),
    "Shift-Mod-e": setAlign("center"),
    "Shift-Mod-r": setAlign("right"),
    "Shift-Mod-j": setAlign("justify"),
    Enter: chainCommands(splitItem, newlineInCode, createParagraphNear, liftEmptyBlock, splitKeepingLayout),
    "Shift-Enter": lineBreak,
    "Mod-Enter": chainCommands(exitCode, insertPageBreak),
    Tab: chainCommands(goToNextCell(1), tabInLastCell, sink),
    "Shift-Tab": chainCommands(goToNextCell(-1), liftItem),
    "Mod-]": changeIndent(1),
    "Mod-[": changeIndent(-1),
  };
}

/** Markdown-style shortcuts at the start of a line: `# ` for a heading,
 * `- ` for a list, `[] ` for a checklist, and so on, then curly quotes and
 * links (autoformat.ts). */
function typingShortcuts() {
  return inputRules({
    rules: [
      textblockTypeInputRule(/^(#{1,3})\s$/, nodes["heading"]!, (match) => ({
        level: match[1]!.length,
      })),
      wrappingInputRule(/^\s*>\s$/, nodes["blockquote"]!),
      wrappingInputRule(/^\s*([-+*])\s$/, nodes["bullet_list"]!),
      wrappingInputRule(
        /^(\d+)\.\s$/,
        nodes["ordered_list"]!,
        (match) => ({ order: Number(match[1]) }),
        (match, node) => node.childCount + (node.attrs["order"] as number) === Number(match[1]),
      ),
      wrappingInputRule(/^\s*\[\s?\]\s$/, nodes["check_list"]!),
      textblockTypeInputRule(/^```$/, nodes["code_block"]!),
      new InputRule(/^---$/, (state, _match, start, end) => {
        const $start = state.doc.resolve(start);
        if ($start.parent.type !== nodes["paragraph"] || $start.depth < 1) return null;
        const before = $start.before();
        return state.tr
          .delete(start, end)
          .insert(before, nodes["horizontal_rule"]!.create())
          .scrollIntoView();
      }),
      ...smartQuotes,
      // Last, since the shortcuts above also end with a space.
      autoLink,
    ],
  });
}

/** The kinds of picture the server takes. */
export const PICTURE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

/** The picture files in a paste or a drop. */
function pictureFiles(data: DataTransfer | null): File[] {
  return [...(data?.files ?? [])].filter((file) => PICTURE_TYPES.includes(file.type));
}

/** Adds a picture by its hash where the caret is, on a line of its own,
 * with the caret after it. Nothing after it means an empty line for the
 * caret, so the next picture or text doesn't replace this one. */
export function insertPicture(hash: string): Command {
  return (state, dispatch) => {
    const tr = state.tr.replaceSelectionWith(nodes["image"]!.create({ src: hash }));
    if (!(tr.selection instanceof TextSelection)) {
      const end = tr.selection.to;
      tr.insert(end, nodes["paragraph"]!.create());
      tr.setSelection(TextSelection.create(tr.doc, end + 1));
    }
    dispatch?.(tr.scrollIntoView());
    return true;
  };
}

/** A picture, shown from the document's pictures by its hash. Its width
 * is an attribute, not a style, since the page's security policy doesn't
 * allow style attributes. While it's selected, an editor can drag its
 * corners to resize it, keeping its shape, and has buttons for its alt text
 * and its own size. */
class ImageView implements NodeView {
  dom: HTMLElement;
  private img: HTMLImageElement;
  private resizing = false;

  constructor(
    private node: Node,
    private view: EditorView,
    private getPos: () => number | undefined,
    private address: (hash: string) => string,
    editable: boolean,
    onAltText: () => void,
  ) {
    this.dom = document.createElement("div");
    this.dom.className = "docs-picture-frame";
    this.img = document.createElement("img");
    this.img.className = "docs-picture";
    this.dom.append(this.img);
    if (editable) {
      for (const corner of ["top-left", "top-right", "bottom-left", "bottom-right"] as const) {
        const handle = document.createElement("span");
        handle.className = `docs-picture-handle ${corner}`;
        handle.title = t("docs.resizePicture");
        handle.addEventListener("pointerdown", (event) => this.resize(event, corner.endsWith("left") ? -1 : 1));
        this.dom.append(handle);
      }
      const bar = document.createElement("span");
      bar.className = "docs-picture-bar";
      bar.append(
        barButton(t("docs.altText"), () => {
          this.select();
          onAltText();
        }),
        barButton(t("docs.resetSize"), () => this.setWidth(null)),
      );
      this.dom.append(bar);
    }
    this.show(node);
  }

  private show(node: Node) {
    this.node = node;
    this.img.src = this.address(node.attrs["src"] as string);
    this.img.alt = node.attrs["alt"] as string;
    const width = node.attrs["width"] as number | null;
    if (width) this.img.width = width;
    else this.img.removeAttribute("width");
  }

  update(node: Node): boolean {
    if (node.type !== this.node.type) return false;
    if (node.attrs["src"] !== this.node.attrs["src"] || node.attrs["alt"] !== this.node.attrs["alt"] || node.attrs["width"] !== this.node.attrs["width"]) {
      this.show(node);
    }
    return true;
  }

  /** Drags a corner: the picture follows the pointer across, as wide as the
   * text at most, and its height follows. `sign` is -1 for a left corner. */
  private resize(start: PointerEvent, sign: 1 | -1) {
    start.preventDefault();
    start.stopPropagation();
    const handle = start.currentTarget as HTMLElement;
    handle.setPointerCapture(start.pointerId);
    const from = this.img.getBoundingClientRect().width;
    const most = Math.max(MIN_PICTURE_WIDTH, this.dom.parentElement?.clientWidth ?? from);
    this.resizing = true;
    this.dom.classList.add("resizing");
    const move = (event: PointerEvent) => {
      const width = Math.round(from + sign * (event.clientX - start.clientX));
      this.img.width = Math.min(most, Math.max(MIN_PICTURE_WIDTH, width));
    };
    const finish = (event: PointerEvent) => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", finish);
      handle.removeEventListener("pointercancel", finish);
      this.resizing = false;
      this.dom.classList.remove("resizing");
      if (event.type === "pointerup" && Math.abs(this.img.width - from) >= 1) this.setWidth(this.img.width);
      else this.show(this.node);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
  }

  /** Sets the picture's width, or its own size for null, and keeps it
   * selected. */
  private setWidth(width: number | null) {
    const pos = this.getPos();
    if (pos === undefined) return;
    const tr = this.view.state.tr.setNodeAttribute(pos, "width", width);
    this.view.dispatch(tr.setSelection(NodeSelection.create(tr.doc, pos)));
    this.view.focus();
  }

  private select() {
    const pos = this.getPos();
    if (pos === undefined) return;
    this.view.dispatch(this.view.state.tr.setSelection(NodeSelection.create(this.view.state.doc, pos)));
  }

  /** The handles and buttons are the picture's own, not the editor's. */
  stopEvent(event: Event): boolean {
    const target = event.target as HTMLElement | null;
    return this.resizing || !!target?.closest(".docs-picture-handle, .docs-picture-bar");
  }

  ignoreMutation(): boolean {
    return true;
  }
}

/** Narrower than this, a picture is hard to see or to grab. */
const MIN_PICTURE_WIDTH = 24;

function barButton(label: string, onSelect: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  // Focus stays in the document, with the picture selected, so a dialog
  // gives it back to the picture when it closes.
  button.tabIndex = -1;
  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", (event) => {
    event.preventDefault();
    onSelect();
  });
  return button;
}

/** A picture in the document: where it is when found, and its hash, to
 * find it again if others' edits move it. */
export interface PictureAt {
  pos: number;
  src: string;
  alt: string;
}

/** The selected picture, if a picture is selected. */
export function selectedPicture(state: EditorState): PictureAt | null {
  const { selection } = state;
  if (!(selection instanceof NodeSelection) || selection.node.type !== nodes["image"]) return null;
  return {
    pos: selection.from,
    src: selection.node.attrs["src"] as string,
    alt: selection.node.attrs["alt"] as string,
  };
}

/** Where `picture` is now: where it was, or the first picture with its
 * hash. */
function findPicture(doc: Node, picture: PictureAt): number | null {
  const isIt = (node: Node | null | undefined) => !!node && node.type === nodes["image"] && node.attrs["src"] === picture.src;
  if (picture.pos <= doc.content.size && isIt(doc.nodeAt(picture.pos))) return picture.pos;
  let found: number | null = null;
  doc.descendants((node, pos) => {
    if (found === null && isIt(node)) found = pos;
    return found === null;
  });
  return found;
}

/** The longest alt text the server keeps (accordion-docs' `MAX_ALT`). */
export const MAX_ALT = 1000;

/** Selects `picture` again, first setting its alt text, which says what it
 * shows to someone who can't see it, if `alt` is given. */
export function selectPicture(picture: PictureAt, alt?: string): Command {
  return (state, dispatch) => {
    const pos = findPicture(state.doc, picture);
    if (pos === null) return false;
    const tr = alt === undefined ? state.tr : state.tr.setNodeAttribute(pos, "alt", alt.trim().slice(0, MAX_ALT));
    dispatch?.(tr.setSelection(NodeSelection.create(tr.doc, pos)));
    return true;
  };
}

/** A page break: a dashed line across the page, named, where printing
 * starts a new page. */
function pageBreakView(): NodeView {
  const dom = document.createElement("div");
  dom.className = "page-break";
  dom.contentEditable = "false";
  const label = document.createElement("span");
  label.className = "docs-page-break-label";
  label.textContent = t("docs.pageBreak");
  dom.append(label);
  return { dom };
}

/** A checklist item with a checkbox people can select, even while others
 * type in the item. */
class CheckItemView implements NodeView {
  dom: HTMLLIElement;
  contentDOM: HTMLElement;
  private box: HTMLInputElement;

  constructor(
    private node: Node,
    view: EditorView,
    getPos: () => number | undefined,
  ) {
    this.dom = document.createElement("li");
    this.dom.className = "docs-check-item";
    const label = document.createElement("span");
    label.className = "docs-check";
    label.contentEditable = "false";
    this.box = document.createElement("input");
    this.box.type = "checkbox";
    this.box.setAttribute("aria-label", t("docs.checkItem"));
    this.box.addEventListener("mousedown", (event) => event.preventDefault());
    this.box.addEventListener("change", () => {
      const pos = getPos();
      if (!view.editable || pos === undefined) {
        this.box.checked = this.node.attrs["checked"] as boolean;
        return;
      }
      view.dispatch(
        view.state.tr.setNodeMarkup(pos, undefined, {
          ...this.node.attrs,
          checked: this.box.checked,
        }),
      );
    });
    label.append(this.box);
    this.contentDOM = document.createElement("div");
    this.contentDOM.className = "docs-check-text";
    this.dom.append(label, this.contentDOM);
    this.show(node);
  }

  private show(node: Node) {
    const checked = node.attrs["checked"] as boolean;
    this.box.checked = checked;
    this.dom.dataset["checked"] = String(checked);
  }

  update(node: Node): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.show(node);
    return true;
  }

  stopEvent(event: Event): boolean {
    return event.target === this.box;
  }

  ignoreMutation(mutation: MutationRecord | { type: "selection"; target: globalThis.Node }): boolean {
    return mutation.type !== "selection" && !this.contentDOM.contains(mutation.target);
  }
}

/** What the toolbar shows for where the selection is. */
export interface Formatting {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  code: boolean;
  link: string | null;
  /** "paragraph", "title", "subtitle", "heading-1" to "heading-6", or
   * "code". */
  style: string;
  /** The paragraph's layout, outside code. */
  layout: Layout | null;
  align: Align | null;
  list: "bullets" | "numbers" | "checks" | null;
  /** The list's own style, if it has one. */
  listStyle: string | null;
  numbered: boolean;
  quote: boolean;
  table: boolean;
  /** The selected cells, in a table. */
  cell: CellFormat | null;
  /** Font, size, colors, superscript, and subscript. */
  text: TextStyle;
}

export function formatting(state: EditorState): Formatting {
  const { from, to, empty, $from } = state.selection;
  const has = (type: MarkType) =>
    empty ? !!type.isInSet(state.storedMarks ?? $from.marks()) : state.doc.rangeHasMark(from, to, type);
  const linkMark = (empty ? $from.marks() : state.doc.resolve(from + 1 > to ? from : from + 1).marks()).find(
    (mark) => mark.type === marks["link"],
  );
  const layout = currentLayout(state);
  const list = listAround($from);
  return {
    bold: has(marks["bold"]!),
    italic: has(marks["italic"]!),
    underline: has(marks["underline"]!),
    strike: has(marks["strike"]!),
    code: has(marks["code"]!),
    link: (linkMark?.attrs["href"] as string | undefined) ?? null,
    style: currentStyle(state),
    layout,
    align: layout?.align ?? null,
    listStyle: currentListStyle(state),
    numbered: inNumberedList(state),
    list:
      list?.node.type === nodes["bullet_list"]
        ? "bullets"
        : list?.node.type === nodes["ordered_list"]
          ? "numbers"
          : list
            ? "checks"
            : null,
    quote: ancestor($from, nodes["blockquote"]!) !== null,
    table: isInTable(state),
    cell: cellFormat(state),
    text: textStyle(state),
  };
}

export interface CellFormat {
  /** The cells' color, or null for none or for more than one. */
  color: string | null;
  /** Whether the selected cells can become one. */
  merge: boolean;
  /** Whether the cell is merged, so it can be split again. */
  split: boolean;
  /** Whether any side of the cells has a line, and whether any has none. */
  lines: boolean;
  lineless: boolean;
}

/** Calls `each` with each selected cell and its position. */
function eachSelectedCell(state: EditorState, each: (cell: Node, pos: number) => void) {
  const selection = state.selection;
  if (selection instanceof CellSelection) {
    selection.forEachCell(each);
  } else {
    const $cell = selectionCell(state);
    if ($cell.nodeAfter) each($cell.nodeAfter, $cell.pos);
  }
}

function cellFormat(state: EditorState): CellFormat | null {
  if (!isInTable(state)) return null;
  const colors = new Set<string | null>();
  let lines = false;
  let lineless = false;
  eachSelectedCell(state, (cell) => {
    colors.add(cell.attrs["background"] as string | null);
    for (const name of BORDER_ATTRS) {
      if (cell.attrs[name] === 0) lineless = true;
      else lines = true;
    }
  });
  return {
    color: colors.size === 1 ? [...colors][0]! : null,
    merge: mergeCells(state),
    split: splitCell(state),
    lines,
    lineless,
  };
}

/** Gives the selected cells the usual lines on every side, with true, or
 * none, as a table laid out without lines has. */
function showCellBorders(shown: boolean): Command {
  return (state, dispatch) => {
    if (!isInTable(state)) return false;
    if (dispatch) {
      const tr = state.tr;
      eachSelectedCell(state, (cell, pos) => {
        const attrs: Record<string, unknown> = { ...cell.attrs, border_color: null };
        for (const name of BORDER_ATTRS) attrs[name] = shown ? null : 0;
        tr.setNodeMarkup(pos, null, attrs);
      });
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

/** The cell the selection starts in, on the page, for the cell color
 * picker to open beside. */
export function selectedCellElement(view: EditorView): HTMLElement | null {
  if (!isInTable(view.state)) return null;
  const node = view.nodeDOM(selectionCell(view.state).pos);
  return node instanceof HTMLElement ? node : null;
}

const LISTS = () => [nodes["bullet_list"]!, nodes["ordered_list"]!, nodes["check_list"]!];

/** The nearest list the selection is in, and where it starts. */
function listAround($pos: ResolvedPos): { node: Node; pos: number } | null {
  for (let depth = $pos.depth; depth > 0; depth--) {
    const node = $pos.node(depth);
    if (LISTS().includes(node.type)) return { node, pos: $pos.before(depth) };
  }
  return null;
}

function ancestor($pos: ResolvedPos, type: NodeType): Node | null {
  for (let depth = $pos.depth; depth > 0; depth--) {
    if ($pos.node(depth).type === type) return $pos.node(depth);
  }
  return null;
}

export const toggle = {
  superscript: () => toggleMark(marks["superscript"]!),
  subscript: () => toggleMark(marks["subscript"]!),
  bold: () => toggleMark(marks["bold"]!),
  italic: () => toggleMark(marks["italic"]!),
  underline: () => toggleMark(marks["underline"]!),
  strike: () => toggleMark(marks["strike"]!),
  code: () => toggleMark(marks["code"]!),
};

/** Turns the list `kind` on or off where the selection is. A different
 * kind of list changes into this one. */
export function toggleList(kind: "bullets" | "numbers" | "checks"): Command {
  const listType = {
    bullets: nodes["bullet_list"]!,
    numbers: nodes["ordered_list"]!,
    checks: nodes["check_list"]!,
  }[kind];
  const itemType = kind === "checks" ? nodes["check_item"]! : nodes["list_item"]!;
  return (state, dispatch, view) => {
    const around = listAround(state.selection.$from);
    if (around?.node.type === listType) return liftListItem(itemType)(state, dispatch, view);
    if (around && around.node.type !== nodes["check_list"] && kind !== "checks") {
      // Bullets and numbers have the same items, so the list just changes.
      dispatch?.(state.tr.setNodeMarkup(around.pos, listType));
      return true;
    }
    if (around) {
      // Checklist items and list items differ: out of one list, into the
      // other, in one transaction, so undo takes both back.
      const otherItem = around.node.type === nodes["check_list"] ? nodes["check_item"]! : nodes["list_item"]!;
      let lifting: Transaction | null = null;
      liftListItem(otherItem)(state, (tr) => (lifting = tr));
      if (!lifting) return false;
      const lifted: Transaction = lifting;
      let wrapping: Transaction | null = null;
      wrapInList(listType)(state.apply(lifted), (tr) => (wrapping = tr));
      if (!wrapping) return false;
      const wrapped: Transaction = wrapping;
      if (dispatch) {
        wrapped.steps.forEach((step) => lifted.step(step));
        lifted.setSelection(Selection.fromJSON(lifted.doc, wrapped.selection.toJSON()));
        dispatch(lifted.scrollIntoView());
      }
      return true;
    }
    return wrapInList(listType)(state, dispatch, view);
  };
}

export function toggleQuote(): Command {
  return (state, dispatch, view) =>
    ancestor(state.selection.$from, nodes["blockquote"]!) ? lift(state, dispatch, view) : wrapIn(nodes["blockquote"]!)(state, dispatch, view);
}

/** A horizontal line, with the caret after it, on an empty line if
 * nothing follows, so what's typed or added next doesn't replace it. */
export const insertRule: Command = (state, dispatch) => {
  const tr = state.tr.replaceSelectionWith(nodes["horizontal_rule"]!.create());
  if (!(tr.selection instanceof TextSelection)) {
    const end = tr.selection.to;
    tr.insert(end, nodes["paragraph"]!.create());
    tr.setSelection(TextSelection.create(tr.doc, end + 1));
  }
  dispatch?.(tr.scrollIntoView());
  return true;
};

/** How wide the editor's text is, in pixels, inside its padding. */
function textWidth(view: EditorView): number {
  const style = getComputedStyle(view.dom);
  return view.dom.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0);
}

/** A table of three columns and three rows, the first a heading row, with
 * the caret in its first cell. */
export const insertTable: Command = (state, dispatch) => {
  const cell = (type: NodeType) => type.createAndFill()!;
  const row = (type: NodeType) => nodes["table_row"]!.create(null, [cell(type), cell(type), cell(type)]);
  const table = nodes["table"]!.create(null, [row(nodes["table_header"]!), row(nodes["table_cell"]!), row(nodes["table_cell"]!)]);
  const tr = state.tr.replaceSelectionWith(table);
  // The selection ends up after the table's last cell. Its start is found
  // from there.
  const $end = tr.selection.$from;
  for (let depth = $end.depth; depth > 0; depth--) {
    if ($end.node(depth).type === nodes["table"]) {
      tr.setSelection(TextSelection.near(tr.doc.resolve($end.before(depth) + 1)));
      break;
    }
  }
  dispatch?.(tr.scrollIntoView());
  return true;
};

/** Tab in a table's last cell adds a row and moves to it, as in Google
 * Docs. */
const tabInLastCell: Command = (state, dispatch) => {
  if (!isInTable(state)) return false;
  let adding: Transaction | null = null;
  addRowAfter(state, (tr) => (adding = tr));
  if (!adding) return false;
  const added: Transaction = adding;
  let moving: Transaction | null = null;
  goToNextCell(1)(state.apply(added), (tr) => (moving = tr));
  if (!moving) return false;
  const moved: Transaction = moving;
  if (dispatch) {
    added.setSelection(Selection.fromJSON(added.doc, moved.selection.toJSON()));
    dispatch(added.scrollIntoView());
  }
  return true;
};

export const tableCommands = {
  rowAbove: addRowBefore,
  rowBelow: addRowAfter,
  columnLeft: addColumnBefore,
  columnRight: addColumnAfter,
  deleteRow,
  deleteColumn,
  deleteTable,
  headerRow: toggleHeaderRow,
  merge: mergeCells,
  unmerge: splitCell,
  /** Colors the selected cells, or takes their color off with null. */
  cellColor: (color: string | null) => setCellAttr("background", color),
  showBorders: showCellBorders(true),
  hideBorders: showCellBorders(false),
};

export { redo, undo };

/** The range of the link around the selection, or the selection itself. */
function linkRange(state: EditorState): { from: number; to: number } {
  const { from, to, empty, $from } = state.selection;
  if (!empty) return { from, to };
  const link = marks["link"]!;
  const parent = $from.parent;
  const start = $from.parentOffset;
  let rangeFrom = from;
  let rangeTo = to;
  parent.forEach((child, offset) => {
    const end = offset + child.nodeSize;
    if (offset <= start && start <= end && link.isInSet(child.marks)) {
      rangeFrom = $from.start() + offset;
      rangeTo = $from.start() + end;
    }
  });
  return { from: rangeFrom, to: rangeTo };
}

/** Links the selection, or the link around the caret, to `href`. With
 * nothing selected and no link there, the address goes in as its own
 * linked text. */
export function setLink(href: string): Command {
  return (state, dispatch) => {
    const link = marks["link"]!.create({ href });
    const range = linkRange(state);
    const tr = state.tr;
    if (range.from === range.to) {
      tr.insertText(href, range.from).addMark(range.from, range.from + href.length, link);
    } else {
      tr.removeMark(range.from, range.to, marks["link"]!).addMark(range.from, range.to, link);
    }
    dispatch?.(tr.scrollIntoView());
    return true;
  };
}

export const removeLink: Command = (state, dispatch) => {
  const range = linkRange(state);
  if (range.from === range.to) return false;
  dispatch?.(state.tr.removeMark(range.from, range.to, marks["link"]!));
  return true;
};

/** The selected text, for a link's address when it looks like one. */
export function selectedText(state: EditorState): string {
  const { from, to } = state.selection;
  return state.doc.textBetween(from, to, " ");
}
