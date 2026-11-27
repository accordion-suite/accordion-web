// **Show changes** in the version history (decision 30): a version
// compared with the one before it. The two are merged into one document,
// the newer one's text with the older one's removed words put back where
// they stood, and decorations mark what each change did: added words
// underlined, removed ones struck through, and a picture, table, or line
// that came or went outlined whole. Blocks are matched first, then words
// within matched paragraphs. Only text counts, so a change of formatting
// alone isn't marked.

import { Fragment, type Node } from "prosemirror-model";
import { Plugin } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";

export type ChangeKind = "added" | "removed";

/** A change in the merged document, from `from` to `to`. A whole change
 * covers a node, such as a picture, and is outlined. */
export interface Change {
  from: number;
  to: number;
  kind: ChangeKind;
  whole: boolean;
}

/** Comparisons bigger than this many steps give up on finding the words
 * two runs share, and show the older run removed and the newer added. */
const MOST_STEPS = 4_000_000;

/** Of blocks two runs don't share, those this alike are taken as one
 * block changed, rather than one removed and another added. */
const ALIKE = 0.3;

/** The `before` and `after` documents as one, with what changed. */
export function compareDocs(before: Node, after: Node): { doc: Node; changes: Change[] } {
  const merged = new Merged();
  compareBlocks(childrenOf(before), childrenOf(after), merged);
  return { doc: after.type.create(after.attrs, Fragment.from(merged.nodes), after.marks), changes: merged.changes };
}

/** Marks the merged document's changes. */
export function changesPlugin(changes: Change[]): Plugin {
  return new Plugin({
    props: {
      decorations: (state) =>
        DecorationSet.create(
          state.doc,
          changes.map((change) =>
            change.whole
              ? Decoration.node(change.from, change.to, { class: `docs-change-block docs-change-${change.kind}` })
              : Decoration.inline(change.from, change.to, {
                  nodeName: change.kind === "added" ? "ins" : "del",
                  class: `docs-change docs-change-${change.kind}`,
                }),
          ),
        ),
    },
  });
}

/** Nodes in a row, with their changes from the row's start. */
class Merged {
  nodes: Node[] = [];
  changes: Change[] = [];
  size = 0;

  /** Adds `node`, with `changes` counted from just before it. */
  add(node: Node, changes: Change[] = []) {
    for (const change of changes) this.changes.push({ ...change, from: change.from + this.size, to: change.to + this.size });
    this.nodes.push(node);
    this.size += node.nodeSize;
  }

  /** Adds `node`, all of it changed. */
  addWhole(node: Node, kind: ChangeKind) {
    this.add(node, wholly(node, kind));
  }
}

function childrenOf(node: Node): Node[] {
  const children: Node[] = [];
  node.forEach((child) => children.push(child));
  return children;
}

/** A node all of whose content changed, counted from just before it. A
 * paragraph's words are marked, a list's or a quote's through its
 * paragraphs, and anything else is outlined. */
function wholly(node: Node, kind: ChangeKind): Change[] {
  if (node.isTextblock) return node.content.size > 0 ? [{ from: 1, to: 1 + node.content.size, kind, whole: false }] : [];
  if (isContainer(node)) {
    const changes: Change[] = [];
    node.forEach((child, offset) => {
      for (const change of wholly(child, kind))
        changes.push({ ...change, from: change.from + offset + 1, to: change.to + offset + 1 });
    });
    return changes;
  }
  return [{ from: 0, to: node.nodeSize, kind, whole: true }];
}

/** Blocks that hold other blocks and are compared block by block. A table
 * isn't one: a table that changed is outlined whole. */
function isContainer(node: Node): boolean {
  return !node.isTextblock && !node.isAtom && !node.type.name.startsWith("table");
}

function compareBlocks(before: Node[], after: Node[], merged: Merged) {
  const beforeKeys = before.map(blockKey);
  const afterKeys = after.map(blockKey);
  for (const run of runs(beforeKeys, afterKeys)) {
    if (run.same) {
      for (const index of run.after) merged.add(after[index]!);
      continue;
    }
    alignBlocks(
      run.before.map((index) => before[index]!),
      run.after.map((index) => after[index]!),
      merged,
    );
  }
}

/** Blocks two runs don't share, paired where they're alike. */
function alignBlocks(before: Node[], after: Node[], merged: Merged) {
  // One block changed into one other reads best word by word, however
  // little is left of it.
  const one = before.length === 1 && after.length === 1 && comparable(before[0]!, after[0]!);
  const pairs = one ? [[0, 0] as const] : pairAlike(before, after);
  let b = 0;
  let a = 0;
  for (const [pairBefore, pairAfter] of [...pairs, [before.length, after.length] as const]) {
    while (b < pairBefore) {
      // A removed empty line would only show as space.
      const removed = before[b++]!;
      if (!removed.isTextblock || removed.content.size > 0) merged.addWhole(removed, "removed");
    }
    while (a < pairAfter) merged.addWhole(after[a++]!, "added");
    if (b < before.length && a < after.length) mergeBlock(before[b++]!, after[a++]!, merged);
  }
}

/** One block changed into another. */
function mergeBlock(before: Node, after: Node, merged: Merged) {
  if (before.isTextblock && after.isTextblock) {
    const { content, changes } = compareInline(before, after);
    merged.add(after.type.create(after.attrs, content, after.marks), changes);
  } else if (isContainer(after)) {
    const inner = new Merged();
    compareBlocks(childrenOf(before), childrenOf(after), inner);
    merged.add(
      after.type.create(after.attrs, Fragment.from(inner.nodes), after.marks),
      inner.changes.map((change) => ({ ...change, from: change.from + 1, to: change.to + 1 })),
    );
  } else {
    // A table whose text changed: the newer one, outlined.
    merged.addWhole(after, "added");
  }
}

/** Pairs of blocks, by their places in `before` and `after`, that are
 * alike enough to compare word by word, in order. */
function pairAlike(before: Node[], after: Node[]): (readonly [number, number])[] {
  const rows = before.length;
  const columns = after.length;
  if (rows === 0 || columns === 0 || rows * columns > 250_000) return [];
  const beforeWords = before.map(wordsOf);
  const afterWords = after.map(wordsOf);
  // The best total likeness of pairs in the first i and j blocks.
  const best = new Float64Array((rows + 1) * (columns + 1));
  const at = (i: number, j: number) => i * (columns + 1) + j;
  const score = (i: number, j: number) =>
    comparable(before[i]!, after[j]!) ? likeness(beforeWords[i]!, afterWords[j]!, before[i]!, after[j]!) : 0;
  const scores = new Float64Array(rows * columns);
  for (let i = 0; i < rows; i++) for (let j = 0; j < columns; j++) scores[i * columns + j] = score(i, j);
  for (let i = 1; i <= rows; i++) {
    for (let j = 1; j <= columns; j++) {
      const paired = scores[(i - 1) * columns + j - 1]!;
      best[at(i, j)] = Math.max(best[at(i - 1, j)]!, best[at(i, j - 1)]!, paired >= ALIKE ? best[at(i - 1, j - 1)]! + paired : 0);
    }
  }
  const pairs: [number, number][] = [];
  let i = rows;
  let j = columns;
  while (i > 0 && j > 0) {
    const paired = scores[(i - 1) * columns + j - 1]!;
    if (paired >= ALIKE && best[at(i, j)] === best[at(i - 1, j - 1)]! + paired) {
      pairs.push([i - 1, j - 1]);
      i--;
      j--;
    } else if (best[at(i, j)] === best[at(i - 1, j)]) i--;
    else j--;
  }
  return pairs.reverse();
}

/** Whether two blocks can be compared inside: two paragraphs or headings,
 * two lists or quotes of a kind, or two tables. */
function comparable(before: Node, after: Node): boolean {
  if (before.isTextblock && after.isTextblock) return true;
  if (before.isAtom || after.isAtom) return false;
  if (before.type === after.type) return true;
  const lists = ["bullet_list", "ordered_list"];
  return lists.includes(before.type.name) && lists.includes(after.type.name);
}

/** How alike two blocks are, from 0 to 1, by the words they share. */
function likeness(before: Map<string, number>, after: Map<string, number>, beforeNode: Node, afterNode: Node): number {
  if (beforeNode.type.name === "table" && afterNode.type.name === "table") return 1;
  let total = 0;
  let shared = 0;
  for (const count of before.values()) total += count;
  for (const [word, count] of after) {
    total += count;
    shared += Math.min(count, before.get(word) ?? 0);
  }
  return total === 0 ? 0 : (2 * shared) / total;
}

let wordSegmenter: Intl.Segmenter | null = null;

function segmenter(): Intl.Segmenter {
  wordSegmenter ??= new Intl.Segmenter(undefined, { granularity: "word" });
  return wordSegmenter;
}

/** A block's words, each with how often it appears. */
function wordsOf(node: Node): Map<string, number> {
  const words = new Map<string, number>();
  for (const { segment, isWordLike } of segmenter().segment(node.textContent)) {
    if (!isWordLike) continue;
    const word = segment.toLocaleLowerCase();
    words.set(word, (words.get(word) ?? 0) + 1);
  }
  return words;
}

/** What a block says, for finding blocks two versions share. Formatting
 * and layout don't count, nor a picture's size or a line's color. */
function blockKey(node: Node): string {
  const name = node.type.name;
  if (node.isTextblock) return `text ${inlineKey(node)}`;
  if (name === "image") return `image ${node.attrs["src"] as string}`;
  if (node.isAtom) return name;
  const lists = name === "ordered_list" ? "bullet_list" : name;
  const parts: string[] = [];
  node.forEach((child) => parts.push(blockKey(child)));
  return `${lists}(${parts.join("\u0000")})`;
}

function inlineKey(node: Node): string {
  let key = "";
  node.forEach((child) => {
    key += child.isText ? child.text! : `\u{fffc}${atomKey(child)}\u{fffc}`;
  });
  return key;
}

function atomKey(node: Node): string {
  return node.type.name === "footnote" ? `footnote ${node.textContent}` : node.type.name;
}

/** A word, a space, a mark, or an inline node such as a footnote, by its
 * place in its block's content. */
interface Token {
  key: string;
  from: number;
  to: number;
  /** Whether it's a word or an inline node, not a space or a mark. */
  word: boolean;
}

function tokensOf(node: Node): Token[] {
  const tokens: Token[] = [];
  let text = "";
  let textStart = 0;
  const flush = () => {
    for (const { segment, index, isWordLike } of segmenter().segment(text)) {
      tokens.push({ key: segment, from: textStart + index, to: textStart + index + segment.length, word: isWordLike ?? false });
    }
    text = "";
  };
  node.forEach((child, offset) => {
    if (child.isText) {
      if (text === "") textStart = offset;
      text += child.text!;
      return;
    }
    flush();
    tokens.push({ key: `\u{fffc}${atomKey(child)}`, from: offset, to: offset + child.nodeSize, word: true });
  });
  flush();
  return tokens;
}

/** Two paragraphs' content word by word: the newer one's, with the older
 * one's removed words before the words that took their place. Changes
 * count from just before the paragraph. */
function compareInline(before: Node, after: Node): { content: Fragment; changes: Change[] } {
  const beforeTokens = tokensOf(before);
  const afterTokens = tokensOf(after);
  let content = Fragment.empty;
  const changes: Change[] = [];
  const append = (piece: Fragment, kind: ChangeKind | null) => {
    if (piece.size === 0) return;
    const from = content.size + 1;
    content = content.append(piece);
    if (!kind) return;
    const last = changes.at(-1);
    if (last && last.kind === kind && last.to === from) last.to = from + piece.size;
    else changes.push({ from, to: from + piece.size, kind, whole: false });
  };
  const compared = runs(
    beforeTokens.map((token) => token.key),
    afterTokens.map((token) => token.key),
  );
  for (const run of joinChanges(compared, afterTokens)) {
    if (run.same) {
      for (const index of run.after) append(after.content.cut(afterTokens[index]!.from, afterTokens[index]!.to), null);
      continue;
    }
    for (const index of run.before) append(before.content.cut(beforeTokens[index]!.from, beforeTokens[index]!.to), "removed");
    for (const index of run.after) append(after.content.cut(afterTokens[index]!.from, afterTokens[index]!.to), "added");
  }
  return { content, changes };
}

/** Changes with only spaces or marks between them, as one change, so
 * "the lazy dog" changed to "a sleepy cat" reads as the one removed, then
 * the other added, not word by word. */
function joinChanges(compared: Run[], afterTokens: Token[]): Run[] {
  const joined: Run[] = [];
  compared.forEach((run, index) => {
    const between = run.same && index > 0 && index < compared.length - 1 && run.after.every((token) => !afterTokens[token]!.word);
    const last = joined.at(-1);
    if (last && !last.same && (between || !run.same)) {
      last.before.push(...run.before);
      last.after.push(...run.after);
    } else {
      joined.push({ same: run.same, before: [...run.before], after: [...run.after] });
    }
  });
  return joined;
}

/** A stretch of two sequences: items both share, or items only one of
 * them has, by index. */
export interface Run {
  same: boolean;
  before: number[];
  after: number[];
}

/** Splits two sequences into the runs they share and the runs between,
 * by their longest common subsequence. */
export function runs(before: string[], after: string[]): Run[] {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let endBefore = before.length;
  let endAfter = after.length;
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
    endBefore--;
    endAfter--;
  }
  const result: Run[] = [];
  const push = (same: boolean, b: number | null, a: number | null) => {
    let last = result.at(-1);
    if (!last || last.same !== same) {
      last = { same, before: [], after: [] };
      result.push(last);
    }
    if (b !== null) last.before.push(b);
    if (a !== null) last.after.push(a);
  };
  for (let index = 0; index < start; index++) push(true, index, index);

  const rows = endBefore - start;
  const columns = endAfter - start;
  if (rows * columns > MOST_STEPS) {
    for (let index = start; index < endBefore; index++) push(false, index, null);
    for (let index = start; index < endAfter; index++) push(false, null, index);
  } else if (rows > 0 || columns > 0) {
    // lengths[i][j]: the longest common subsequence of the middles' ends
    // from i and j.
    const lengths = new Uint32Array((rows + 1) * (columns + 1));
    const at = (i: number, j: number) => i * (columns + 1) + j;
    for (let i = rows - 1; i >= 0; i--) {
      for (let j = columns - 1; j >= 0; j--) {
        lengths[at(i, j)] =
          before[start + i] === after[start + j]
            ? lengths[at(i + 1, j + 1)]! + 1
            : Math.max(lengths[at(i + 1, j)]!, lengths[at(i, j + 1)]!);
      }
    }
    let i = 0;
    let j = 0;
    while (i < rows || j < columns) {
      if (i < rows && j < columns && before[start + i] === after[start + j]) {
        push(true, start + i++, start + j++);
      } else if (j >= columns || (i < rows && lengths[at(i + 1, j)]! >= lengths[at(i, j + 1)]!)) {
        push(false, start + i++, null);
      } else {
        push(false, null, start + j++);
      }
    }
  }
  for (let offset = 0; offset < before.length - endBefore; offset++) push(true, endBefore + offset, endAfter + offset);
  return result;
}
