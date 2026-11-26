import assert from "node:assert/strict";
import { test } from "node:test";

import { insertMention, keptMentions, matchingPeople, mentionParts, mentionQuery } from "./mentions.ts";

const SAM = { id: "sam", name: "Sam Kim", username: "sam" };
const DANA = { id: "dana", name: "Dana Lee", username: "dlee" };
const SAMIRA = { id: "samira", name: "Samira Ross", username: "samira" };

test("finds the mention being typed before the caret", () => {
  assert.deepEqual(mentionQuery("@", 1), { start: 0, query: "" });
  assert.deepEqual(mentionQuery("Hi @Sa", 6), { start: 3, query: "Sa" });
  assert.deepEqual(mentionQuery("Hi @Sam K", 9), { start: 3, query: "Sam K" });
  assert.deepEqual(mentionQuery("(@da", 4), { start: 1, query: "da" });
  // Not in an email address, across lines, or after a space right away.
  assert.equal(mentionQuery("sam@example", 11), null);
  assert.equal(mentionQuery("@Sam\nKim", 8), null);
  assert.equal(mentionQuery("@ Sam", 5), null);
  assert.equal(mentionQuery("No mention", 10), null);
  // Only what's before the caret counts.
  assert.deepEqual(mentionQuery("@Sa and more", 3), { start: 0, query: "Sa" });
});

test("lists people whose name or username starts with what's typed", () => {
  const people = [DANA, SAMIRA, SAM];
  assert.deepEqual(matchingPeople(people, ""), people);
  assert.deepEqual(matchingPeople(people, "sa"), [SAMIRA, SAM]);
  assert.deepEqual(matchingPeople(people, "lee"), [DANA]);
  assert.deepEqual(matchingPeople(people, "dl"), [DANA]);
  assert.deepEqual(matchingPeople(people, "Sam K"), [SAM]);
  assert.deepEqual(matchingPeople(people, "x"), []);
});

test("writes the chosen name in place of what was typed", () => {
  assert.deepEqual(insertMention("Hi @Sa", 3, 6, "Sam Kim"), { text: "Hi @Sam Kim ", caret: 12 });
  assert.deepEqual(insertMention("@Sa, look", 0, 3, "Sam Kim"), { text: "@Sam Kim, look", caret: 8 });
  assert.deepEqual(insertMention("@Sa look", 0, 3, "Sam Kim"), { text: "@Sam Kim look", caret: 9 });
});

test("keeps only the mentions still in the text", () => {
  const chosen = new Map([
    ["Sam Kim", "sam"],
    ["Dana Lee", "dana"],
  ]);
  assert.deepEqual(keptMentions("@Sam Kim can you look?", chosen), ["sam"]);
  assert.deepEqual(keptMentions("@Sam Kim and @Dana Lee", chosen), ["sam", "dana"]);
  assert.deepEqual(keptMentions("Sam Kim", chosen), []);
});

test("splits a comment's text around its mentions", () => {
  const sam = { user: "sam", name: "Sam" };
  const samKim = { user: "sk", name: "Sam Kim" };
  assert.deepEqual(mentionParts("@Sam Kim, look", [sam, samKim]), [samKim, ", look"]);
  assert.deepEqual(mentionParts("Ask @Sam or email sam@x", [sam]), ["Ask ", sam, " or email sam@x"]);
  assert.deepEqual(mentionParts("No one", []), ["No one"]);
});
