import assert from "node:assert/strict";
import { test } from "node:test";

import { imageTarget, imageUrl, isImageName, isSoundName, joinImages, restOffset, splitImages } from "./note-images.ts";

test("reads the picture a line shows", () => {
  assert.equal(imageTarget("![](Garden/Groceries%201.jpg)"), "Garden/Groceries 1.jpg");
  assert.equal(imageTarget("  ![A photo](<With space.png> \"Title\")  "), "With space.png");
  assert.equal(imageTarget("![[photo.webp|200]]"), "photo.webp");
  assert.equal(imageTarget("Text and ![](a.jpg)"), null);
  assert.equal(imageTarget("[a link](a.jpg)"), null);
});

test("knows the pictures Notes takes", () => {
  assert.equal(isImageName("a.JPG"), true);
  assert.equal(isImageName("a.heic"), true);
  assert.equal(isImageName("a.svg"), false);
  assert.equal(isImageName("jpg"), false);
});

test("splits the pictures at the top from the text", () => {
  const body = "![](a.jpg)\n![[b.png]]\n\n- [ ] Milk\n";
  assert.deepEqual(splitImages(body), { lines: ["![](a.jpg)", "![[b.png]]"], rest: "- [ ] Milk\n" });
  assert.equal(joinImages(["![](a.jpg)", "![[b.png]]"], "- [ ] Milk\n"), body);
  assert.equal(restOffset(body), body.indexOf("- [ ]"));
  // A link to something else, or a picture further down, stays in the text.
  assert.deepEqual(splitImages("![](plan.pdf)\nText"), { lines: [], rest: "![](plan.pdf)\nText" });
  assert.deepEqual(splitImages("Text\n![](a.jpg)"), { lines: [], rest: "Text\n![](a.jpg)" });
});

test("a note of only pictures keeps one line ending", () => {
  assert.deepEqual(splitImages("![](a.jpg)\n"), { lines: ["![](a.jpg)"], rest: "" });
  assert.equal(joinImages(["![](a.jpg)"], ""), "![](a.jpg)\n");
  assert.equal(joinImages([], "Text"), "Text");
});

test("asks Notes for a picture by its link", () => {
  assert.equal(imageUrl("n1", "Garden/a b.jpg", "small"), "/api/notes/notes/n1/image?path=Garden%2Fa%20b.jpg&size=small");
});

test("knows the sounds Notes plays", () => {
  assert.equal(isSoundName("Trip 1.webm"), true);
  assert.equal(isSoundName("memo.M4A"), true);
  assert.equal(isSoundName("a.jpg"), false);
  assert.equal(isSoundName("webm"), false);
});

test("memos at the top go with the pictures", () => {
  const body = "![](a.jpg)\n![](Trip%201.webm)\n\nBags\n";
  assert.deepEqual(splitImages(body), { lines: ["![](a.jpg)", "![](Trip%201.webm)"], rest: "Bags\n" });
});
