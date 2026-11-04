import assert from "node:assert/strict";
import { test } from "node:test";

import { type Block, inlines, parseMarkdown, safeHref } from "./markdown.ts";

const text = (text: string) => ({ type: "text", text }) as const;

test("reads headings, paragraphs, and rules", () => {
  assert.deepEqual(parseMarkdown("# Trip ##\n\nPack light.\nBring snacks.\n\n---\n\nHome\n===="), [
    { type: "heading", level: 1, children: [text("Trip")] },
    { type: "paragraph", children: [text("Pack light.\nBring snacks.")] },
    { type: "rule" },
    { type: "heading", level: 1, children: [text("Home")] },
  ]);
  assert.deepEqual(parseMarkdown("#hashtag"), [{ type: "paragraph", children: [text("#hashtag")] }]);
});

test("reads emphasis, code, and strikethrough", () => {
  assert.deepEqual(inlines("**bold** and *it* and _it_ and ~~gone~~ and `a*b`"), [
    { type: "strong", children: [text("bold")] },
    text(" and "),
    { type: "em", children: [text("it")] },
    text(" and "),
    { type: "em", children: [text("it")] },
    text(" and "),
    { type: "del", children: [text("gone")] },
    text(" and "),
    { type: "code", text: "a*b" },
  ]);
  assert.deepEqual(inlines("*one **two** three*"), [
    { type: "em", children: [text("one "), { type: "strong", children: [text("two")] }, text(" three")] },
  ]);
  // Not emphasis: words with underscores, a lone star, and escapes.
  assert.deepEqual(inlines("snake_case_name 2 * 3 \\*literal\\*"), [text("snake_case_name 2 * 3 *literal*")]);
});

test("links only to web pages and email addresses", () => {
  assert.deepEqual(inlines("[Map](https://example.com/a_(b) \"Title\") [bad](javascript:alert(1))"), [
    { type: "link", href: "https://example.com/a_(b)", children: [text("Map")] },
    text(" "),
    { type: "link", href: null, children: [text("bad")] },
  ]);
  assert.deepEqual(inlines("See www.example.com, or <mailto:sam@example.com>."), [
    text("See "),
    { type: "link", href: "https://www.example.com", children: [text("www.example.com")] },
    text(", or "),
    { type: "link", href: "mailto:sam@example.com", children: [text("mailto:sam@example.com")] },
    text("."),
  ]);
  assert.deepEqual(inlines("![A cat](https://example.com/cat.jpg)"), [
    { type: "image", href: "https://example.com/cat.jpg", alt: "A cat" },
  ]);
  assert.equal(safeHref(" JavaScript:alert(1)"), null);
  assert.equal(safeHref("data:text/html,hi"), null);
});

test("keeps HTML as text", () => {
  assert.deepEqual(parseMarkdown("<script>alert(1)</script>"), [
    { type: "paragraph", children: [text("<script>alert(1)</script>")] },
  ]);
});

test("breaks a line that ends in two spaces", () => {
  assert.deepEqual(inlines("one  \ntwo\\\nthree"), [text("one"), { type: "break" }, text("two"), { type: "break" }, text("three")]);
});

test("reads lists, nested lists, and tasks", () => {
  const list = parseMarkdown("- [x] Milk\n- [ ] Eggs\n  1. Brown\n  2. White\n- Bread\ncontinued");
  assert.deepEqual(list, [
    {
      type: "list",
      ordered: false,
      start: 1,
      tight: true,
      items: [
        { checked: true, children: [{ type: "paragraph", children: [text("Milk")] }] },
        {
          checked: false,
          children: [
            { type: "paragraph", children: [text("Eggs")] },
            {
              type: "list",
              ordered: true,
              start: 1,
              tight: true,
              items: [
                { checked: null, children: [{ type: "paragraph", children: [text("Brown")] }] },
                { checked: null, children: [{ type: "paragraph", children: [text("White")] }] },
              ],
            },
          ],
        },
        { checked: null, children: [{ type: "paragraph", children: [text("Bread\ncontinued")] }] },
      ],
    },
  ] satisfies Block[]);
  const [loose] = parseMarkdown("3. One\n\n4. Two");
  assert.equal(loose?.type === "list" && loose.tight, false);
  assert.equal(loose?.type === "list" && loose.start, 3);
  // A number that starts a sentence doesn't start a list in a paragraph.
  assert.equal(parseMarkdown("We moved in\n2014. It was cold.").length, 1);
});

test("reads code blocks and quotes", () => {
  assert.deepEqual(parseMarkdown("```js\nlet a = 1;\n\n*not emphasis*\n```\n> Quoted\nlazy\n\n    indented"), [
    { type: "code", language: "js", text: "let a = 1;\n\n*not emphasis*" },
    { type: "quote", children: [{ type: "paragraph", children: [text("Quoted\nlazy")] }] },
    { type: "code", language: "", text: "indented" },
  ]);
});

test("reads tables", () => {
  assert.deepEqual(parseMarkdown("| Item | Cost |\n|:-----|-----:|\n| Tent | `$90` |\n| Pipe \\| bar |"), [
    {
      type: "table",
      align: ["left", "right"],
      head: [[text("Item")], [text("Cost")]],
      rows: [
        [[text("Tent")], [{ type: "code", text: "$90" }]],
        [[text("Pipe | bar")], []],
      ],
    },
  ]);
});
