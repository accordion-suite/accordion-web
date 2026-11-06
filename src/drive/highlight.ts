// Colors code in the text viewer and in Markdown's fenced code blocks. It
// splits text into keywords, strings, comments, numbers, tags, and keys by a
// small table per language rather than parsing it, which is enough to make
// code easier to read. The result is plain text pieces, never HTML, so a
// file can't put anything on the page.

export type TokenKind = "keyword" | "string" | "comment" | "number" | "tag" | "key";

export interface Token {
  kind: TokenKind | null;
  text: string;
}

/** Past this, the viewer shows plain text, so a huge file doesn't make
 * hundreds of thousands of elements. */
export const HIGHLIGHT_LIMIT = 200_000;

interface Language {
  lineComments?: string[];
  blockComments?: [string, string][];
  /** String delimiters, longest first, such as `"""` before `"`. */
  strings?: string[];
  keywords?: string;
  /** Whether keywords match in any case, as in SQL. */
  caseless?: boolean;
  /** Keys at the start of a line, before `:` or `=`, as in YAML and INI. */
  lineKeys?: boolean;
  /** Strings followed by `:` are keys, as in JSON. */
  stringKeys?: boolean;
  markup?: boolean;
}

const C_LIKE = {
  lineComments: ["//"],
  blockComments: [["/*", "*/"]] as [string, string][],
  strings: ['"', "'"],
};

const JS_KEYWORDS =
  "as async await break case catch class const continue debugger default delete do else enum export extends false finally for from function get if implements import in instanceof interface let new null of private protected public readonly return set static super switch this throw true try type typeof undefined var void while with yield";

const LANGUAGES: Record<string, Language> = {
  js: { ...C_LIKE, strings: ['"', "'", "`"], keywords: JS_KEYWORDS },
  ts: { ...C_LIKE, strings: ['"', "'", "`"], keywords: `${JS_KEYWORDS} abstract any boolean declare keyof namespace never number object string unknown` },
  rust: {
    ...C_LIKE,
    strings: ['"'],
    keywords:
      "as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while Some None Ok Err",
  },
  go: {
    ...C_LIKE,
    strings: ['"', "`", "'"],
    keywords:
      "break case chan const continue default defer else fallthrough false for func go goto if import interface map nil package range return select struct switch true type var",
  },
  c: {
    ...C_LIKE,
    keywords:
      "auto bool break case char class const constexpr continue default delete do double else enum explicit extern false float for friend goto if inline int long namespace new nullptr operator private protected public register return short signed sizeof static struct switch template this throw true try typedef typename union unsigned using virtual void volatile while #include #define #ifdef #ifndef #endif #if #else #pragma",
  },
  java: {
    ...C_LIKE,
    keywords:
      "abstract boolean break byte case catch char class const continue default do double else enum extends false final finally float for fun if implements import in instanceof int interface is long new null object override package private protected public return short static super switch this throw true try val var void when while",
  },
  csharp: {
    ...C_LIKE,
    keywords:
      "abstract as async await base bool break case catch class const continue decimal default do double else enum event false finally float for foreach if in int interface internal is long namespace new null object out override private protected public readonly ref return sealed static string struct switch this throw true try using var virtual void while",
  },
  swift: {
    ...C_LIKE,
    strings: ['"'],
    keywords:
      "as break case catch class continue default defer do else enum extension false for func guard if import in init let nil private protocol public return self static struct switch throw throws true try var where while",
  },
  php: {
    ...C_LIKE,
    lineComments: ["//", "#"],
    keywords:
      "abstract array as break case catch class const continue default do echo else elseif extends false final finally fn for foreach function if implements interface namespace new null private protected public return static switch throw true try use while",
  },
  python: {
    lineComments: ["#"],
    strings: ['"""', "'''", '"', "'"],
    keywords:
      "and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return self True try while with yield",
  },
  ruby: {
    lineComments: ["#"],
    strings: ['"', "'"],
    keywords:
      "alias and begin break case class def do else elsif end ensure false for if in module next nil not or redo require rescue retry return self super then true undef unless until when while yield",
  },
  shell: {
    lineComments: ["#"],
    strings: ['"', "'"],
    keywords:
      "if then else elif fi for while until do done case esac in function return local export readonly set unset shift exit source echo cd",
  },
  sql: {
    lineComments: ["--"],
    blockComments: [["/*", "*/"]],
    strings: ["'", '"'],
    caseless: true,
    keywords:
      "add all alter and as asc begin between by case check column commit create default delete desc distinct drop else end exists foreign from group having if in index inner insert into is join key left like limit not null on or order outer primary references returning right rollback select set table then union unique update values view when where with",
  },
  css: { blockComments: [["/*", "*/"]], strings: ['"', "'"], lineKeys: true },
  json: { strings: ['"'], keywords: "true false null", stringKeys: true },
  yaml: { lineComments: ["#"], strings: ['"', "'"], keywords: "true false null yes no", lineKeys: true },
  toml: { lineComments: ["#"], strings: ['"""', "'''", '"', "'"], keywords: "true false", lineKeys: true },
  ini: { lineComments: [";", "#"], strings: ['"'], lineKeys: true },
  markup: { markup: true },
};

const EXTENSIONS: Record<string, string> = {
  js: "js", mjs: "js", cjs: "js", jsx: "js",
  ts: "ts", mts: "ts", cts: "ts", tsx: "ts",
  rs: "rust",
  go: "go",
  c: "c", h: "c", cc: "c", cpp: "c", cxx: "c", hpp: "c", hh: "c",
  java: "java", kt: "java", kts: "java", scala: "java",
  cs: "csharp",
  swift: "swift",
  php: "php",
  py: "python", pyw: "python",
  rb: "ruby",
  sh: "shell", bash: "shell", zsh: "shell",
  sql: "sql",
  css: "css", scss: "css", less: "css",
  json: "json", jsonc: "json",
  yml: "yaml", yaml: "yaml",
  toml: "toml",
  ini: "ini", conf: "ini", cfg: "ini", properties: "ini",
  html: "markup", htm: "markup", xml: "markup", svg: "markup", vue: "markup",
};

/** Names Markdown's code fences use, beyond file extensions. */
const ALIASES: Record<string, string> = {
  javascript: "js", typescript: "ts", python: "python", rust: "rust", golang: "go",
  "c++": "c", csharp: "csharp", "c#": "csharp", kotlin: "java", ruby: "ruby",
  shell: "shell", console: "shell", yaml: "yaml", html: "markup", xml: "markup",
};

/** File extensions the viewer shows as code. */
export const CODE_EXTENSIONS = Object.keys(EXTENSIONS);

/** The language of a file name, such as "rust" for `main.rs`, or `null`. */
export function languageOfName(name: string): string | null {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return null;
  return EXTENSIONS[name.slice(dot + 1).toLowerCase()] ?? null;
}

/** The language of a Markdown fence's name, such as "ts" for `typescript`,
 * or `null`. */
export function languageOfFence(fence: string): string | null {
  const name = fence.toLowerCase();
  return ALIASES[name] ?? EXTENSIONS[name] ?? (name in LANGUAGES ? name : null);
}

const keywordSets = new Map<string, Set<string>>();

function keywordsOf(id: string, language: Language): Set<string> {
  let set = keywordSets.get(id);
  if (!set) {
    const words = (language.keywords ?? "").split(" ").filter(Boolean);
    set = new Set(language.caseless ? words.map((word) => word.toLowerCase()) : words);
    keywordSets.set(id, set);
  }
  return set;
}

/** Splits `text` into colored pieces for `language`, a name from
 * `languageOfName` or `languageOfFence`. Joined, the pieces are `text`. */
export function highlight(text: string, language: string): Token[] {
  const rules = LANGUAGES[language];
  if (!rules) return [{ kind: null, text }];
  const tokens: Token[] = [];
  const push = (kind: TokenKind | null, piece: string) => {
    if (!piece) return;
    const last = tokens[tokens.length - 1];
    if (last && last.kind === kind) last.text += piece;
    else tokens.push({ kind, text: piece });
  };
  if (rules.markup) {
    markup(text, push);
    return tokens;
  }
  const keywords = keywordsOf(language, rules);
  let i = 0;
  let lineStart = true;
  while (i < text.length) {
    const ch = text[i]!;
    if (lineStart && rules.lineKeys) {
      const key = /^([ \t]*)([A-Za-z0-9_.\-[\]"]+)([ \t]*[:=])/.exec(text.slice(i, i + 200));
      if (key && !(rules.lineComments ?? []).some((mark) => key[2]!.startsWith(mark))) {
        push(null, key[1]!);
        push("key", key[2]!);
        push(null, key[3]!);
        i += key[0].length;
        lineStart = false;
        continue;
      }
    }
    lineStart = ch === "\n";

    const line = rules.lineComments?.find((mark) => text.startsWith(mark, i));
    if (line) {
      const end = text.indexOf("\n", i);
      const stop = end < 0 ? text.length : end;
      push("comment", text.slice(i, stop));
      i = stop;
      continue;
    }
    const block = rules.blockComments?.find(([open]) => text.startsWith(open, i));
    if (block) {
      const end = text.indexOf(block[1], i + block[0].length);
      const stop = end < 0 ? text.length : end + block[1].length;
      push("comment", text.slice(i, stop));
      i = stop;
      continue;
    }
    const quote = rules.strings?.find((mark) => text.startsWith(mark, i));
    if (quote) {
      const stop = stringEnd(text, i, quote);
      const piece = text.slice(i, stop);
      const isKey = rules.stringKeys && /^[ \t]*:/.test(text.slice(stop, stop + 20));
      push(isKey ? "key" : "string", piece);
      i = stop;
      continue;
    }
    if (/[0-9]/.test(ch) && !/[\w$]/.test(text[i - 1] ?? "")) {
      const number = /^(?:0[xob][0-9a-f_]+|[0-9][0-9_]*(?:\.[0-9_]+)?(?:e[+-]?[0-9]+)?)[a-z0-9]*/i.exec(text.slice(i, i + 64))!;
      push("number", number[0]);
      i += number[0].length;
      continue;
    }
    if (/[A-Za-z_$#@]/.test(ch)) {
      const word = /^[#@]?[A-Za-z_$][\w$]*/.exec(text.slice(i, i + 128));
      if (word) {
        const name = rules.caseless ? word[0].toLowerCase() : word[0];
        push(keywords.has(name) ? "keyword" : null, word[0]);
        i += word[0].length;
        continue;
      }
    }
    push(null, ch);
    i += 1;
  }
  return tokens;
}

/** Where a string that opens at `start` with `quote` ends. A single
 * character quote ends at the line's end if it isn't closed, so one stray
 * quote doesn't color the rest of the file. */
function stringEnd(text: string, start: number, quote: string): number {
  let i = start + quote.length;
  const multiline = quote.length > 1 || quote === "`";
  while (i < text.length) {
    if (text[i] === "\\") {
      i += 2;
      continue;
    }
    if (text.startsWith(quote, i)) return i + quote.length;
    if (!multiline && text[i] === "\n") return i;
    i += 1;
  }
  return text.length;
}

/** HTML and XML: comments, tag names, attribute names, and their values. */
function markup(text: string, push: (kind: TokenKind | null, piece: string) => void) {
  let i = 0;
  while (i < text.length) {
    if (text.startsWith("<!--", i)) {
      const end = text.indexOf("-->", i + 4);
      const stop = end < 0 ? text.length : end + 3;
      push("comment", text.slice(i, stop));
      i = stop;
      continue;
    }
    const open = /^<\/?[A-Za-z!?][\w:.-]*/.exec(text.slice(i, i + 128));
    if (open) {
      push("tag", open[0]);
      i += open[0].length;
      // Attributes, up to the tag's end.
      while (i < text.length && text[i] !== ">") {
        const attribute = /^[A-Za-z_:@][\w:.@-]*/.exec(text.slice(i, i + 128));
        if (attribute) {
          push("key", attribute[0]);
          i += attribute[0].length;
        } else if (text[i] === '"' || text[i] === "'") {
          const end = text.indexOf(text[i]!, i + 1);
          const stop = end < 0 ? text.length : end + 1;
          push("string", text.slice(i, stop));
          i = stop;
        } else if (text[i] === "<") {
          break;
        } else {
          push(text[i] === "/" ? "tag" : null, text[i]!);
          i += 1;
        }
      }
      if (text[i] === ">") {
        push("tag", ">");
        i += 1;
      }
      continue;
    }
    const next = text.indexOf("<", i + 1);
    const stop = next < 0 ? text.length : next;
    push(null, text.slice(i, stop));
    i = stop;
  }
}
