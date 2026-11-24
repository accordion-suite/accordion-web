import assert from "node:assert/strict";
import { test } from "node:test";

import { noteSchema, offsetAt, parseNote, positionAt, writeNote } from "./rich-text.ts";

const { nodes, marks } = noteSchema;

const paragraph = (...content: ReturnType<typeof noteSchema.text>[]) => nodes["paragraph"]!.create(null, content);
const text = (value: string, ...names: string[]) =>
  noteSchema.text(
    value,
    names.map((name) => marks[name]!.create()),
  );

test("gives back a file's lines exactly as written", () => {
  const file = [
    "# Shopping #",
    "Some __bold__ and _italic_ and <u>underlined</u>",
    "- a list item with * a star",
    'See https://example.com and [a link](https://example.com "Title")',
    "",
    "```js",
    "let a = **b**;",
    "```",
    "| a | b |",
    "\\# not a heading",
    "",
  ].join("\n");
  assert.equal(writeNote(parseNote(file)), file);
});

test("shows formatting, not its marks", () => {
  const doc = parseNote("## Title\n**Bold** *it* <u>under</u> `code`\n```\n**raw**\n```");
  assert.equal(doc.child(0).type.name, "heading");
  assert.equal(doc.child(0).attrs["level"], 2);
  assert.equal(doc.child(0).textContent, "Title");
  assert.equal(doc.child(1).textContent, "Bold it under code");
  assert.deepEqual(
    doc.child(1).content.content.map((node) => node.marks.map((mark) => mark.type.name)),
    [["strong"], [], ["em"], [], ["underline"], [], ["code"]],
  );
  assert.equal(doc.child(3).type.name, "code_line");
  assert.equal(doc.child(3).textContent, "**raw**");
});

test("writes changed lines the plain way, escaping marks only where needed", () => {
  const doc = nodes["doc"]!.create(null, [
    nodes["heading"]!.create({ level: 1 }, [text("Title")]),
    paragraph(text("Bold", "strong"), text(" and "), text("both ", "strong", "em"), text("under", "underline")),
    paragraph(text("5 * 3 * 2 and snake_case")),
    paragraph(text("*not italic*")),
    paragraph(text("# not a heading")),
    paragraph(text("bold ", "strong"), text("after")),
    paragraph(),
  ]);
  assert.equal(
    writeNote(doc),
    [
      "# Title",
      "**Bold** and ***both*** <u>under</u>",
      "5 * 3 * 2 and snake_case",
      "\\*not italic\\*",
      "\\# not a heading",
      "**bold** after",
      "",
    ].join("\n"),
  );
  // Each reads back as the same text, and writes the same again.
  const again = parseNote(writeNote(doc));
  doc.forEach((block, _, index) => assert.equal(again.child(index).textContent, block.textContent));
  assert.equal(writeNote(again), writeNote(doc));
});

test("keeps an unchanged line's own marks, and rewrites only an edited one", () => {
  const doc = parseNote("__a__\n__b__");
  const edited = doc.replace(doc.child(0).nodeSize + 2, doc.child(0).nodeSize + 2, parseNote("x").slice(1, 2));
  assert.equal(writeNote(edited), "__a__\n**b**x");
});

test("maps carets between the file and the editor", () => {
  const file = "# Title\nSome **bold** text";
  const doc = parseNote(file);
  // The caret before "Title", in the file after "# ".
  assert.equal(positionAt(doc, 2), 1);
  assert.equal(offsetAt(doc, 1), 2);
  // Before "bold": "Some " is five characters into the second line.
  const second = doc.child(0).nodeSize + 1;
  assert.equal(positionAt(doc, 8 + 7), second + 5);
  assert.equal(offsetAt(doc, second + 5), 8 + 7);
  // At the end of the line, after its closing marks.
  assert.equal(offsetAt(doc, second + doc.child(1).content.size), file.length);
});
