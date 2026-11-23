// Text styles in the editor: font, size, text color, and highlight, plus
// superscript and subscript. Each is a mark (schema.ts), set over the
// selection, or kept for the next thing typed when nothing's selected.

import type { Mark, MarkType, Node, NodeType } from "prosemirror-model";
import { type Command, type EditorState, Plugin } from "prosemirror-state";
import type { EditorView, MarkViewConstructor } from "prosemirror-view";

import {
  DEFAULT_FONT,
  DEFAULT_SIZE,
  fitSize,
  fontNamed,
  fontStack,
  nearestWeight,
  reportReplaced,
  resolveFont,
  stepSize,
} from "./fonts.ts";
import { schema } from "./schema.ts";

const marks = schema.marks as Record<string, MarkType>;
const nodes = schema.nodes as Record<string, NodeType>;

/** The style marks, which a span shows. */
type StyleMark = "font_family" | "font_size" | "text_color" | "highlight" | "font_weight";

/** How the editor shows each style: a span whose style is set from code,
 * since the page's security policy doesn't allow style attributes. */
export const styleMarkViews: Record<StyleMark, MarkViewConstructor> = {
  font_family: (mark) => span((dom) => (dom.style.fontFamily = fontStack(mark.attrs["family"] as string))),
  font_size: (mark) => span((dom) => (dom.style.fontSize = `${mark.attrs["size"] as number}pt`)),
  text_color: (mark) => span((dom) => (dom.style.color = mark.attrs["color"] as string)),
  highlight: (mark) => span((dom) => (dom.style.backgroundColor = mark.attrs["color"] as string)),
  // The weight shown depends on bold around it, so app.css sets it.
  font_weight: (mark) => span((dom) => (dom.dataset["weight"] = String(mark.attrs["weight"] as number))),
};

function span(style: (dom: HTMLElement) => void) {
  const dom = document.createElement("span");
  style(dom);
  return { dom };
}

/** Each block's size when its text has none of its own, in points, as the
 * editor's styles and the downloads show them. */
export function blockSize(block: Node): number {
  if (block.type === nodes["heading"]) {
    return HEADING_SIZES[(block.attrs["level"] as number) - 1] ?? DEFAULT_SIZE;
  }
  if (block.type === nodes["code_block"]) return CODE_SIZE;
  if (block.attrs["kind"] === "title") return TITLE_SIZE;
  if (block.attrs["kind"] === "subtitle") return SUBTITLE_SIZE;
  return DEFAULT_SIZE;
}

/** Headings 1 to 6, as Word's download sizes them. */
export const HEADING_SIZES = [20, 16, 14, 12, 11, 11] as const;
export const CODE_SIZE = 10;
/** The Title and Subtitle styles, as in Google Docs. */
export const TITLE_SIZE = 26;
export const SUBTITLE_SIZE = 15;

/** The styles where the selection is. A value is null where the selection
 * has more than one. A color is null for none, as is a highlight. */
export interface TextStyle {
  font: string | null;
  /** The weight the font menu shows as chosen: 400 for none, 700 for bold
   * alone, or the font_weight mark's. */
  weight: number | null;
  size: number | null;
  color: string | null;
  highlight: string | null;
  superscript: boolean;
  subscript: boolean;
}

/** What each style is over the selection. */
export function textStyle(state: EditorState): TextStyle {
  const { empty, $from } = state.selection;
  const fonts = new Set<string>();
  const weights = new Set<number>();
  const sizes = new Set<number>();
  const colors = new Set<string | null>();
  const highlights = new Set<string | null>();
  let superscript = true;
  let subscript = true;
  const add = (set: readonly Mark[], block: Node) => {
    const attr = (name: string, key: string) => set.find((mark) => mark.type === marks[name])?.attrs[key] as unknown;
    fonts.add((attr("font_family", "family") as string | undefined) ?? DEFAULT_FONT);
    weights.add((attr("font_weight", "weight") as number | undefined) ?? (marks["bold"]!.isInSet(set) ? 700 : 400));
    sizes.add((attr("font_size", "size") as number | undefined) ?? blockSize(block));
    colors.add((attr("text_color", "color") as string | undefined) ?? null);
    highlights.add((attr("highlight", "color") as string | undefined) ?? null);
    superscript &&= !!marks["superscript"]!.isInSet(set);
    subscript &&= !!marks["subscript"]!.isInSet(set);
  };
  if (empty) {
    add(state.storedMarks ?? $from.marks(), $from.parent);
  } else {
    for (const range of state.selection.ranges) {
      state.doc.nodesBetween(range.$from.pos, range.$to.pos, (node, _pos, parent) => {
        if (node.isText && parent) add(node.marks, parent);
        return true;
      });
    }
    // A selection of only pictures or rules has no text: it takes the
    // style where it starts.
    if (sizes.size === 0) add($from.marks(), $from.parent);
  }
  const one = <T>(set: Set<T>): T | null => (set.size === 1 ? [...set][0]! : null);
  return {
    font: one(fonts),
    weight: one(weights),
    size: one(sizes),
    color: one(colors),
    highlight: one(highlights),
    superscript,
    subscript,
  };
}

/** Sets a style mark over the selection, or takes it off with `attrs` null.
 * With nothing selected, it's for the next thing typed. */
function setStyleMark(type: MarkType, attrs: Record<string, unknown> | null): Command {
  return (state, dispatch) => {
    const { empty, $cursor } = state.selection as { empty: boolean; $cursor?: unknown };
    if (empty && !$cursor) return false;
    if (dispatch) {
      const tr = state.tr;
      if (empty) {
        tr.removeStoredMark(type);
        if (attrs) tr.addStoredMark(type.create(attrs));
      } else {
        for (const { $from, $to } of state.selection.ranges) {
          tr.removeMark($from.pos, $to.pos, type);
          if (attrs) tr.addMark($from.pos, $to.pos, type.create(attrs));
        }
      }
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

/** The selection's font, in its regular weight unless `weight` is given,
 * as the font menu and its weights set them. The default font is no font
 * of its own, so a document's text follows the default. Regular is no
 * weight, and bold is the bold mark, which stays when no weight is given. */
export function setFont(name: string, weight?: number): Command {
  return (state, dispatch) => {
    const { empty, $cursor } = state.selection as { empty: boolean; $cursor?: unknown };
    if (empty && !$cursor) return false;
    if (dispatch) {
      const family = marks["font_family"]!;
      const weightType = marks["font_weight"]!;
      const bold = marks["bold"]!;
      const set = (add: (mark: Mark) => void, remove: (type: MarkType) => void) => {
        remove(family);
        if (name !== DEFAULT_FONT) add(family.create({ family: name }));
        remove(weightType);
        if (weight === undefined) return;
        remove(bold);
        if (weight === 700) add(bold.create());
        else if (weight !== 400) add(weightType.create({ weight }));
      };
      const tr = state.tr;
      if (empty) {
        set(
          (mark) => tr.addStoredMark(mark),
          (type) => tr.removeStoredMark(type),
        );
      } else {
        for (const { $from, $to } of state.selection.ranges) {
          set(
            (mark) => tr.addMark($from.pos, $to.pos, mark),
            (type) => tr.removeMark($from.pos, $to.pos, type),
          );
        }
      }
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

export function setSize(points: number): Command {
  const size = fitSize(points);
  return size === null ? () => false : setStyleMark(marks["font_size"]!, { size });
}

/** The selection's size a point bigger or smaller, from the size it starts
 * with, as Google Docs does. */
export function stepFontSize(by: 1 | -1): Command {
  return (state, dispatch, view) => {
    const { $from } = state.selection;
    const sizeMark = marks["font_size"]!.isInSet(state.storedMarks ?? $from.marks());
    const current = textStyle(state).size ?? (sizeMark?.attrs["size"] as number | undefined) ?? blockSize($from.parent);
    return setSize(stepSize(current, by))(state, dispatch, view);
  };
}

/** The text's color, or none with null. Black is none, since it's the color
 * text has anyway. */
export function setColor(color: string | null): Command {
  return setStyleMark(marks["text_color"]!, color && color !== "#000000" ? { color } : null);
}

export function setHighlight(color: string | null): Command {
  return setStyleMark(marks["highlight"]!, color ? { color } : null);
}

/** Takes every mark but links off the selection: bold, colors, sizes, and
 * the rest, as Google Docs' **Clear formatting** does. */
export const clearFormatting: Command = (state, dispatch) => {
  const cleared = Object.values(marks).filter((type) => type !== marks["link"]);
  if (dispatch) {
    const tr = state.tr;
    if (state.selection.empty) {
      tr.setStoredMarks((state.storedMarks ?? state.selection.$from.marks()).filter((mark) => mark.type === marks["link"]));
    } else {
      for (const { $from, $to } of state.selection.ranges) {
        for (const type of cleared) tr.removeMark($from.pos, $to.pos, type);
      }
    }
    dispatch(tr.scrollIntoView());
  }
  return true;
};

/** Google Docs' text colors: a row of grays, a row of bright colors, then
 * three lighter and three darker rows of each. */
export const PALETTE: readonly (readonly string[])[] = [
  ["#000000", "#434343", "#666666", "#999999", "#b7b7b7", "#cccccc", "#d9d9d9", "#efefef", "#f3f3f3", "#ffffff"],
  ["#980000", "#ff0000", "#ff9900", "#ffff00", "#00ff00", "#00ffff", "#4a86e8", "#0000ff", "#9900ff", "#ff00ff"],
  ["#e6b8af", "#f4cccc", "#fce5cd", "#fff2cc", "#d9ead3", "#d0e0e3", "#c9daf8", "#cfe2f3", "#d9d2e9", "#ead1dc"],
  ["#dd7e6b", "#ea9999", "#f9cb9c", "#ffe599", "#b6d7a8", "#a2c4c9", "#a4c2f4", "#9fc5e8", "#b4a7d6", "#d5a6bd"],
  ["#cc4125", "#e06666", "#f6b26b", "#ffd966", "#93c47d", "#76a5af", "#6d9eeb", "#6fa8dc", "#8e7cc3", "#c27ba0"],
  ["#a61c00", "#cc0000", "#e69138", "#f1c232", "#6aa84f", "#45818e", "#3c78d8", "#3d85c6", "#674ea7", "#a64d79"],
  ["#85200c", "#990000", "#b45f06", "#bf9000", "#38761d", "#134f5c", "#1155cc", "#0b5394", "#351c75", "#741b47"],
  ["#5b0f00", "#660000", "#783f04", "#7f6000", "#274e13", "#0c343d", "#1c4587", "#073763", "#20124d", "#4c1130"],
];

/** Keeps a document to the fonts Docs has, in an editor that can change
 * it. Text that names another font, such as from a document made before
 * Docs named its fonts by their own names, or a paste the schema's rules
 * didn't read, gets the font Docs uses in its place, and the page is told
 * (fonts.ts' `reportReplaced`). A weight the font doesn't have becomes the
 * nearest it has, so the font menu shows the weight the text has. */
export function fontCheck(editable: () => boolean): Plugin {
  let view: EditorView | null = null;
  return new Plugin({
    view(editorView) {
      view = editorView;
      return { destroy: () => (view = null) };
    },
    appendTransaction(transactions, before, after) {
      if (!transactions.some((tr) => tr.docChanged) || (view && !editable())) return null;
      const start = before.doc.content.findDiffStart(after.doc.content);
      if (start === null) return null;
      const end = before.doc.content.findDiffEnd(after.doc.content)?.b ?? after.doc.content.size;
      const family = marks["font_family"]!;
      const weightType = marks["font_weight"]!;
      const tr = after.tr;
      after.doc.nodesBetween(start, Math.max(start, end), (node, pos) => {
        if (!node.isText) return true;
        const from = pos;
        const to = pos + node.nodeSize;
        const named = family.isInSet(node.marks)?.attrs["family"] as string | undefined;
        let name = named ?? DEFAULT_FONT;
        if (named !== undefined && !fontNamed(named)) {
          const resolved = resolveFont(named);
          if (resolved.replaced) reportReplaced(resolved.replaced);
          name = resolved.name;
          tr.removeMark(from, to, family);
          if (name !== DEFAULT_FONT) tr.addMark(from, to, family.create({ family: name }));
        }
        const weight = weightType.isInSet(node.marks)?.attrs["weight"] as number | undefined;
        if (weight !== undefined) {
          const nearest = nearestWeight(fontNamed(name)!, weight);
          if (nearest !== weight) {
            tr.removeMark(from, to, weightType);
            if (nearest === 700) tr.addMark(from, to, marks["bold"]!.create());
            else if (nearest !== null && nearest !== 400) tr.addMark(from, to, weightType.create({ weight: nearest }));
          }
        }
        return false;
      });
      return tr.docChanged ? tr : null;
    },
  });
}
