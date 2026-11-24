// A note's text as formatted text for the editor, and back to Markdown for
// the file (decision 31). Each line of the file is a line in the editor: a
// paragraph, a heading, or a line of a fenced code block, as Google Keep and
// Obsidian show notes. A line nobody changed goes back to the file exactly
// as it was written, so opening and editing a note made in Obsidian changes
// only the lines that were edited. A changed line is written the plain way
// (`**bold**`, `*italic*`, `<u>underline</u>`), with `\` before marks only
// where they would otherwise format the text.

import { type Mark, type Node, Schema } from "prosemirror-model";

import { type Inline, inlines } from "../drive/markdown.ts";

export const noteSchema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      group: "block",
      content: "inline*",
      // The line as the file had it, while it's unchanged.
      attrs: { source: { default: null } },
      parseDOM: [{ tag: "p" }, { tag: "div", priority: 10 }, { tag: "li", priority: 10 }],
      toDOM: () => ["p", 0],
    },
    heading: {
      group: "block",
      content: "inline*",
      defining: true,
      attrs: { level: { default: 1 }, source: { default: null } },
      parseDOM: [1, 2, 3, 4, 5, 6].map((level) => ({ tag: `h${level}`, attrs: { level } })),
      toDOM: (node) => [`h${node.attrs["level"] as number}`, 0],
    },
    // A line of a fenced code block, from a file, kept exactly as written.
    code_line: {
      group: "block",
      content: "text*",
      marks: "",
      code: true,
      attrs: { source: { default: null } },
      toDOM: () => ["pre", { class: "note-code" }, ["code", 0]],
    },
    text: { group: "inline" },
  },
  marks: {
    // `target` is the address as written, and `form` how (see Inline).
    link: {
      attrs: { target: {}, form: { default: "inline" } },
      inclusive: false,
      parseDOM: [
        {
          tag: "a[href]",
          getAttrs: (dom) => {
            const href = (dom as HTMLElement).getAttribute("href") ?? "";
            return /^(?:https?:|mailto:)/i.test(href) ? { target: href, form: "inline" } : false;
          },
        },
      ],
      toDOM: (mark) => ["a", { class: "note-link", "data-target": mark.attrs["target"] as string }, 0],
    },
    strong: {
      // Pasted styles become these tags first (see semanticHtml).
      parseDOM: [{ tag: "strong" }, { tag: "b" }],
      toDOM: () => ["strong", 0],
    },
    em: {
      parseDOM: [{ tag: "i" }, { tag: "em" }],
      toDOM: () => ["em", 0],
    },
    underline: {
      parseDOM: [{ tag: "u" }],
      toDOM: () => ["u", 0],
    },
    del: {
      parseDOM: [{ tag: "s" }, { tag: "del" }, { tag: "strike" }],
      toDOM: () => ["del", 0],
    },
    code: {
      excludes: "_",
      parseDOM: [{ tag: "code" }],
      toDOM: () => ["code", 0],
    },
    // Something the editor doesn't edit as formatting, such as a picture
    // in the middle of a line, kept as written.
    verbatim: {
      excludes: "_",
      inclusive: false,
      toDOM: () => ["span", { class: "note-verbatim" }, 0],
    },
  },
});

const { nodes, marks } = noteSchema;

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;

/** A note's Markdown as a document for the editor. */
export function parseNote(text: string): Node {
  const lines = text.split("\n");
  const blocks: Node[] = [];
  let fence: string | null = null;
  for (const line of lines) {
    const opens = FENCE.exec(line);
    if (fence !== null) {
      blocks.push(nodes["code_line"]!.create({ source: line }, line ? noteSchema.text(line) : null));
      if (opens && opens[1]![0] === fence[0] && opens[1]!.length >= fence.length && line.trim() === opens[0].trim()) fence = null;
    } else if (opens && !(opens[1]![0] === "`" && line.slice(opens[0].length).includes("`"))) {
      fence = opens[1]!;
      blocks.push(nodes["code_line"]!.create({ source: line }, noteSchema.text(line)));
    } else {
      blocks.push(parseLine(line));
    }
  }
  return nodes["doc"]!.create(null, blocks);
}

/** One line, outside a code block, as a paragraph or a heading. */
export function parseLine(line: string): Node {
  const heading = HEADING.exec(line);
  if (heading) {
    return nodes["heading"]!.create({ level: heading[1]!.length, source: line }, textOf(inlines(heading[2] ?? ""), []));
  }
  return nodes["paragraph"]!.create({ source: line }, textOf(inlines(line), []));
}

/** Markdown's inlines as text with marks. Bare addresses stay plain text,
 * which the editor shows as links anyway, so typing one needs nothing. */
function textOf(nodes: Inline[], outer: readonly Mark[]): Node[] {
  const out: Node[] = [];
  const add = (text: string, with_: readonly Mark[]) => {
    if (text) out.push(noteSchema.text(text, with_));
  };
  for (const node of nodes) {
    switch (node.type) {
      case "text":
        add(node.text.replace(/\n/g, " "), outer);
        break;
      case "break":
        add(" ", outer);
        break;
      case "code":
        add(node.text, marks["code"]!.create().addToSet(outer));
        break;
      case "strong":
      case "em":
      case "del":
        out.push(...textOf(node.children, marks[node.type]!.create().addToSet(outer)));
        break;
      case "u":
        out.push(...textOf(node.children, marks["underline"]!.create().addToSet(outer)));
        break;
      case "link":
        if (node.form === "bare") out.push(...textOf(node.children, outer));
        else out.push(...textOf(node.children, marks["link"]!.create({ target: node.target, form: node.form }).addToSet(outer)));
        break;
      case "image":
        add(`![${node.alt}](${node.target})`, [marks["verbatim"]!.create()]);
        break;
    }
  }
  return out;
}

/** The editor's document as Markdown. */
export function writeNote(doc: Node): string {
  return lineTexts(doc).join("\n");
}

/** Each line of the document as Markdown. */
export function lineTexts(doc: Node): string[] {
  const lines: string[] = [];
  doc.forEach((block) => lines.push(writeLine(block)));
  return lines;
}

const unchanged = new Map<string, Node>();

/** A line as Markdown: as the file had it if it's the same, otherwise
 * written anew. */
export function writeLine(block: Node): string {
  const source = block.attrs["source"] as string | null;
  if (block.type === nodes["code_line"]) return block.textContent;
  if (source !== null) {
    let read = unchanged.get(source);
    if (!read) {
      read = parseLine(source);
      if (unchanged.size > 2000) unchanged.clear();
      unchanged.set(source, read);
    }
    if (sameLine(read, block)) return source;
  }
  const plain = lineMarkdown(block, false);
  if (sameLine(parseLine(plain), block)) return plain;
  return lineMarkdown(block, true);
}

/** Whether two lines read the same: the same kind, text, and formatting,
 * not counting formatting on spaces, which Markdown moves outside marks. */
export function sameLine(a: Node, b: Node): boolean {
  return a.type === b.type && a.attrs["level"] === b.attrs["level"] && signature(a) === signature(b);
}

function signature(block: Node): string {
  let out = "";
  block.forEach((child) => {
    const formatting = child.marks.map((mark) => `${mark.type.name}${JSON.stringify(mark.attrs)}`).join("+");
    for (const char of child.text ?? "") out += /\s/.test(char) ? char : `${char}\u0000${formatting}\u0001`;
  });
  return out;
}

function lineMarkdown(block: Node, escaped: boolean): string {
  const text = inlineMarkdown(block, escaped);
  if (block.type === nodes["heading"]) return `${"#".repeat(block.attrs["level"] as number)} ${text}`.trimEnd();
  // A paragraph that would read as a heading keeps its # as text.
  return escaped ? text.replace(/^(\s*)#/, "$1\\#") : text;
}

/** The order marks open in, outside in. */
const ORDER = ["link", "strong", "em", "underline", "del", "code", "verbatim"];

interface Run {
  text: string;
  marks: readonly Mark[];
}

function inlineMarkdown(block: Node, escaped: boolean): string {
  const runs: Run[] = [];
  block.forEach((child) => runs.push({ text: child.text ?? "", marks: child.marks }));
  return writeRuns(runs, escaped);
}

/** Text with marks as Markdown: each mark wraps the longest stretch that
 * has it, outermost first, so `**a *b* c**` stays one bold. */
function writeRuns(runs: Run[], escaped: boolean): string {
  let out = "";
  let i = 0;
  while (i < runs.length) {
    const run = runs[i]!;
    const first = ORDER.map((name) => run.marks.find((mark) => mark.type.name === name)).find((mark) => mark !== undefined);
    if (!first) {
      out += escaped ? escape(run.text) : run.text;
      i++;
      continue;
    }
    let end = i + 1;
    while (end < runs.length && first.isInSet(runs[end]!.marks)) end++;
    const inner = runs.slice(i, end).map((each) => ({ text: each.text, marks: first.removeFromSet(each.marks) }));
    out += wrap(first, inner, escaped);
    i = end;
  }
  return out;
}

function wrap(mark: Mark, inner: Run[], escaped: boolean): string {
  const text = inner.map((run) => run.text).join("");
  switch (mark.type.name) {
    case "verbatim":
      return text;
    case "code": {
      const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((ticks) => ticks.length));
      const ticks = "`".repeat(longest + 1);
      const pad = text.startsWith("`") || text.endsWith("`") ? " " : "";
      return `${ticks}${pad}${text}${pad}${ticks}`;
    }
    case "link": {
      const target = mark.attrs["target"] as string;
      if (mark.attrs["form"] === "auto" && text === target && inner.every((run) => run.marks.length === 0)) return `<${target}>`;
      const address = /[\s()<>]/.test(target) ? `<${target}>` : target;
      return `[${writeRuns(inner, escaped)}](${address})`;
    }
  }
  const [open, close] =
    mark.type.name === "strong"
      ? ["**", "**"]
      : mark.type.name === "em"
        ? ["*", "*"]
        : mark.type.name === "del"
          ? ["~~", "~~"]
          : ["<u>", "</u>"];
  // Spaces at either end go outside, since `** bold **` isn't bold.
  const written = writeRuns(inner, escaped);
  const lead = /^\s*/.exec(written)![0];
  const trail = /\s*$/.exec(written.slice(lead.length))![0];
  const middle = written.slice(lead.length, written.length - trail.length);
  return middle ? `${lead}${open}${middle}${close}${trail}` : written;
}

function escape(text: string): string {
  return text.replace(/[\\*_~`[\]<]/g, "\\$&");
}

/** Where each of a line's characters, as the editor shows them, is in
 * its Markdown: the shown text is the Markdown without its marks, so each
 * character is found in turn. */
function columns(shown: string, line: string): number[] {
  const at: number[] = [];
  let column = 0;
  for (const char of shown) {
    const found = line.indexOf(char, column);
    if (found < 0) break;
    for (let unit = 0; unit < char.length; unit++) at.push(found + unit);
    column = found + char.length;
  }
  // Characters it couldn't place, which shouldn't happen, go at the end.
  while (at.length < shown.length) at.push(line.length);
  return at;
}

/** The editor position for an offset in the note's Markdown, for someone
 * else's caret. */
export function positionAt(doc: Node, offset: number): number {
  const lines = lineTexts(doc);
  let start = 0;
  let position = 0;
  for (let index = 0; index < doc.childCount; index++) {
    const block = doc.child(index);
    const line = lines[index]!;
    if (offset <= start + line.length || index === doc.childCount - 1) {
      const column = Math.min(offset - start, line.length);
      const at = columns(block.textContent, line);
      let shown = 0;
      while (shown < at.length && at[shown]! < column) shown++;
      return position + 1 + shown;
    }
    start += line.length + 1;
    position += block.nodeSize;
  }
  return 1;
}

/** The offset in the note's Markdown for an editor position, for the
 * reader's own caret. */
export function offsetAt(doc: Node, position: number): number {
  const lines = lineTexts(doc);
  let start = 0;
  let blockStart = 0;
  for (let index = 0; index < doc.childCount; index++) {
    const block = doc.child(index);
    const line = lines[index]!;
    if (position < blockStart + block.nodeSize || index === doc.childCount - 1) {
      const shown = Math.max(0, Math.min(position - blockStart - 1, block.content.size));
      const at = columns(block.textContent, line);
      const column = shown < at.length ? at[shown]! : at.length > 0 ? closingColumn(line, at[at.length - 1]! + 1) : line.length;
      return start + column;
    }
    start += line.length + 1;
    blockStart += block.nodeSize;
  }
  return 0;
}

/** The end of a line's text, past marks that close it, such as `**`. */
function closingColumn(line: string, after: number): number {
  const rest = /^(?:\*\*|\*|~~|<\/u>|`+|\]\([^)]*\)|>)*/.exec(line.slice(after))![0];
  return after + rest.length;
}
