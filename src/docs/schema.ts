// What a document can hold (decision 30). The server has the same schema in
// accordion-docs' `src/model.rs`, and y-prosemirror stores these node and
// mark names in the co-editing document, so the two must match: a node the
// server doesn't know is left out of the file, and one the editor doesn't
// know is dropped from the document.

import { type DOMOutputSpec, type MarkSpec, type NodeSpec, Schema } from "prosemirror-model";
import { tableNodes } from "prosemirror-tables";

/** Paragraph styles, in the order the style menu lists them. */
export const HEADING_LEVELS = [1, 2, 3] as const;

const nodes: Record<string, NodeSpec> = {
  doc: { content: "block+" },
  paragraph: {
    content: "inline*",
    group: "block",
    parseDOM: [{ tag: "p" }],
    toDOM: () => ["p", 0],
  },
  heading: {
    attrs: { level: { default: 1, validate: "number" } },
    content: "inline*",
    group: "block",
    defining: true,
    parseDOM: [1, 2, 3, 4, 5, 6].map((level) => ({ tag: `h${level}`, attrs: { level } })),
    toDOM: (node) => [`h${node.attrs["level"] as number}`, 0],
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
  bullet_list: {
    content: "list_item+",
    group: "block",
    parseDOM: [{ tag: "ul" }],
    toDOM: () => ["ul", 0],
  },
  ordered_list: {
    attrs: { order: { default: 1, validate: "number" } },
    content: "list_item+",
    group: "block",
    parseDOM: [
      {
        tag: "ol",
        getAttrs: (dom) => ({ order: Number((dom as HTMLElement).getAttribute("start") ?? 1) || 1 }),
      },
    ],
    toDOM: (node) => (node.attrs["order"] === 1 ? ["ol", 0] : ["ol", { start: node.attrs["order"] as number }, 0]),
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
  bold: {
    parseDOM: [
      { tag: "strong" },
      // Google Docs wraps whole pastes in <b style="font-weight:normal">.
      { tag: "b", getAttrs: (dom) => (dom as HTMLElement).style.fontWeight !== "normal" && null },
      { style: "font-weight=400", clearMark: (mark) => mark.type.name === "bold" },
      { style: "font-weight", getAttrs: (value) => /^(bold(er)?|[5-9]\d{2,})$/.test(value) && null },
    ],
    toDOM: () => ["strong", 0],
  },
  italic: {
    parseDOM: [{ tag: "em" }, { tag: "i" }, { style: "font-style=italic" }],
    toDOM: () => ["em", 0],
  },
  underline: {
    parseDOM: [{ tag: "u" }, { tag: "ins" }, { style: "text-decoration=underline" }],
    toDOM: () => ["u", 0],
  },
  strike: {
    parseDOM: [{ tag: "s" }, { tag: "strike" }, { tag: "del" }, { style: "text-decoration=line-through" }],
    toDOM: () => ["s", 0],
  },
  code: {
    parseDOM: [{ tag: "code" }],
    toDOM: () => ["code", 0],
  },
};

export const schema = new Schema({ nodes, marks });

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
