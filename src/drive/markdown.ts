// Reads Markdown for the text viewer and the editor's preview. It covers the
// parts of CommonMark people use most, plus GitHub's tables, task lists, and
// strikethrough. It builds a tree that the page turns into elements, never
// HTML, so a file can't run anything: HTML in a file shows as text. Pictures
// show as links, because loading them would reach other servers.

export type Inline =
  | { type: "text"; text: string }
  | { type: "strong" | "em" | "del"; children: Inline[] }
  | { type: "code"; text: string }
  /** `href` is null for an address that isn't safe to follow, such as a
   * script, so the link shows as plain text. */
  | { type: "link"; href: string | null; children: Inline[] }
  | { type: "image"; href: string | null; alt: string }
  | { type: "break" };

export type Align = "left" | "center" | "right" | null;

export interface ListItem {
  /** For a task, whether it's done. Null for other items. */
  checked: boolean | null;
  children: Block[];
}

export type Block =
  | { type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; children: Inline[] }
  | { type: "paragraph"; children: Inline[] }
  | { type: "code"; language: string; text: string }
  | { type: "quote"; children: Block[] }
  /** A tight list has no blank lines between its items, so its paragraphs
   * show without space around them. */
  | { type: "list"; ordered: boolean; start: number; tight: boolean; items: ListItem[] }
  | { type: "rule" }
  | { type: "table"; align: Align[]; head: Inline[][]; rows: Inline[][][] };

export function parseMarkdown(source: string): Block[] {
  return blocks(source.replace(/\r\n?/g, "\n").split("\n").map(expandTabs));
}

/** Tabs in a line's indent count as four spaces, as CommonMark's tab stops
 * mostly work out. */
function expandTabs(line: string): string {
  const indent = /^[ \t]*/.exec(line)![0];
  return indent.includes("\t") ? indent.replace(/\t/g, "    ") + line.slice(indent.length) : line;
}

const FENCE = /^( {0,3})(`{3,}|~{3,})[ \t]*([^\s`]*)[^`]*$/;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/;
const RULE = /^ {0,3}(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/;
const QUOTE = /^ {0,3}> ?/;
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/;
const DELIMITER_ROW = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;

const blank = (line: string) => line.trim() === "";
const indentOf = (line: string) => /^ */.exec(line)![0].length;

interface Marker {
  ordered: boolean;
  start: number;
  /** The bullet, or the character after an ordered item's number, which
   * every item in the list shares. */
  kind: string;
  /** Where the item's content starts, which its other lines line up with. */
  content: number;
  first: string;
}

function marker(line: string): Marker | null {
  const found = /^( {0,3})(?:([-*+])|(\d{1,9})([.)]))(?:( +)(.*)|$)/.exec(line);
  if (!found) return null;
  const [, indent, bullet, number, delimiter, spaces = "", rest = ""] = found;
  const width = indent!.length + (bullet ?? number! + delimiter!).length;
  // Five spaces or more after the marker start indented code, which this
  // reader leaves as text, so they count as one.
  const gap = spaces.length === 0 || spaces.length > 4 ? 1 : spaces.length;
  return {
    ordered: bullet === undefined,
    start: number === undefined ? 1 : Number(number),
    kind: bullet ?? delimiter!,
    content: width + gap,
    first: spaces.length > 4 ? spaces.slice(1) + rest : rest,
  };
}

/** Whether `line` starts a block that ends a paragraph above it. */
function interrupts(line: string): boolean {
  if (FENCE.test(line) || HEADING.test(line) || RULE.test(line) || QUOTE.test(line)) return true;
  const item = marker(line);
  // Only a list that starts at 1 and has something in it, as CommonMark
  // says, so a line like "2014. What a year" stays in its paragraph.
  return item !== null && item.first.trim() !== "" && (!item.ordered || item.start === 1);
}

function blocks(lines: string[]): Block[] {
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (blank(line)) {
      i++;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      const [, indent, open, language] = fence;
      const close = new RegExp(`^ {0,3}${open![0] === "`" ? "`" : "~"}{${open!.length},}[ \\t]*$`);
      const code: string[] = [];
      i++;
      while (i < lines.length && !close.test(lines[i]!)) {
        // Lines lose as much indent as the fence had.
        code.push(lines[i]!.replace(new RegExp(`^ {0,${indent!.length}}`), ""));
        i++;
      }
      i++;
      out.push({ type: "code", language: language ?? "", text: code.join("\n") });
      continue;
    }

    if (indentOf(line) >= 4) {
      const code: string[] = [];
      while (i < lines.length && (blank(lines[i]!) || indentOf(lines[i]!) >= 4)) {
        code.push(lines[i]!.slice(4));
        i++;
      }
      while (code.length > 0 && blank(code[code.length - 1]!)) code.pop();
      out.push({ type: "code", language: "", text: code.join("\n") });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      // A closing run of #s isn't part of the heading.
      const text = (heading[2] ?? "").replace(/(?:^|[ \t]+)#+$/, "");
      out.push({ type: "heading", level: heading[1]!.length as 1 | 2 | 3 | 4 | 5 | 6, children: inlines(text) });
      i++;
      continue;
    }

    if (RULE.test(line)) {
      out.push({ type: "rule" });
      i++;
      continue;
    }

    if (QUOTE.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && !blank(lines[i]!)) {
        const current = lines[i]!;
        if (QUOTE.test(current)) quoted.push(current.replace(QUOTE, ""));
        // A line that carries on a paragraph belongs to the quote too.
        else if (!interrupts(current)) quoted.push(current);
        else break;
        i++;
      }
      out.push({ type: "quote", children: blocks(quoted) });
      continue;
    }

    const item = marker(line);
    if (item) {
      i = list(lines, i, item, out);
      continue;
    }

    if (line.includes("|") && i + 1 < lines.length && DELIMITER_ROW.test(lines[i + 1]!)) {
      const head = cells(line);
      const align = cells(lines[i + 1]!).map(alignment);
      if (head.length === align.length) {
        const rows: Inline[][][] = [];
        i += 2;
        while (i < lines.length && !blank(lines[i]!) && !interrupts(lines[i]!)) {
          const row = cells(lines[i]!);
          rows.push(align.map((_, column) => inlines(row[column] ?? "")));
          i++;
        }
        out.push({ type: "table", align, head: head.map(inlines), rows });
        continue;
      }
    }

    const paragraph: string[] = [];
    let level: 1 | 2 | null = null;
    while (i < lines.length && !blank(lines[i]!)) {
      const current = lines[i]!;
      const underline = SETEXT.exec(current);
      if (paragraph.length > 0 && underline) {
        level = underline[1]![0] === "=" ? 1 : 2;
        i++;
        break;
      }
      if (paragraph.length > 0 && interrupts(current)) break;
      paragraph.push(current.trimStart());
      i++;
    }
    const children = inlines(paragraph.join("\n"));
    out.push(level ? { type: "heading", level, children } : { type: "paragraph", children });
  }
  return out;
}

/** Reads the list that starts at line `i`, adds it to `out`, and returns
 * the line after it. */
function list(lines: string[], i: number, first: Marker, out: Block[]): number {
  const items: ListItem[] = [];
  let tight = true;
  let item: Marker | null = first;
  while (item) {
    const content = [item.first];
    i++;
    while (i < lines.length) {
      const line = lines[i]!;
      if (blank(line)) {
        content.push("");
      } else if (indentOf(line) >= item.content) {
        content.push(line.slice(item.content));
      } else if (!blank(content[content.length - 1]!) && !interrupts(line) && !marker(line)) {
        // A line that carries on the item's last paragraph. Any marker
        // starts the next item instead.
        content.push(line.trimStart());
      } else {
        break;
      }
      i++;
    }
    // Blank lines at the end belong between items, not in this one.
    let trailing = 0;
    while (content.length > 1 && blank(content[content.length - 1]!)) {
      content.pop();
      trailing++;
    }
    const inner = content.slice(0, -1).some(blank) && blocks(content).length > 1;
    let checked: boolean | null = null;
    const task = /^\[([ xX])\](?:[ \t]+|$)/.exec(content[0]!);
    if (task) {
      checked = task[1] !== " ";
      content[0] = content[0]!.slice(task[0].length);
    }
    items.push({ checked, children: blocks(content) });

    const next = i < lines.length ? marker(lines[i]!) : null;
    if (next && next.ordered === first.ordered && next.kind === first.kind) {
      if (trailing > 0 || inner) tight = false;
      item = next;
    } else {
      if (inner) tight = false;
      item = null;
    }
  }
  out.push({ type: "list", ordered: first.ordered, start: first.start, tight, items });
  return i;
}

/** A table row's cells. A pipe inside a cell is written `\|`. */
function cells(row: string): string[] {
  let text = row.trim();
  if (text.startsWith("|")) text = text.slice(1);
  if (text.endsWith("|") && !text.endsWith("\\|")) text = text.slice(0, -1);
  return text.split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, "|"));
}

function alignment(delimiter: string): Align {
  const left = delimiter.startsWith(":");
  const right = delimiter.endsWith(":");
  return left && right ? "center" : right ? "right" : left ? "left" : null;
}

const PUNCTUATION = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~";

const runLength = (text: string, at: number, char: string) => {
  let end = at;
  while (text[end] === char) end++;
  return end - at;
};

/** Where the code span opened by the backticks at `at` ends, or -1. */
function codeEnd(text: string, at: number): number {
  const run = runLength(text, at, "`");
  for (let i = at + run; i < text.length; ) {
    if (text[i] !== "`") {
      i++;
      continue;
    }
    const length = runLength(text, i, "`");
    if (length === run) return i;
    i += length;
  }
  return -1;
}

const space = (char: string | undefined) => char === undefined || /\s/.test(char);
const wordy = (char: string | undefined) => char !== undefined && /[\p{L}\p{N}]/u.test(char);

export function inlines(source: string): Inline[] {
  const out: Inline[] = [];
  let text = "";
  const flush = () => {
    if (text) out.push({ type: "text", text });
    text = "";
  };
  let i = 0;
  while (i < source.length) {
    const char = source[i]!;

    if (char === "\\") {
      const next = source[i + 1];
      if (next === "\n") {
        flush();
        out.push({ type: "break" });
        i += 2;
      } else if (next !== undefined && PUNCTUATION.includes(next)) {
        text += next;
        i += 2;
      } else {
        text += char;
        i++;
      }
      continue;
    }

    if (char === "`") {
      const run = runLength(source, i, "`");
      const end = codeEnd(source, i);
      if (end < 0) {
        text += source.slice(i, i + run);
        i += run;
        continue;
      }
      let code = source.slice(i + run, end).replace(/\n/g, " ");
      if (code.length > 1 && code.startsWith(" ") && code.endsWith(" ") && code.trim()) code = code.slice(1, -1);
      flush();
      out.push({ type: "code", text: code });
      i = end + run;
      continue;
    }

    if (char === "[" || (char === "!" && source[i + 1] === "[")) {
      const picture = char === "!";
      const link = linkAt(source, picture ? i + 1 : i);
      if (link) {
        flush();
        const href = safeHref(link.href);
        out.push(
          picture
            ? { type: "image", href, alt: plain(inlines(link.label)) }
            : { type: "link", href, children: inlines(link.label) },
        );
        i = link.end;
        continue;
      }
    }

    if (char === "<") {
      const auto = /^<((?:https?|mailto):[^\s<>]*)>/i.exec(source.slice(i));
      if (auto) {
        flush();
        out.push({ type: "link", href: auto[1]!, children: [{ type: "text", text: auto[1]! }] });
        i += auto[0].length;
        continue;
      }
    }

    if ((char === "h" || char === "w") && (i === 0 || /[\s(]/.test(source[i - 1]!))) {
      // Bare addresses link themselves, as on GitHub, without the
      // punctuation that ends a sentence.
      const bare = /^(?:https?:\/\/|www\.)[^\s<]*[^\s<?!.,:;*_~)'"]/i.exec(source.slice(i));
      if (bare) {
        flush();
        const address = bare[0];
        out.push({
          type: "link",
          href: /^www\./i.test(address) ? `https://${address}` : address,
          children: [{ type: "text", text: address }],
        });
        i += address.length;
        continue;
      }
    }

    if (char === "*" || char === "_" || char === "~") {
      const found = emphasis(source, i);
      if (found) {
        flush();
        out.push(found.node);
        i = found.end;
      } else {
        const run = runLength(source, i, char);
        text += source.slice(i, i + run);
        i += run;
      }
      continue;
    }

    if (char === "\n") {
      // Two spaces at the end of a line break it. Otherwise lines join.
      const hard = text.endsWith("  ");
      text = text.replace(/ +$/, "");
      if (hard) {
        flush();
        out.push({ type: "break" });
      } else {
        text += "\n";
      }
      i++;
      while (source[i] === " ") i++;
      continue;
    }

    text += char;
    i++;
  }
  flush();
  return out;
}

/** The emphasis that the run of `*`, `_`, or `~` at `at` opens, if it
 * closes later on. */
function emphasis(source: string, at: number): { node: Inline; end: number } | null {
  const char = source[at]!;
  const run = runLength(source, at, char);
  if (char === "~" ? run !== 2 : run > 3) return null;
  // An opener comes before a word, and an underscore not inside one, so
  // names like snake_case stay as they are.
  if (space(source[at + run]) || (char === "_" && wordy(source[at - 1]))) return null;
  for (let i = at + run; i < source.length; ) {
    const current = source[i]!;
    if (current === "\\") {
      i += 2;
      continue;
    }
    if (current === "`") {
      const end = codeEnd(source, i);
      i = end < 0 ? i + 1 : end + runLength(source, end, "`");
      continue;
    }
    if (current !== char) {
      i++;
      continue;
    }
    const length = runLength(source, i, char);
    const closes =
      length === run && !space(source[i - 1]) && !(char === "_" && wordy(source[i + length])) && i > at + run;
    if (closes) {
      const children = inlines(source.slice(at + run, i));
      const node: Inline =
        char === "~"
          ? { type: "del", children }
          : run === 3
            ? { type: "strong", children: [{ type: "em", children }] }
            : { type: run === 2 ? "strong" : "em", children };
      return { node, end: i + length };
    }
    i += length;
  }
  return null;
}

/** A link written `[label](address "title")`, starting at the `[`. The
 * title isn't shown. */
function linkAt(source: string, at: number): { label: string; href: string; end: number } | null {
  let depth = 0;
  let close = -1;
  for (let i = at; i < source.length; i++) {
    const char = source[i];
    if (char === "\\") {
      i++;
    } else if (char === "`") {
      const end = codeEnd(source, i);
      if (end >= 0) i = end + runLength(source, end, "`") - 1;
    } else if (char === "[") {
      depth++;
    } else if (char === "]" && --depth === 0) {
      close = i;
      break;
    }
  }
  if (close < 0 || source[close + 1] !== "(") return null;
  const rest = source.slice(close + 2);
  const found = /^[ \t\n]*(?:<([^<>\n]*)>|((?:[^\s()\\]|\\.|\((?:[^\s()\\]|\\.)*\))*))(?:[ \t\n]+(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\((?:[^()\\]|\\.)*\)))?[ \t\n]*\)/.exec(
    rest,
  );
  if (!found) return null;
  const href = (found[1] ?? found[2] ?? "").replace(/\\([!-/:-@[-`{-~])/g, "$1");
  return { label: source.slice(at + 1, close), href, end: close + 2 + found[0].length };
}

/** `href` if following it is safe: a web page or an email address. Other
 * kinds, such as `javascript:`, could run code, and addresses inside the
 * file have nothing to lead to. */
export function safeHref(href: string): string | null {
  const trimmed = href.trim();
  return /^(?:https?:\/\/|mailto:)/i.test(trimmed) ? trimmed : null;
}

/** The text of some inlines, for a picture's description. */
function plain(nodes: Inline[]): string {
  return nodes
    .map((node) =>
      node.type === "text" || node.type === "code"
        ? node.text
        : node.type === "break"
          ? " "
          : node.type === "image"
            ? node.alt
            : plain(node.children),
    )
    .join("");
}
