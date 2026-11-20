// Commands for paragraphs: styles, alignment, indents, spacing, list
// styles, and page breaks. Each applies to every paragraph and heading the
// selection touches, as in Google Docs.

import type { Attrs, Node, NodeType, ResolvedPos } from "prosemirror-model";
import { setBlockType } from "prosemirror-commands";
import { liftListItem, sinkListItem, wrapInList } from "prosemirror-schema-list";
import { type Command, type EditorState, NodeSelection, Plugin, TextSelection, type Transaction } from "prosemirror-state";
import { ySyncPluginKey } from "y-prosemirror";

import {
  ADDED_SPACE,
  type Align,
  BULLET_STYLES,
  type BulletStyle,
  DEFAULT_LINE,
  INDENT_STEP,
  LAYOUT_ATTRS,
  type Layout,
  layoutOf,
  MAX_INDENT,
  MAX_LINE,
  MAX_SPACE,
  MIN_LINE,
  type NumberStyle,
  styleSpacing,
  twentieths,
} from "./layout.ts";
import { schema } from "./schema.ts";

const nodes = schema.nodes as Record<string, NodeType>;

/** The paragraphs and headings the selection touches, with where each
 * starts. */
function textblocks(state: EditorState): { node: Node; pos: number }[] {
  const found: { node: Node; pos: number }[] = [];
  const { from, to } = state.selection;
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.type === nodes["paragraph"] || node.type === nodes["heading"]) {
      found.push({ node, pos });
      return false;
    }
    return true;
  });
  return found;
}

/** Changes every paragraph and heading in the selection with `change`,
 * which returns its new attributes, or null to leave it. */
function eachBlock(change: (node: Node) => Attrs | null): Command {
  return (state, dispatch) => {
    const blocks = textblocks(state);
    if (!blocks.length) return false;
    if (dispatch) {
      const tr = state.tr;
      for (const { node, pos } of blocks) {
        const attrs = change(node);
        if (attrs) tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs });
      }
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

/** The layout of the paragraph or heading where the selection starts. */
export function currentLayout(state: EditorState): Layout | null {
  const parent = state.selection.$from.parent;
  return parent.type === nodes["paragraph"] || parent.type === nodes["heading"] ? layoutOf(parent) : null;
}

/** The style where the selection starts: "paragraph", "title",
 * "subtitle", "heading-1" to "heading-6", or "code". */
export function currentStyle(state: EditorState): string {
  const parent = state.selection.$from.parent;
  if (parent.type === nodes["heading"]) return `heading-${parent.attrs["level"] as number}`;
  if (parent.type === nodes["code_block"]) return "code";
  return (parent.attrs["kind"] as string | null) ?? "paragraph";
}

/** The layout attributes a block keeps when its style changes. */
function keptLayout(node: Node): Attrs {
  const kept: Record<string, unknown> = {};
  for (const name of Object.keys(LAYOUT_ATTRS)) {
    if (name in node.attrs) kept[name] = node.attrs[name];
  }
  return kept;
}

/** Sets the style of each block in the selection, keeping its alignment,
 * indents, and spacing. Code takes the text plain. */
export function setStyle(style: string): Command {
  return (state, dispatch) => {
    if (style === "code") return setBlockType(nodes["code_block"]!)(state, dispatch);
    const heading = /^heading-(\d)$/.exec(style);
    const type = heading ? nodes["heading"]! : nodes["paragraph"]!;
    const own: Attrs = heading ? { level: Number(heading[1]) } : { kind: style === "title" || style === "subtitle" ? style : null };
    const { from, to } = state.selection;
    const found: { node: Node; pos: number }[] = [];
    state.doc.nodesBetween(from, to, (node, pos) => {
      if (node.isTextblock) {
        found.push({ node, pos });
        return false;
      }
      return true;
    });
    if (!found.length) return false;
    if (dispatch) {
      const tr = state.tr;
      for (const { node, pos } of found) {
        if (node.type === nodes["code_block"]) {
          // Code has no layout, and its lines become a paragraph's.
          tr.setBlockType(tr.mapping.map(pos) + 1, tr.mapping.map(pos + node.nodeSize) - 1, type, own);
        } else {
          tr.setNodeMarkup(tr.mapping.map(pos), type, { ...keptLayout(node), ...own });
        }
      }
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

export function setAlign(align: Align): Command {
  return eachBlock(() => ({ align: align === "left" ? null : align }));
}

/** One step in or out: a list item moves a level, and a paragraph half an
 * inch, to the next step. */
export function changeIndent(direction: 1 | -1): Command {
  return (state, dispatch, view) => {
    const item = listItemAround(state.selection.$from);
    if (item) {
      return direction > 0 ? sinkListItem(item)(state, dispatch, view) : liftListItem(item)(state, dispatch, view);
    }
    return eachBlock((node) => {
      const now = (node.attrs["indent"] as number | null) ?? 0;
      const steps = direction > 0 ? Math.floor(now / INDENT_STEP + 1e-6) + 1 : Math.ceil(now / INDENT_STEP - 1e-6) - 1;
      const next = Math.min(MAX_INDENT, Math.max(0, steps * INDENT_STEP));
      return next === now ? null : { indent: next || null };
    })(state, dispatch, view);
  };
}

function listItemAround($pos: ResolvedPos): NodeType | null {
  for (let depth = $pos.depth; depth > 0; depth--) {
    const type = $pos.node(depth).type;
    if (type === nodes["list_item"] || type === nodes["check_item"]) return type;
  }
  return null;
}

export function setLineSpacing(line: number): Command {
  const value = Math.min(MAX_LINE, Math.max(MIN_LINE, Math.round(line * 100) / 100));
  return eachBlock(() => ({ line_height: value === DEFAULT_LINE ? null : value }));
}

/** **Add space before** or **after**: the style's space back, or more
 * where the style has none. **Remove** takes it away. */
export function toggleSpace(side: "before" | "after"): Command {
  return (state, dispatch, view) => {
    const layout = currentLayout(state);
    if (!layout) return false;
    const adding = layout[side] === 0;
    const name = side === "before" ? "space_before" : "space_after";
    return eachBlock((node) => {
      if (!adding) return { [name]: 0 };
      const ownSpace = styleSpacing(node)[side === "before" ? 0 : 1];
      return { [name]: ownSpace > 0 ? null : ADDED_SPACE };
    })(state, dispatch, view);
  };
}

/** The settings in the paragraph dialog, in points. */
export interface ParagraphSettings {
  indent: number;
  indentRight: number;
  firstLine: number;
  line: number;
  before: number;
  after: number;
}

/** Sets the dialog's settings on each block in the selection. A space that
 * matches a block's style is left to the style. */
export function setParagraph(settings: ParagraphSettings): Command {
  return eachBlock((node) => {
    const [before, after] = styleSpacing(node);
    const length = (value: number, least: number, most: number) => twentieths(Math.min(most, Math.max(least, value)));
    const indent = length(settings.indent, 0, MAX_INDENT);
    const right = length(settings.indentRight, 0, MAX_INDENT);
    const first = length(settings.firstLine, -MAX_INDENT, MAX_INDENT);
    const spaceBefore = length(settings.before, 0, MAX_SPACE);
    const spaceAfter = length(settings.after, 0, MAX_SPACE);
    const line = Math.min(MAX_LINE, Math.max(MIN_LINE, Math.round(settings.line * 100) / 100));
    return {
      indent: indent || null,
      indent_right: right || null,
      first_line: first || null,
      line_height: line === DEFAULT_LINE ? null : line,
      space_before: spaceBefore === before ? null : spaceBefore,
      space_after: spaceAfter === after ? null : spaceAfter,
    };
  });
}

/** The list the selection is in, with where it starts. */
function bulletOrNumbers($pos: ResolvedPos): { node: Node; pos: number; depth: number } | null {
  for (let depth = $pos.depth; depth > 0; depth--) {
    const node = $pos.node(depth);
    if (node.type === nodes["bullet_list"] || node.type === nodes["ordered_list"]) return { node, pos: $pos.before(depth), depth };
    if (node.type === nodes["check_list"]) return null;
  }
  return null;
}

/** The list style where the selection is, or null outside a list or for a
 * list in the browser's own style. */
export function currentListStyle(state: EditorState): string | null {
  return (bulletOrNumbers(state.selection.$from)?.node.attrs["style"] as string | null | undefined) ?? null;
}

/** Whether the selection is in a numbered list. */
export function inNumberedList(state: EditorState): boolean {
  return bulletOrNumbers(state.selection.$from)?.node.type === nodes["ordered_list"];
}

/** Gives the list the selection is in a style, changing bullets to numbers
 * or back as the style needs, or makes a list in that style. */
export function setListStyle(style: BulletStyle | NumberStyle): Command {
  const numbered = !(BULLET_STYLES as readonly string[]).includes(style);
  const type = numbered ? nodes["ordered_list"]! : nodes["bullet_list"]!;
  return (state, dispatch, view) => {
    const list = bulletOrNumbers(state.selection.$from);
    if (list) {
      const attrs = numbered ? { order: (list.node.attrs["order"] as number | undefined) ?? 1, style } : { style };
      dispatch?.(state.tr.setNodeMarkup(list.pos, type, attrs));
      return true;
    }
    let wrapping: Transaction | null = null;
    if (!wrapInList(type, numbered ? { order: 1, style } : { style })(state, (tr) => (wrapping = tr), view)) return false;
    if (dispatch && wrapping) dispatch((wrapping as Transaction).scrollIntoView());
    return true;
  };
}

/** The number the item the selection is in has now. */
export function currentNumber(state: EditorState): number {
  const list = bulletOrNumbers(state.selection.$from);
  if (!list || list.node.type !== nodes["ordered_list"]) return 1;
  const index = state.selection.$from.index(list.depth);
  return ((list.node.attrs["order"] as number | undefined) ?? 1) + index;
}

/** Numbers the item the selection is in from `start`: the list starts
 * there, or splits before the item into a new list that does. */
export function restartNumbering(start: number): Command {
  return (state, dispatch) => {
    const list = bulletOrNumbers(state.selection.$from);
    if (!list || list.node.type !== nodes["ordered_list"]) return false;
    const from = Math.max(0, Math.min(1_000_000, Math.round(start)));
    const index = state.selection.$from.index(list.depth);
    if (dispatch) {
      const tr = state.tr;
      if (index === 0) {
        tr.setNodeMarkup(list.pos, undefined, { ...list.node.attrs, order: from });
      } else {
        // The point between the item before and this one.
        let at = list.pos + 1;
        for (let i = 0; i < index; i++) at += list.node.child(i).nodeSize;
        tr.split(at, 1, [{ type: nodes["ordered_list"]!, attrs: { ...list.node.attrs, order: from } }]);
      }
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

/** A page break where the caret is, between the document's own blocks: a
 * paragraph splits around it, and a list, quote, or table ends before it.
 * The caret goes to the line after it. */
export const insertPageBreak: Command = (state, dispatch) => {
  const pageBreak = nodes["page_break"]!.create();
  const tr = state.tr.deleteSelection();
  const $pos = tr.selection.$from;
  let at: number;
  if ($pos.depth === 0) {
    at = $pos.pos;
  } else if ($pos.depth === 1 && $pos.parent.isTextblock && $pos.parentOffset === 0) {
    at = $pos.before(1);
  } else if ($pos.depth === 1 && $pos.parent.isTextblock && $pos.parentOffset < $pos.parent.content.size) {
    tr.split($pos.pos);
    at = $pos.pos + 1;
  } else {
    at = $pos.after(1);
  }
  tr.insert(at, pageBreak);
  const after = at + pageBreak.nodeSize;
  const next = tr.doc.nodeAt(after);
  if (!next?.isTextblock) tr.insert(after, nodes["paragraph"]!.create());
  tr.setSelection(TextSelection.create(tr.doc, after + 1));
  dispatch?.(tr.scrollIntoView());
  return true;
};

/** Whether a page break is selected. */
export function pageBreakSelected(state: EditorState): boolean {
  const { selection } = state;
  return selection instanceof NodeSelection && selection.node.type === nodes["page_break"];
}

/** Enter in a paragraph or heading: the new line keeps the alignment,
 * indents, and spacing, as in Google Docs and Word. After a heading, a
 * title, or a subtitle, it's normal text. */
export const splitKeepingLayout: Command = (state, dispatch) => {
  const { $from, $to } = state.selection;
  const parent = $from.parent;
  if (parent.type !== nodes["paragraph"] && parent.type !== nodes["heading"]) return false;
  if (!$from.sameParent($to)) return false;
  const atEnd = $to.parentOffset === parent.content.size;
  if (dispatch) {
    const tr = state.tr;
    if (!state.selection.empty) tr.deleteSelection();
    const layout = keptLayout(parent);
    const plain = parent.type === nodes["heading"] || parent.attrs["kind"];
    const after =
      atEnd && plain
        ? { type: nodes["paragraph"]!, attrs: { ...layout, kind: null, space_before: null, space_after: null } }
        : { type: parent.type, attrs: parent.attrs };
    tr.split(tr.mapping.map($from.pos), 1, [after]);
    // The text typed next has the marks the caret had.
    const marks = state.storedMarks ?? ($to.parentOffset ? $from.marks() : null);
    if (marks) tr.ensureMarks(marks);
    dispatch(tr.scrollIntoView());
  }
  return true;
};

/** A list places its items' text, so a paragraph that goes into a list
 * leaves its own indents behind, as in Google Docs. Only this person's
 * changes are fixed, since everyone else's editor fixes its own. */
export function listsPlaceText(): Plugin {
  return new Plugin({
    appendTransaction(transactions, _old, state) {
      // Where this person's changes are, in the document as it is now.
      const ranges: [number, number][] = [];
      transactions.forEach((tr, index) => {
        const remote = (tr.getMeta(ySyncPluginKey) as { isChangeOrigin?: boolean } | undefined)?.isChangeOrigin;
        if (!tr.docChanged || remote) return;
        const later = transactions.slice(index + 1);
        tr.mapping.maps.forEach((map, step) => {
          map.forEach((_oldStart, _oldEnd, start, end) => {
            let from = tr.mapping.slice(step + 1).map(start, -1);
            let to = tr.mapping.slice(step + 1).map(end, 1);
            for (const next of later) {
              from = next.mapping.map(from, -1);
              to = next.mapping.map(to, 1);
            }
            ranges.push([from, to]);
          });
        });
      });
      if (!ranges.length) return null;
      const fix = state.tr;
      for (const [from, to] of ranges) {
        // A step that wraps a paragraph changes only the tokens around it,
        // so the paragraph just inside counts too.
        const start = Math.max(0, Math.min(from - 2, state.doc.content.size));
        const end = Math.max(start, Math.min(to + 2, state.doc.content.size));
        state.doc.nodesBetween(start, end, (node, pos, parent) => {
          if (
            node.type === nodes["paragraph"] &&
            (parent?.type === nodes["list_item"] || parent?.type === nodes["check_item"]) &&
            (node.attrs["indent"] !== null || node.attrs["first_line"] !== null)
          ) {
            fix.setNodeMarkup(pos, undefined, { ...node.attrs, indent: null, first_line: null });
          }
          return true;
        });
      }
      return fix.docChanged ? fix : null;
    },
  });
}
