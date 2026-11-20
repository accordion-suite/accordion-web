// Changes made while typing (decision 30, step 3, part 3), as Google Docs
// makes them: straight quotes become curly ones, and a web or email address
// becomes a link once a space or Enter follows it. Ctrl+Z right after one
// takes it back, and Tools > Preferences turns each off.

import { InputRule } from "prosemirror-inputrules";
import type { MarkType } from "prosemirror-model";
import type { Command, EditorState, Transaction } from "prosemirror-state";

import { linkFromTyped, schema } from "./schema.ts";

export interface TypingPreferences {
  smartQuotes: boolean;
  autoLinks: boolean;
}

const KEY = "accordion.docs.typing";

/** What this browser chose, both on unless turned off. Like the word
 * count, it's a convenience, so it's kept in the browser. */
export const typing: TypingPreferences = readTyping();

function readTyping(): TypingPreferences {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<TypingPreferences>;
    return { smartQuotes: saved.smartQuotes !== false, autoLinks: saved.autoLinks !== false };
  } catch {
    return { smartQuotes: true, autoLinks: true };
  }
}

/** Changes the preferences, for this page at once and for the next. */
export function saveTyping(next: TypingPreferences) {
  Object.assign(typing, next);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // They last until the page closes.
  }
}

const link = () => schema.marks["link"] as MarkType;

/** An opening quote after the start of a line, a space, a bracket, or
 * another opening quote, and a closing one anywhere else, so "it's" gets an
 * apostrophe. */
const OPENS_AFTER = /(?:^|[\s{[(<"'‘“—–-])$/;

function quoteRule(straight: string, open: string, close: string): InputRule {
  return new InputRule(
    new RegExp(`${straight}$`),
    (state, match, start, end) => {
      if (!typing.smartQuotes) return null;
      const at = start + match[0].length - 1;
      const $at = state.doc.resolve(at);
      const before = $at.parent.textBetween(0, $at.parentOffset, undefined, "￼");
      return state.tr.insertText(OPENS_AFTER.test(before) ? open : close, at, end);
    },
    { inCodeMark: false },
  );
}

export const smartQuotes = [quoteRule('"', "“", "”"), quoteRule("'", "‘", "’")];

/** Common endings of web addresses written without `https://` or `www.`,
 * so "example.org" becomes a link but "plans.html" and "e.g." don't. */
const DOMAINS =
  "com|org|net|edu|gov|mil|int|info|biz|io|dev|app|ai|co|me|tv|us|uk|ca|au|nz|ie|de|fr|es|it|nl|be|ch|at|se|no|dk|fi|pl|pt|br|mx|in|jp|cn|kr|ru|eu|xyz|online|site|blog|shop|news";
const BARE = new RegExp(`^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\\.)+(?:${DOMAINS})(?::\\d+)?(?:[/?#]\\S*)?$`, "i");

/** Where a link is in `word`, a run of text between spaces, and where it
 * goes, or null if it isn't an address. Punctuation around it, such as a
 * sentence's full stop or brackets, stays out of the link. */
export function linkInWord(word: string): { start: number; end: number; href: string } | null {
  let start = 0;
  let end = word.length;
  while (start < end && /[("'‘“<[]/.test(word[start]!)) start++;
  for (;;) {
    const last = word[end - 1];
    if (last === undefined || end <= start) break;
    if (/[.,;:!?"'’”>\]]/.test(last)) end--;
    else if (last === ")" && !word.slice(start, end - 1).includes("(")) end--;
    else break;
  }
  const text = word.slice(start, end);
  const address =
    /^(https?:\/\/|mailto:)\S+$/i.test(text) ||
    /^www\.[^\s.]+\.\S+$/i.test(text) ||
    /^[^\s@/:]+@([a-z0-9-]+\.)+[a-z]{2,}$/i.test(text) ||
    BARE.test(text);
  const href = address ? linkFromTyped(text) : null;
  // "https://" alone isn't anywhere yet.
  if (!href || /^(https?:\/\/|mailto:)$/i.test(text)) return null;
  return { start, end, href };
}

/** Links the address that ends at `pos`, if there's one and it isn't
 * linked yet. */
function linkBefore(state: EditorState, tr: Transaction, pos: number): boolean {
  const $pos = tr.doc.resolve(pos);
  if ($pos.parent.type.spec.code) return false;
  const before = $pos.parent.textBetween(0, $pos.parentOffset, undefined, "￼");
  const word = /\S+$/.exec(before)?.[0];
  if (!word) return false;
  const found = linkInWord(word);
  if (!found) return false;
  const from = pos - word.length + found.start;
  const to = pos - word.length + found.end;
  if (tr.doc.rangeHasMark(from, to, link()) || tr.doc.rangeHasMark(from, to, state.schema.marks["code"]!)) return false;
  tr.addMark(from, to, link().create({ href: found.href }));
  return true;
}

/** Links an address when a space is typed after it. */
export const autoLink = new InputRule(
  /\S\s$/,
  (state, match, start, end) => {
    if (!typing.autoLinks) return null;
    const at = start + match[0].length - 1;
    const tr = state.tr.insertText(match[0].slice(-1), at, end);
    return linkBefore(state, tr, at) ? tr : null;
  },
  { inCodeMark: false },
);

/** Links an address before the caret as Enter ends its line. It goes in
 * a keymap of its own ahead of Enter's, and lets Enter carry on. */
export const autoLinkOnEnter: Command = (state, dispatch) => {
  if (!typing.autoLinks || !state.selection.empty) return false;
  const tr = state.tr;
  if (linkBefore(state, tr, state.selection.from)) dispatch?.(tr);
  return false;
};
