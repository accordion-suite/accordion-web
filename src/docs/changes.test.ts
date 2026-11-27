import assert from "node:assert/strict";
import { test } from "node:test";

import type { MarkType, Node, NodeType } from "prosemirror-model";

import { type Change, compareDocs, runs } from "./changes.ts";
import { schema } from "./schema.ts";

const nodes = schema.nodes as Record<string, NodeType>;
const marks = schema.marks as Record<string, MarkType>;
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

const p = (...content: (string | Node)[]) =>
  nodes["paragraph"]!.create(
    null,
    content.map((part) => (typeof part === "string" ? schema.text(part) : part)),
  );
const doc = (...blocks: Node[]) => nodes["doc"]!.create(null, blocks);
const image = (src: string) => nodes["image"]!.create({ src });
const list = (...items: string[]) =>
  nodes["bullet_list"]!.create(
    null,
    items.map((item) => nodes["list_item"]!.create(null, p(item))),
  );
const table = (...cells: string[]) =>
  nodes["table"]!.create(
    null,
    nodes["table_row"]!.create(
      null,
      cells.map((cell) => nodes["table_cell"]!.create(null, p(cell))),
    ),
  );

/** Each paragraph of the merged document, with `[+added+]` and
 * `[-removed-]` words, and each outlined node as `{+name+}` or
 * `{-name-}`. */
function described(result: { doc: Node; changes: Change[] }): string[] {
  const kindAt = (pos: number) => result.changes.find((change) => !change.whole && change.from <= pos && pos < change.to)?.kind;
  const lines: string[] = [];
  result.doc.descendants((node, pos) => {
    const whole = result.changes.find((change) => change.whole && change.from === pos);
    if (whole) {
      lines.push(whole.kind === "added" ? `{+${node.type.name}+}` : `{-${node.type.name}-}`);
      return false;
    }
    if (!node.isTextblock) return true;
    let line = "";
    let open: string | undefined;
    const close = () => {
      if (open) line += open === "added" ? "+]" : "-]";
    };
    node.forEach((child, offset) => {
      const text = child.isText ? child.text! : "^";
      for (let index = 0; index < text.length; index++) {
        const kind = kindAt(pos + 1 + offset + (child.isText ? index : 0));
        if (kind !== open) {
          close();
          if (kind) line += kind === "added" ? "[+" : "[-";
          open = kind;
        }
        line += text[index];
      }
    });
    close();
    lines.push(line);
    return false;
  });
  return lines;
}

test("a changed word shows the old one struck and the new one after it", () => {
  const result = compareDocs(doc(p("The quick brown fox")), doc(p("The slow brown fox")));
  assert.deepEqual(described(result), ["The [-quick-][+slow+] brown fox"]);
});

test("words changed together read as one change", () => {
  const result = compareDocs(doc(p("Over the lazy dog.")), doc(p("Over a sleepy cat.")));
  assert.deepEqual(described(result), ["Over [-the lazy dog-][+a sleepy cat+]."]);
});

test("formatting alone isn't a change", () => {
  const bold = schema.text("quick", [marks["bold"]!.create()]);
  const before = doc(p("The quick fox"));
  const after = doc(nodes["heading"]!.create({ level: 2 }, [schema.text("The "), bold, schema.text(" fox")]));
  const result = compareDocs(before, after);
  assert.deepEqual(result.changes, []);
  assert.ok(result.doc.eq(after));
});

test("words keep the newer version's formatting and removed ones the older's", () => {
  const italic = schema.text("old", [marks["italic"]!.create()]);
  const result = compareDocs(doc(p("An ", italic, " word")), doc(p("An new word")));
  assert.deepEqual(described(result), ["An [-old-][+new+] word"]);
  const removed = result.doc.firstChild!.child(1);
  assert.equal(removed.text, "old");
  assert.ok(removed.marks.some((mark) => mark.type.name === "italic"));
});

test("paragraphs added and removed are marked whole, and alike ones word by word", () => {
  const before = doc(p("Shopping list for the week"), p("Remember the milk"), p("Call the plumber"));
  const after = doc(p("Shopping list for next week"), p("A new paragraph here"), p("Call the plumber"));
  assert.deepEqual(described(compareDocs(before, after)), [
    "Shopping list for [-the-][+next+] week",
    "[-Remember the milk-]",
    "[+A new paragraph here+]",
    "Call the plumber",
  ]);
});

test("a removed empty line isn't put back", () => {
  assert.deepEqual(described(compareDocs(doc(p("One"), p(), p("Two")), doc(p("One"), p("Two")))), ["One", "Two"]);
});

test("pictures that came or went are outlined, and a changed table outlined whole", () => {
  const before = doc(p("Photos"), image(HASH_A), table("Apples", "Pears"));
  const after = doc(p("Photos"), image(HASH_B), table("Apples", "Plums"));
  assert.deepEqual(described(compareDocs(before, after)), ["Photos", "{-image-}", "{+image+}", "{+table+}"]);
});

test("a picture's size alone isn't a change", () => {
  const after = doc(p("Photo"), nodes["image"]!.create({ src: HASH_A, width: 200 }));
  assert.deepEqual(compareDocs(doc(p("Photo"), image(HASH_A)), after).changes, []);
});

test("list items are compared inside their list", () => {
  const result = compareDocs(doc(list("Eggs", "Bread and butter", "Jam")), doc(list("Eggs", "Bread and cheese", "Tea")));
  assert.deepEqual(described(result), ["Eggs", "Bread and [-butter-][+cheese+]", "[-Jam-]", "[+Tea+]"]);
});

test("a new list is marked through its items", () => {
  const result = compareDocs(doc(p("Intro")), doc(p("Intro"), list("One", "Two")));
  assert.deepEqual(described(result), ["Intro", "[+One+]", "[+Two+]"]);
});

test("line breaks and footnotes count as words", () => {
  const footnote = (text: string) => nodes["footnote"]!.create(null, schema.text(text));
  const brk = () => nodes["hard_break"]!.create();
  const result = compareDocs(doc(p("Line", brk(), "next", footnote("Old note"))), doc(p("Line next", footnote("New note"))));
  assert.deepEqual(described(result), ["Line[-^-][+ +]next[-^-][+^+]"]);
});

test("runs split two lists at what they share", () => {
  assert.deepEqual(runs(["a", "b", "c", "d"], ["a", "x", "c", "d", "e"]), [
    { same: true, before: [0], after: [0] },
    { same: false, before: [1], after: [1] },
    { same: true, before: [2, 3], after: [2, 3] },
    { same: false, before: [], after: [4] },
  ]);
  assert.deepEqual(runs([], []), []);
});
