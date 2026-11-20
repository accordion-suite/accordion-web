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
 * characters. A whole document's count is kept, so it's counted again only
 * after it changes. */
export function countDocument(doc: Node, from = 0, to = doc.content.size): Counts {
  const whole = from === 0 && to === doc.content.size;
  const known = whole ? counted.get(doc) : undefined;
  if (known) return known;
  const counts = countText(doc.textBetween(from, to, "\n", "\n"));
  if (whole) counted.set(doc, counts);
  return counts;
}
