// What a document can hold (decision 30). The server has the same schema in
// accordion-docs' `src/model.rs`, and y-prosemirror stores these node and
// mark names in the co-editing document, so the two must match: a node the
// server doesn't know is left out of the file, and one the editor doesn't
// know is dropped from the document.

import { type Attrs, type DOMOutputSpec, type MarkSpec, type Node, type NodeSpec, Schema, type TagParseRule } from "prosemirror-model";
import { tableNodes } from "prosemirror-tables";

import { DEFAULT_FONT, fitSize, safeFontName } from "./fonts.ts";
import { breaksPage, LAYOUT_ATTRS, layoutFromDom, listStyleFromDom, showLayout } from "./layout.ts";

/** Heading levels, in the order the style menu lists them. */
export const HEADING_LEVELS = [1, 2, 3, 4, 5, 6] as const;

/** Elements that hold text, whose background is a highlight. */
const INLINE = ["span", "font", "a", "b", "strong", "i", "em", "u", "s", "sup", "sub", "code"];

/** A paragraph or heading, its layout shown through its style properties
 * (layout.ts). */
function laidOut(tag: string, node: Node): DOMOutputSpec {
  const dom = document.createElement(tag);
  showLayout(dom, node);
  return { dom, contentDOM: dom };
}

const nodes: Record<string, NodeSpec> = {
  // Page breaks only between the document's own blocks, never in a list,
  // a quote, or a table, where printing can't break a page.
  doc: { content: "(block | page_break)+" },
  paragraph: {
    attrs: { kind: { default: null }, ...LAYOUT_ATTRS },
    content: "inline*",
    group: "block",
    parseDOM: [{ tag: "p", getAttrs: (dom) => layoutFromDom(dom, declared) }],
    toDOM: (node) => laidOut("p", node),
  },
  heading: {
    attrs: { level: { default: 1, validate: "number" }, ...LAYOUT_ATTRS },
    content: "inline*",
    group: "block",
    defining: true,
    parseDOM: [1, 2, 3, 4, 5, 6].map((level) => ({
      tag: `h${level}`,
      getAttrs: (dom: HTMLElement) => {
        const { kind: _kind, ...layout } = layoutFromDom(dom, declared);
        return { ...layout, level };
      },
    })),
    toDOM: (node) => laidOut(`h${node.attrs["level"] as number}`, node),
  },
  page_break: {
    atom: true,
    selectable: true,
    parseDOM: [
      { tag: "div.page-break" },
      // Google Docs copies a page break as a rule it hides.
      { tag: "hr", priority: 60, getAttrs: (dom) => (breaksPage(dom, declared) ? null : false) },
    ],
    toDOM: () => ["div", { class: "page-break" }],
  },
  blockquote: {
    content: "block+",
    group: "block",
    defining: true,
    parseDOM: [{ tag: "blockquote" }],
    toDOM: () => ["blockquote", 0],
  },
  code_block: {
    content: "text*",
    marks: "",
    group: "block",
    code: true,
    defining: true,
    parseDOM: [{ tag: "pre", preserveWhitespace: "full" }],
    toDOM: () => ["pre", ["code", 0]],
  },
  horizontal_rule: {
    group: "block",
    parseDOM: [{ tag: "hr" }],
    toDOM: () => ["hr"],
  },
  // A list's style is its `data-list`, which the editor's styles and the
  // file's show (layout.ts' BULLET_STYLES and NUMBER_STYLES).
  bullet_list: {
    attrs: { style: { default: null } },
    content: "list_item+",
    group: "block",
    parseDOM: [{ tag: "ul", getAttrs: (dom) => ({ style: listStyleFromDom(dom, false, declared) }) }],
    toDOM: (node) => ["ul", listAttrs(node), 0],
  },
  ordered_list: {
    attrs: { order: { default: 1, validate: "number" }, style: { default: null } },
    content: "list_item+",
    group: "block",
    parseDOM: [
      {
        tag: "ol",
        getAttrs: (dom) => ({
          order: Number(dom.getAttribute("start") ?? 1) || 1,
          style: listStyleFromDom(dom, true, declared),
        }),
      },
    ],
    toDOM: (node) => ["ol", listAttrs(node), 0],
  },
  list_item: {
    content: "paragraph block*",
    defining: true,
    parseDOM: [{ tag: "li" }],
    toDOM: () => ["li", 0],
  },
  check_list: {
    content: "check_item+",
    group: "block",
    // Ahead of bullet_list's rule, which would take every <ul>.
    parseDOM: [{ tag: "ul.checklist", priority: 60 }, { tag: "ul[data-type=checklist]", priority: 60 }],
    toDOM: () => ["ul", { class: "checklist" }, 0],
  },
  check_item: {
    attrs: { checked: { default: false, validate: "boolean" } },
    content: "paragraph block*",
    defining: true,
    parseDOM: [
      {
        tag: "li[data-checked]",
        priority: 60,
        getAttrs: (dom) => ({ checked: (dom as HTMLElement).getAttribute("data-checked") === "true" }),
      },
    ],
    toDOM: (node) => ["li", { "data-checked": String(node.attrs["checked"] as boolean) }, 0],
  },
  // A picture on a line of its own. Its `src` is the hash of its contents,
  // which the server keeps (accordion-docs' `picture.rs`), and the editor
  // shows it from the document's pictures. Copied, it keeps the hash, so it
  // pastes into another document. Pictures from web pages don't come in,
  // since showing one would tell its site who's reading.
  image: {
    attrs: {
      src: { validate: "string" },
      alt: { default: "", validate: "string" },
      width: { default: null },
    },
    group: "block",
    atom: true,
    draggable: true,
    parseDOM: [
      {
        tag: "img[data-hash]",
        getAttrs: (dom) => {
          const element = dom as HTMLElement;
          const hash = element.getAttribute("data-hash") ?? "";
          if (!isPictureHash(hash)) return false;
          const width = Number(element.getAttribute("width"));
          return { src: hash, alt: element.getAttribute("alt") ?? "", width: width > 0 ? Math.round(width) : null };
        },
      },
    ],
    toDOM: (node) => {
      const attrs: Record<string, string> = { "data-hash": node.attrs["src"] as string, alt: node.attrs["alt"] as string };
      if (node.attrs["width"]) attrs["width"] = String(node.attrs["width"] as number);
      return ["img", attrs];
    },
  },
  ...tableNodes({ tableGroup: "block", cellContent: "block+", cellAttributes: {} }),
  text: { group: "inline" },
  hard_break: {
    inline: true,
    group: "inline",
    selectable: false,
    parseDOM: [{ tag: "br" }],
    toDOM: () => ["br"],
  },
};

const marks: Record<string, MarkSpec> = {
  // The link comes first, so it wraps the other marks, as the server
  // writes it.
  link: {
    attrs: { href: { validate: "string" } },
    inclusive: false,
    parseDOM: [
      {
        tag: "a[href]",
        getAttrs: (dom) => {
          const href = safeLink((dom as HTMLElement).getAttribute("href") ?? "");
          return href ? { href } : false;
        },
      },
    ],
    toDOM: (mark): DOMOutputSpec => [
      "a",
      { href: mark.attrs["href"] as string, rel: "noopener noreferrer nofollow", target: "_blank" },
      0,
    ],
  },
  // Text styles, each written as a style on a <span> where they're copied.
  // The editor shows them through mark views instead (editor.ts), since
  // the page's security policy doesn't allow style attributes. The policy
  // also leaves pasted HTML without styles to read, so these rules read the
  // `style` attribute's text themselves (`styled`).
  font_family: {
    attrs: { family: { validate: "string" } },
    parseDOM: [
      styled("font-family", (value) => fontAttrs(fontFromCss(value))),
      { tag: "font[face]", consuming: false, getAttrs: (dom) => fontAttrs(fontFromCss(dom.getAttribute("face") ?? "")) },
    ],
    toDOM: (mark) => ["span", { style: `font-family:'${mark.attrs["family"] as string}'` }, 0],
  },
  font_size: {
    attrs: { size: { validate: "number" } },
    parseDOM: [
      styled("font-size", (value, dom) => {
        // Programs that raise text also make it smaller, which superscript
        // and subscript already do.
        if (/^(super|sub)$/i.test(declared(dom, "vertical-align") ?? "")) return false;
        const size = sizeFromCss(value);
        return size === null ? false : { size };
      }),
    ],
    toDOM: (mark) => ["span", { style: `font-size:${mark.attrs["size"] as number}pt` }, 0],
  },
  text_color: {
    attrs: { color: { validate: "string" } },
    parseDOM: [
      styled("color", (value) => colorAttrs(value)),
      { tag: "font[color]", consuming: false, getAttrs: (dom) => colorAttrs(dom.getAttribute("color") ?? "") },
    ],
    toDOM: (mark) => ["span", { style: `color:${mark.attrs["color"] as string}` }, 0],
  },
  highlight: {
    attrs: { color: { validate: "string" } },
    parseDOM: [
      { tag: "mark", attrs: { color: "#ffff00" } },
      // Only on text: a paragraph's or cell's background is shading.
      styled(
        "background-color",
        (value) => {
          const color = colorFromCss(value);
          return color ? { color } : false;
        },
        INLINE,
      ),
    ],
    toDOM: (mark) => ["span", { style: `background-color:${mark.attrs["color"] as string}` }, 0],
  },
  bold: {
    parseDOM: [
      { tag: "strong" },
      // Google Docs wraps whole pastes in <b style="font-weight:normal">.
      { tag: "b", getAttrs: (dom) => !/^(normal|[1-5]00)$/i.test(declared(dom, "font-weight") ?? "") && null },
      { style: "font-weight=400", clearMark: (mark) => mark.type.name === "bold" },
      styled("font-weight", (value) => /^(bold(er)?|[6-9]\d{2,})$/i.test(value) && null),
    ],
    toDOM: () => ["strong", 0],
  },
  italic: {
    parseDOM: [{ tag: "em" }, { tag: "i" }, styled("font-style", (value) => /^(italic|oblique)$/i.test(value) && null)],
    toDOM: () => ["em", 0],
  },
  underline: {
    parseDOM: [{ tag: "u" }, { tag: "ins" }, styled("text-decoration", (value) => /underline/i.test(value) && null)],
    toDOM: () => ["u", 0],
  },
  strike: {
    parseDOM: [
      { tag: "s" },
      { tag: "strike" },
      { tag: "del" },
      styled("text-decoration", (value) => /line-through/i.test(value) && null),
    ],
    toDOM: () => ["s", 0],
  },
  code: {
    parseDOM: [{ tag: "code" }],
    toDOM: () => ["code", 0],
  },
  // Text is raised or lowered, never both.
  superscript: {
    excludes: "superscript subscript",
    parseDOM: [{ tag: "sup" }, styled("vertical-align", (value) => /^super$/i.test(value) && null)],
    toDOM: () => ["sup", 0],
  },
  subscript: {
    excludes: "superscript subscript",
    parseDOM: [{ tag: "sub" }, styled("vertical-align", (value) => /^sub$/i.test(value) && null)],
    toDOM: () => ["sub", 0],
  },
};

export const schema = new Schema({ nodes, marks });

/** A list's start and style as attributes, with the old `type` that
 * programs without styles still show. */
function listAttrs(node: Node): Record<string, string> {
  const attrs: Record<string, string> = {};
  const order = node.attrs["order"] as number | undefined;
  if (order !== undefined && order !== 1) attrs["start"] = String(order);
  const style = node.attrs["style"] as string | null;
  if (style) {
    const type = { "lower-alpha": "a", "upper-alpha": "A", "lower-roman": "i", "upper-roman": "I" }[style];
    if (type) attrs["type"] = type;
    attrs["data-list"] = style;
  }
  return attrs;
}

/** Pasted HTML with each `style` attribute renamed `data-style`, so the
 * browser doesn't report the styles it won't apply while ProseMirror reads
 * the HTML. The rules below read either. */
export function keepPastedStyles(html: string): string {
  return html.replace(/<[a-z][^>]*>/gi, (tag) => tag.replace(/(\s)style(\s*=)/gi, "$1data-style$2"));
}

/** The value of `name` in an element's `style` attribute, or null. */
export function declared(dom: HTMLElement, name: string): string | null {
  let found: string | null = null;
  for (const declaration of (dom.getAttribute("data-style") ?? dom.getAttribute("style") ?? "").split(";")) {
    const colon = declaration.indexOf(":");
    if (colon < 0 || declaration.slice(0, colon).trim().toLowerCase() !== name) continue;
    found = declaration
      .slice(colon + 1)
      .replace(/!important\s*$/i, "")
      .trim();
  }
  return found;
}

/** A rule for a mark set by the CSS property `name` on any element, or on
 * the elements `tags`. It lets the element's other rules match too, so a
 * span can be red and bold. */
function styled(
  name: string,
  attrs: (value: string, dom: HTMLElement) => Attrs | false | null,
  tags?: readonly string[],
): TagParseRule {
  const selector = (tags ?? [""])
    .flatMap((tag) => [`${tag}[style*="${name}" i]`, `${tag}[data-style*="${name}" i]`])
    .join(",");
  return {
    tag: selector,
    consuming: false,
    getAttrs: (dom) => {
      const value = declared(dom, name);
      return value === null ? false : attrs(value, dom);
    },
  };
}

function colorAttrs(value: string): Attrs | false {
  const color = colorFromCss(value);
  // Black is the color text has anyway, which Google Docs names on
  // everything it copies.
  return color && color !== "#000000" ? { color } : false;
}

/** A font, unless it's the font text has anyway, which Google Docs names on
 * everything it copies. */
function fontAttrs(family: string | null): Attrs | false {
  return family && family !== DEFAULT_FONT ? { family } : false;
}

/** A CSS color as the document keeps it, `#rrggbb`, or null for one that
 * can't be seen, such as `transparent`, or that isn't a color. */
export function colorFromCss(text: string): string | null {
  const value = text.trim().toLowerCase();
  const hex = (n: number) => n.toString(16).padStart(2, "0");
  let match = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(value);
  if (match) {
    let digits = match[1]!;
    if (digits.length <= 4) digits = [...digits].map((d) => d + d).join("");
    if (digits.length === 8 && digits.slice(6) === "00") return null;
    return `#${digits.slice(0, 6)}`;
  }
  match = /^rgba?\(([^)]*)\)$/.exec(value);
  if (match) {
    const parts = match[1]!.split(/[\s,/]+/).filter(Boolean);
    if (parts.length !== 3 && parts.length !== 4) return null;
    const number = (part: string, scale: number) =>
      part.endsWith("%") ? (Number(part.slice(0, -1)) / 100) * scale : Number(part);
    if (parts[3] !== undefined && !(number(parts[3], 1) > 0)) return null;
    const channels = parts.slice(0, 3).map((part) => number(part, 255));
    if (channels.some((channel) => !Number.isFinite(channel))) return null;
    return `#${channels.map((channel) => hex(Math.round(Math.min(255, Math.max(0, channel))))).join("")}`;
  }
  const named = NAMED_COLORS[value];
  return named ?? null;
}

const NAMED_COLORS: Record<string, string> = {
  black: "#000000",
  white: "#ffffff",
  red: "#ff0000",
  green: "#008000",
  blue: "#0000ff",
  yellow: "#ffff00",
  cyan: "#00ffff",
  aqua: "#00ffff",
  magenta: "#ff00ff",
  fuchsia: "#ff00ff",
  gray: "#808080",
  grey: "#808080",
  silver: "#c0c0c0",
  maroon: "#800000",
  olive: "#808000",
  lime: "#00ff00",
  navy: "#000080",
  purple: "#800080",
  teal: "#008080",
  orange: "#ffa500",
  pink: "#ffc0cb",
  brown: "#a52a2a",
};

/** A CSS font size in points, to the nearest half point, or null. Sizes
 * relative to the text around them assume 11 points. */
export function sizeFromCss(text: string): number | null {
  const value = text.trim().toLowerCase();
  const keywords: Record<string, number> = {
    "xx-small": 7,
    "x-small": 7.5,
    small: 10,
    medium: 12,
    large: 13.5,
    "x-large": 18,
    "xx-large": 24,
    "xxx-large": 36,
  };
  if (value in keywords) return keywords[value]!;
  const match = /^([0-9]*\.?[0-9]+)\s*(pt|px|em|rem|%|in|cm|mm|pc)$/.exec(value);
  if (!match) return null;
  const number = Number(match[1]);
  const points =
    { pt: number, px: number * 0.75, em: number * 11, rem: number * 11, "%": (number / 100) * 11, in: number * 72, cm: (number * 72) / 2.54, mm: (number * 72) / 25.4, pc: number * 12 }[
      match[2] as "pt"
    ];
  if (!(points >= 1 && points <= 400)) return null;
  return fitSize(points);
}

/** The first font a CSS `font-family` names that isn't a generic family,
 * if its name is one the document can keep. */
export function fontFromCss(text: string): string | null {
  const first = (text.split(",")[0] ?? "").trim().replace(/^["']|["']$/g, "").trim();
  if (/^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-[a-z]+|math|emoji|fangsong|inherit|initial|unset|-webkit-standard)$/i.test(first)) return null;
  return safeFontName(first);
}

/** Whether `text` is a picture's hash: SHA-256 in lowercase hex. */
export function isPictureHash(text: string): boolean {
  return /^[0-9a-f]{64}$/.test(text);
}

/** A link's address if it's a web page or an email address, as the server
 * allows. Anything else, such as `javascript:`, isn't a link. */
export function safeLink(href: string): string | null {
  const trimmed = href.trim();
  if (!/^(https?:\/\/|mailto:)/i.test(trimmed) || trimmed.length > 2048 || /\p{Cc}/u.test(trimmed)) return null;
  return trimmed;
}

/** What someone typed as a link's address, as one: a web address without
 * its `https://` gets it. */
export function linkFromTyped(typed: string): string | null {
  const trimmed = typed.trim();
  if (!trimmed) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return safeLink(trimmed);
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return safeLink(`mailto:${trimmed}`);
  return safeLink(`https://${trimmed}`);
}
