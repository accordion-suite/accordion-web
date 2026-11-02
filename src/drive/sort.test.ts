import assert from "node:assert/strict";
import { test } from "node:test";

import type { Found } from "./item.ts";
import { nextSort, readSort, sortItems } from "./sort.ts";

function item(
  name: string,
  kind: "file" | "folder",
  modified: string,
  size: number | null,
  folders: string[] = [],
  owner: string | null = null,
): Found {
  return {
    id: name,
    parent: null,
    name,
    kind,
    size,
    sha256: null,
    preview: null,
    preview_partial: false,
    thumbnail: null,
    created_at: modified,
    modified_at: modified,
    starred: false,
    access: owner === null ? "owner" : "viewer",
    owner,
    shared: false,
    color: null,
    folders,
  };
}

const ITEMS = [
  item("Photo 10.jpg", "file", "2026-10-03T09:00:00Z", 300, ["Photos"]),
  item("School", "folder", "2026-10-01T09:00:00Z", null),
  item("photo 2.jpg", "file", "2026-10-05T09:00:00Z", 100, ["Photos", "Beach"]),
  item("Archive", "folder", "2026-10-04T09:00:00Z", null),
  item("Budget.csv", "file", "2026-10-02T09:00:00Z", 200, ["Documents"]),
];

const names = (sorted: readonly Found[]) => sorted.map((found) => found.name);

test("without a sort, the list keeps its own order", () => {
  assert.equal(sortItems(ITEMS, null), ITEMS);
});

test("names sort as people read them, with folders first", () => {
  assert.deepEqual(names(sortItems(ITEMS, { key: "name", descending: false })), [
    "Archive",
    "School",
    "Budget.csv",
    "photo 2.jpg",
    "Photo 10.jpg",
  ]);
  assert.deepEqual(names(sortItems(ITEMS, { key: "name", descending: true })), [
    "School",
    "Archive",
    "Photo 10.jpg",
    "photo 2.jpg",
    "Budget.csv",
  ]);
});

test("modified, size, and location sort their own way", () => {
  assert.deepEqual(names(sortItems(ITEMS, { key: "modified", descending: true })), [
    "Archive",
    "School",
    "photo 2.jpg",
    "Photo 10.jpg",
    "Budget.csv",
  ]);
  assert.deepEqual(names(sortItems(ITEMS, { key: "size", descending: true })), [
    "Archive",
    "School",
    "Photo 10.jpg",
    "Budget.csv",
    "photo 2.jpg",
  ]);
  // My Drive itself, with no folders, comes first.
  assert.deepEqual(names(sortItems(ITEMS, { key: "location", descending: false })), [
    "Archive",
    "School",
    "Budget.csv",
    "Photo 10.jpg",
    "photo 2.jpg",
  ]);
});

test("a header sorts its first way, then the other way", () => {
  assert.deepEqual(nextSort(null, "name"), { key: "name", descending: false });
  assert.deepEqual(nextSort(null, "modified"), { key: "modified", descending: true });
  assert.deepEqual(nextSort({ key: "modified", descending: true }, "modified"), { key: "modified", descending: false });
  assert.deepEqual(nextSort({ key: "modified", descending: false }, "size"), { key: "size", descending: true });
});

test("a kept sort is read back, and anything else isn't", () => {
  assert.deepEqual(readSort('{"key":"size","descending":true}'), { key: "size", descending: true });
  assert.equal(readSort(null), null);
  assert.equal(readSort("not json"), null);
  assert.equal(readSort('{"key":"color","descending":true}'), null);
  assert.equal(readSort('{"key":"name"}'), null);
});

test("someone else's items sort by their owner first", () => {
  const shared = [
    item("Recipes", "folder", "2026-10-01T09:00:00Z", null, [], "Sam"),
    item("Mine.txt", "file", "2026-10-01T09:00:00Z", 1),
    item("Beach.jpg", "file", "2026-10-01T09:00:00Z", 1, ["Holiday"], "Alex"),
    item("Notes.txt", "file", "2026-10-01T09:00:00Z", 1, [], "Alex"),
  ];
  assert.deepEqual(names(sortItems(shared, { key: "location", descending: false })), [
    "Recipes",
    "Mine.txt",
    "Notes.txt",
    "Beach.jpg",
  ]);
});
