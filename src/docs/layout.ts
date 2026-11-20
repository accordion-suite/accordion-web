// A paragraph's layout (decision 30): its alignment, indents, line spacing,
// and the space before and after it, plus the Title and Subtitle styles.
// Each is an attribute of a paragraph or heading node, lengths in points,
// as accordion-docs' `Para` keeps them. Unset attributes are null, so
// y-prosemirror leaves them out of the co-editing document.

import type { Attrs, Node } from "prosemirror-model";

export const ALIGNS = ["left", "center", "right", "justify"] as const;
export type Align = (typeof ALIGNS)[number];

export const KINDS = ["title", "subtitle"] as const;
export type Kind = (typeof KINDS)[number];

/** Single spacing as a CSS `line-height`: Arial's own line height, and
 * Word's single spacing for it (accordion-docs' `SINGLE`). */
export const SINGLE = 1.15;

/** Line spacing when a paragraph has none of its own, as in Google Docs
 * and the Word download. */
export const DEFAULT_LINE = 1.15;

/** The line spacings the menu offers, as Google Docs does. */
export const LINE_PRESETS = [1, 1.15, 1.5, 2] as const;

/** How far each indent step moves a paragraph: half an inch. */
export const INDENT_STEP = 36;

/** The furthest indent, 10 inches, and the most space before or after a
 * paragraph, as the server keeps them. */
export const MAX_INDENT = 720;
export const MAX_SPACE = 1000;
export const MIN_LINE = 0.5;
export const MAX_LINE = 10;

/** The space added by **Add space before** or **Add space after**, in
 * points, where the style has none. */
export const ADDED_SPACE = 12;

/** The attributes paragraphs and headings share. */
export const LAYOUT_ATTRS = {
  align: { default: null },
  indent: { default: null },
  indent_right: { default: null },
  first_line: { default: null },
  line_height: { default: null },
  space_before: { default: null },
  space_after: { default: null },
} as const;

/** A paragraph's layout as the toolbar and dialogs see it, with what its
 * style gives filled in. */
export interface Layout {
  align: Align;
  indent: number;
  indentRight: number;
  firstLine: number;
  line: number;
  before: number;
  after: number;
}

/** The space before and after each style, in points, as the editor's
 * styles, the file, and the downloads have them. */
export function styleSpacing(node: Node): [number, number] {
  if (node.type.name === "heading") {
    return HEADING_SPACING[(node.attrs["level"] as number) - 1] ?? [12, 4];
  }
  if (node.attrs["kind"] === "title") return [0, 3];
  if (node.attrs["kind"] === "subtitle") return [0, 16];
  return [0, 6];
}

const HEADING_SPACING: [number, number][] = [
  [20, 6],
  [18, 6],
  [16, 4],
  [14, 4],
  [12, 4],
  [12, 4],
];

export function layoutOf(node: Node): Layout {
  const number = (name: string) => (node.attrs[name] as number | null) ?? null;
  const [before, after] = styleSpacing(node);
  return {
    align: (node.attrs["align"] as Align | null) ?? "left",
    indent: number("indent") ?? 0,
    indentRight: number("indent_right") ?? 0,
    firstLine: number("first_line") ?? 0,
    line: number("line_height") ?? DEFAULT_LINE,
    before: number("space_before") ?? before,
    after: number("space_after") ?? after,
  };
}

/** Points rounded to a twentieth, as the server keeps them, so a value
 * reads back as it was set. */
export function twentieths(points: number): number {
  return Math.round(points * 20) / 20;
}

/** Shows a paragraph's or heading's layout on `dom`. The styles go through
 * its style properties, since the page's security policy doesn't allow
 * style attributes, and copied text keeps them. */
export function showLayout(dom: HTMLElement, node: Node) {
  const attrs = node.attrs;
  const kind = attrs["kind"] as Kind | null | undefined;
  if (kind) dom.className = kind;
  const points = (name: string) => {
    const value = attrs[name] as number | null;
    return value === null || value === undefined ? "" : `${value}pt`;
  };
  const align = attrs["align"] as Align | null;
  if (align && align !== "left") dom.style.textAlign = align;
  dom.style.marginLeft = points("indent");
  dom.style.marginRight = points("indent_right");
  dom.style.textIndent = points("first_line");
  dom.style.marginTop = points("space_before");
  dom.style.marginBottom = points("space_after");
  const line = attrs["line_height"] as number | null;
  if (line !== null && line !== undefined) {
    dom.style.lineHeight = String(Math.round(line * SINGLE * 10000) / 10000);
    dom.dataset["lineHeight"] = String(line);
  }
}

/** A paragraph's or heading's layout from HTML: from its style (or the
 * `data-style` pasted HTML keeps it in), its class, and the old `align`.
 * `declared` reads one CSS property. */
export function layoutFromDom(dom: HTMLElement, declared: (dom: HTMLElement, name: string) => string | null): Attrs {
  const attrs: Record<string, unknown> = {};
  const align = alignFromCss(declared(dom, "text-align") ?? dom.getAttribute("align") ?? "");
  if (align && align !== "left") attrs["align"] = align;
  const length = (name: string) => {
    const value = declared(dom, name);
    return value === null ? null : lengthFromCss(value);
  };
  const margins = (declared(dom, "margin") ?? "").split(/\s+/).filter(Boolean).map(lengthFromCss);
  const [top, right, bottom, left] =
    margins.length === 1
      ? [margins[0], margins[0], margins[0], margins[0]]
      : margins.length === 2
        ? [margins[0], margins[1], margins[0], margins[1]]
        : margins.length === 3
          ? [margins[0], margins[1], margins[2], margins[1]]
          : margins.length === 4
            ? margins
            : [null, null, null, null];
  const indent = clamp(length("margin-left") ?? left ?? null, 0, MAX_INDENT);
  if (indent) attrs["indent"] = indent;
  const right_ = clamp(length("margin-right") ?? right ?? null, 0, MAX_INDENT);
  if (right_) attrs["indent_right"] = right_;
  const first = clamp(length("text-indent"), -MAX_INDENT, MAX_INDENT);
  if (first) attrs["first_line"] = first;
  const before = clamp(length("margin-top") ?? top ?? null, 0, MAX_SPACE);
  if (before !== null) attrs["space_before"] = before;
  const after = clamp(length("margin-bottom") ?? bottom ?? null, 0, MAX_SPACE);
  if (after !== null) attrs["space_after"] = after;
  const ownLine = Number(dom.getAttribute("data-line-height"));
  const line = ownLine > 0 ? ownLine : lineFromCss(declared(dom, "line-height") ?? "");
  if (line !== null) attrs["line_height"] = Math.min(MAX_LINE, Math.max(MIN_LINE, Math.round(line * 100) / 100));
  const classes = (dom.getAttribute("class") ?? "").toLowerCase().split(/\s+/);
  if (classes.includes("title") || classes.includes("msotitle")) attrs["kind"] = "title";
  else if (classes.includes("subtitle") || classes.includes("msosubtitle")) attrs["kind"] = "subtitle";
  return attrs;
}

function clamp(value: number | null, least: number, most: number): number | null {
  return value === null ? null : twentieths(Math.min(most, Math.max(least, value)));
}

function alignFromCss(text: string): Align | null {
  const value = text.trim().toLowerCase();
  if (value === "left" || value === "start") return "left";
  if (value === "center" || value === "centre" || value === "middle") return "center";
  if (value === "right" || value === "end") return "right";
  if (value === "justify" || value === "both") return "justify";
  return null;
}

/** A CSS length in points, such as `36pt`, `0.5in`, or `-18pt`, or null. */
export function lengthFromCss(text: string): number | null {
  const value = text.trim().toLowerCase();
  if (value === "0") return 0;
  const match = /^([-+]?[0-9]*\.?[0-9]+)\s*(pt|px|em|rem|in|cm|mm|pc)$/.exec(value);
  if (!match) return null;
  const number = Number(match[1]);
  const points = { pt: number, px: number * 0.75, em: number * 11, rem: number * 11, in: number * 72, cm: (number * 72) / 2.54, mm: (number * 72) / 25.4, pc: number * 12 }[
    match[2] as "pt"
  ];
  return Number.isFinite(points) ? points : null;
}

/** Line spacing from a CSS `line-height`, as accordion-docs'
 * `line_from_css` reads it: Google Docs writes a number 1.2 times its
 * spacing, Word a percentage of its spacing, and some programs a length. */
export function lineFromCss(text: string): number | null {
  const value = text.trim().toLowerCase();
  let line: number;
  if (value.endsWith("%")) line = Number(value.slice(0, -1)) / 100;
  else if (/^[0-9]*\.?[0-9]+$/.test(value)) line = Number(value) / 1.2;
  else {
    const points = lengthFromCss(value);
    if (points === null) return null;
    line = points / (11 * SINGLE);
  }
  if (!Number.isFinite(line) || line <= 0) return null;
  return Math.min(MAX_LINE, Math.max(MIN_LINE, Math.round(line * 100) / 100));
}

/** List styles, as accordion-docs' `ListStyle` names them. */
export const BULLET_STYLES = ["disc", "circle", "square", "dash", "arrow", "star"] as const;
export const NUMBER_STYLES = ["decimal", "decimal-paren", "lower-alpha", "upper-alpha", "lower-roman", "upper-roman"] as const;
export type BulletStyle = (typeof BULLET_STYLES)[number];
export type NumberStyle = (typeof NUMBER_STYLES)[number];

/** How each style's first three items look, for the menu. */
export const LIST_SAMPLES: Record<BulletStyle | NumberStyle, string> = {
  disc: "●",
  circle: "○",
  square: "■",
  dash: "–",
  arrow: "➢",
  star: "★",
  decimal: "1.  2.  3.",
  "decimal-paren": "1)  2)  3)",
  "lower-alpha": "a.  b.  c.",
  "upper-alpha": "A.  B.  C.",
  "lower-roman": "i.  ii.  iii.",
  "upper-roman": "I.  II.  III.",
};

/** A list's style from HTML: the name Docs writes, a `list-style-type` on
 * the list or its first item (as Google Docs writes it), or the old
 * `type`. */
export function listStyleFromDom(
  dom: HTMLElement,
  numbered: boolean,
  declared: (dom: HTMLElement, name: string) => string | null,
): string | null {
  const known: readonly string[] = numbered ? NUMBER_STYLES : BULLET_STYLES;
  const own = dom.getAttribute("data-list");
  if (own && known.includes(own)) return own;
  const fromCss = (value: string | null) => {
    const name = (value ?? "").trim().toLowerCase().split(/\s+/)[0] ?? "";
    const mapped = name === "lower-latin" ? "lower-alpha" : name === "upper-latin" ? "upper-alpha" : name;
    return known.includes(mapped) ? mapped : null;
  };
  const first = [...dom.children].find((child) => child.tagName === "LI") as HTMLElement | undefined;
  for (const holder of [dom, first]) {
    if (!holder) continue;
    const style = fromCss(declared(holder, "list-style-type")) ?? fromCss(declared(holder, "list-style"));
    if (style) return style;
  }
  const type = dom.getAttribute("type");
  if (type === null) return null;
  const byType: Record<string, string> = { "1": "decimal", a: "lower-alpha", A: "upper-alpha", i: "lower-roman", I: "upper-roman" };
  const style = byType[type.trim()] ?? fromCss(type);
  return style && known.includes(style) ? style : null;
}

/** Whether an element's style starts a new page before it. */
export function breaksPage(dom: HTMLElement, declared: (dom: HTMLElement, name: string) => string | null): boolean {
  const value = (declared(dom, "page-break-before") ?? declared(dom, "break-before") ?? "").trim().toLowerCase();
  return ["always", "page", "left", "right", "recto", "verso"].includes(value);
}
