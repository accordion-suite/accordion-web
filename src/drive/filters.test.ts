import assert from "node:assert/strict";
import { test } from "node:test";

import { type Filters, matches, ownedBy, owners, sharedWith, sharees } from "./filters.ts";
import type { Item } from "./item.ts";
import { setTypeList } from "./types.ts";

const NOW = new Date("2026-11-02T12:00:00");
setTypeList({ extensions: { docx: "documents", jpg: "photos", xlsx: "spreadsheets" }, names: {} });

const NONE: Filters = { type: "", people: "", modified: "", source: "" };

function item(name: string, modified: string, more: Partial<Item> = {}): Item {
  return {
    id: name,
    parent: "top",
    name,
    kind: "file",
    size: 10,
    sha256: "hash",
    preview: null,
    preview_partial: false,
    thumbnail: null,
    created_at: modified,
    modified_at: modified,
    starred: false,
    access: "owner",
    owner: null,
    shared: false,
    color: null,
    ...more,
  };
}

const LETTER = item("Letter.docx", "2026-11-02T09:00:00");
const PHOTO = item("Beach.jpg", "2026-10-20T09:00:00", { shared: true });
const BUDGET = item("Budget.xlsx", "2025-06-01T09:00:00", { owner: "Sam Rivera", access: "editor" });
const TRIP = item("Trip", "2026-11-01T09:00:00", { kind: "folder", size: null, sha256: null });
const ALL = [LETTER, PHOTO, BUDGET, TRIP];

function kept(filters: Partial<Filters>): string[] {
  return ALL.filter((one) => matches(one, { ...NONE, ...filters }, NOW)).map((one) => one.name);
}

test("no filters keep everything", () => {
  assert.deepEqual(kept({}), ["Letter.docx", "Beach.jpg", "Budget.xlsx", "Trip"]);
});

test("type keeps one kind of item", () => {
  assert.deepEqual(kept({ type: "documents" }), ["Letter.docx"]);
  assert.deepEqual(kept({ type: "photos" }), ["Beach.jpg"]);
  assert.deepEqual(kept({ type: "folders" }), ["Trip"]);
});

test("people keeps the reader's, what they shared, or someone else's", () => {
  assert.deepEqual(kept({ people: "me" }), ["Letter.docx", "Beach.jpg", "Trip"]);
  assert.deepEqual(kept({ people: "shared" }), ["Beach.jpg"]);
  assert.deepEqual(kept({ people: ownedBy("Sam Rivera") }), ["Budget.xlsx"]);
  assert.deepEqual(owners(ALL), ["Sam Rivera"]);
});

test("modified keeps what changed in the time chosen", () => {
  assert.deepEqual(kept({ modified: "today" }), ["Letter.docx"]);
  assert.deepEqual(kept({ modified: "week" }), ["Letter.docx", "Trip"]);
  assert.deepEqual(kept({ modified: "last-year" }), ["Budget.xlsx"]);
});

test("source keeps My Drive's or what's shared with the reader", () => {
  assert.deepEqual(kept({ source: "shared" }), ["Budget.xlsx"]);
  assert.deepEqual(kept({ source: "my-drive", type: "folders" }), ["Trip"]);
});

test("Shared by me filters by who an item is shared with", () => {
  const out = (name: string, people: [string, string][]) => ({
    ...ALL[0]!,
    id: name,
    name,
    shared_with: people.map(([username, display_name]) => ({ user: username, username, display_name, level: "viewer" as const })),
    shared_at: "2026-10-01T09:00:00Z",
  });
  const items = [out("a.txt", [["sam", "Sam Rivera"]]), out("b.txt", [["kim", "Kim Lee"], ["sam", "Sam Rivera"]])];
  const filters = { type: "", people: sharedWith("kim"), modified: "", source: "" };
  assert.deepEqual(items.filter((one) => matches(one, filters)).map((one) => one.name), ["b.txt"]);
  assert.deepEqual(sharees(items), [["kim", "Kim Lee"], ["sam", "Sam Rivera"]]);
});

test("in the trash, the date is when an item was deleted", () => {
  const old = item("Old.docx", "2024-01-01T09:00:00", { trashed_at: "2026-11-02T08:00:00" });
  const filters = { ...NONE, modified: "today" };
  assert.equal(matches(old, filters, NOW), false);
  assert.equal(matches(old, filters, NOW, "deleted"), true);
});
