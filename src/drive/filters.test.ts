import assert from "node:assert/strict";
import { test } from "node:test";

import { type Filters, matches, ownedBy, owners } from "./filters.ts";
import type { Item } from "./item.ts";

const NOW = new Date("2026-11-02T12:00:00");
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
