// Word count (decision 30, step 3, part 3): words, characters, and
// characters without spaces, as Google Docs counts them.

import type { Node } from "prosemirror-model";

export interface Counts {
  words: number;
  characters: number;
  /** Characters that aren't spaces, tabs, or line breaks. */
  letters: number;
}

const words = new Intl.Segmenter(undefined, { granularity: "word" });
const characters = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Counts `text`. The browser's word rules count each Chinese or Japanese
 * word, which have no spaces between them, and leave out punctuation. A
 * character is what you see as one, so an emoji or an accented letter
 * counts once however it's stored. */
export function countText(text: string): Counts {
  let wordCount = 0;
  for (const segment of words.segment(text)) if (segment.isWordLike) wordCount++;
  let all = 0;
  let letters = 0;
  for (const { segment } of characters.segment(text)) {
    if (segment === "\n") continue;
    all++;
    if (!/^\s+$/u.test(segment)) letters++;
  }
  return { words: wordCount, characters: all, letters };
}

const counted = new WeakMap<Node, Counts>();

/** Counts the document's text from `from` to `to`, or all of it. Each
 * paragraph ends a word, and paragraph breaks and pictures aren't
 * characters. Footnotes aren't counted, as Google Docs leaves them out. A
 * whole document's count is kept, so it's counted again only after it
 * changes. */
export function countDocument(doc: Node, from = 0, to = doc.content.size): Counts {
  const whole = from === 0 && to === doc.content.size;
  const known = whole ? counted.get(doc) : undefined;
  if (known) return known;
  const counts = countText(textWithoutNotes(doc, from, to));
  if (whole) counted.set(doc, counts);
  return counts;
}

/** The text from `from` to `to`, as ProseMirror's `textBetween` gives it
 * with a line between blocks and for each picture, without footnotes. */
function textWithoutNotes(doc: Node, from: number, to: number): string {
  let text = "";
  let first = true;
  doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.name === "footnote") return false;
    const own = node.isText ? node.text!.slice(Math.max(from, pos) - pos, to - pos) : node.isLeaf ? "\n" : "";
    if (node.isBlock && ((node.isLeaf && own) || node.isTextblock)) {
      if (first) first = false;
      else text += "\n";
    }
    text += own;
    return true;
  });
  return text;
}
