import assert from "node:assert/strict";
import { test } from "node:test";

import { highlight, languageOfFence, languageOfName, type Token } from "./highlight.ts";

const colored = (tokens: Token[]) => tokens.filter((token) => token.kind).map((token) => `${token.kind}:${token.text}`);

test("knows languages by file name and fence name", () => {
  assert.equal(languageOfName("main.rs"), "rust");
  assert.equal(languageOfName("App.TSX"), "ts");
  assert.equal(languageOfName("notes.txt"), null);
  assert.equal(languageOfName("Makefile"), null);
  assert.equal(languageOfFence("typescript"), "ts");
  assert.equal(languageOfFence("py"), "python");
  assert.equal(languageOfFence("rust"), "rust");
  assert.equal(languageOfFence("klingon"), null);
});

test("keeps every character, in order", () => {
  const source = 'fn main() {\n    // say hi\n    println!("hi \\"there\\"", 42);\n}\n/* unclosed';
  for (const language of ["rust", "python", "json", "markup", "sql", "yaml", "none"]) {
    assert.equal(
      highlight(source, language)
        .map((token) => token.text)
        .join(""),
      source,
      language,
    );
  }
});

test("colors keywords, strings, comments, and numbers", () => {
  assert.deepEqual(colored(highlight('let x = "a // b"; // note\nreturn 0x1F;', "rust")), [
    "keyword:let",
    'string:"a // b"',
    "comment:// note",
    "keyword:return",
    "number:0x1F",
  ]);
  // A number inside a name isn't a number.
  assert.deepEqual(colored(highlight("item2 = 3", "python")), ["number:3"]);
  assert.deepEqual(colored(highlight('s = """two\nlines""" # done', "python")), ['string:"""two\nlines"""', "comment:# done"]);
});

test("ends an unclosed quote at the line's end", () => {
  assert.deepEqual(colored(highlight("it's\nfine = True", "python")), ["string:'s", "keyword:True"]);
});

test("matches SQL keywords in any case", () => {
  assert.deepEqual(colored(highlight("Select name FROM people", "sql")), ["keyword:Select", "keyword:FROM"]);
});

test("colors keys in JSON, YAML, and INI", () => {
  assert.deepEqual(colored(highlight('{"name": "Sam", "on": true}', "json")), [
    'key:"name"',
    'string:"Sam"',
    'key:"on"',
    "keyword:true",
  ]);
  assert.deepEqual(colored(highlight("# trip\npack:\n  - snacks\nsize: 3", "yaml")), [
    "comment:# trip",
    "key:pack",
    "key:size",
    "number:3",
  ]);
  assert.deepEqual(colored(highlight("[server]\nport = 8080", "ini")), ["key:port", "number:8080"]);
});

test("colors tags, attributes, and comments in markup", () => {
  assert.deepEqual(colored(highlight('<!-- top --><a href="/x">Go</a>', "markup")), [
    "comment:<!-- top -->",
    "tag:<a",
    "key:href",
    'string:"/x"',
    "tag:>",
    // Pieces of the same kind next to each other join.
    "tag:</a>",
  ]);
});
