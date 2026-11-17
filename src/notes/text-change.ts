// The smallest change between two texts, for a shared note: the reader's
// typing goes into the live document as just that change, and someone
// else's change moves the reader's caret with the words around it.

/** What changed from `before` to `after`: `removed` characters at `start`
 * gave way to `inserted`. Offsets count UTF-16 code units, as the browser
 * and Yjs do. */
export interface TextChange {
  start: number;
  removed: number;
  inserted: string;
}

export function textChange(before: string, after: string): TextChange | null {
  if (before === after) return null;
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let end = 0;
  while (
    end < before.length - start &&
    end < after.length - start &&
    before[before.length - 1 - end] === after[after.length - 1 - end]
  ) {
    end++;
  }
  // Never split a character made of two code units, such as an emoji.
  if (start > 0 && isHighSurrogate(before.charCodeAt(start - 1))) start--;
  if (end > 0 && isLowSurrogate(before.charCodeAt(before.length - end))) end--;
  return { start, removed: before.length - start - end, inserted: after.slice(start, after.length - end) };
}

/** Where the caret goes when the text it's in changes from `before` to
 * `after` elsewhere: it stays with the words around it. */
export function shiftCaret(before: string, after: string, caret: number): number {
  const change = textChange(before, after);
  if (!change || caret <= change.start) return caret;
  const changedEnd = change.start + change.removed;
  // After the change, it keeps its distance from the end.
  if (caret >= changedEnd) return caret + change.inserted.length - change.removed;
  // Inside text that was replaced, it goes to the end of the new text.
  return change.start + change.inserted.length;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/** The reader's text `mine` with what someone else added to the end of
 * `base` meanwhile, as `theirs` has it, such as a voice memo's transcript,
 * which Notes adds to the end of a note. Null if `theirs` changed more
 * than its end, so the reader's change can't keep both. */
export function withAddedAtEnd(base: string, mine: string, theirs: string): string | null {
  if (theirs === base || !theirs.startsWith(base)) return null;
  const added = theirs.slice(base.length).replace(/^\n+/, "");
  if (added.trim() === "") return mine;
  const kept = mine.replace(/\n+$/, "");
  return kept === "" ? added : `${kept}\n\n${added}`;
}
