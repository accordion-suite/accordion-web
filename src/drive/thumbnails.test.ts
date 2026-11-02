import assert from "node:assert/strict";
import { test } from "node:test";

import type { Item } from "./item.ts";
import { nextLook } from "./thumbnails.ts";

const NOW = Date.parse("2026-11-02T12:00:00Z");

function file(id: string, modified: string, thumbnail: Item["thumbnail"] = null): Item {
  return {
    id,
    parent: "top",
    name: `${id}.docx`,
    kind: "file",
    size: 10,
    sha256: `hash-${id}`,
    preview: null,
    preview_partial: false,
    thumbnail,
    created_at: modified,
    modified_at: modified,
    starred: false,
    access: "owner",
    owner: null,
    shared: false,
    color: null,
  };
}

test("waits for new files without thumbnails, sooner at first", () => {
  const seen = new Map<string, number>();
  const items = [file("new", "2026-11-02T11:59:50Z"), file("done", "2026-11-02T11:59:50Z", "picture")];
  assert.equal(nextLook(items, NOW, seen), 2_000);
  assert.equal(nextLook(items, NOW + 30_000, seen), 5_000);
  assert.equal(nextLook(items, NOW + 90_000, seen), 15_000);
});

test("gives up after a while, as for files that never get one", () => {
  const seen = new Map<string, number>();
  const items = [file("archive", "2026-11-02T11:59:50Z")];
  assert.equal(nextLook(items, NOW, seen), 2_000);
  assert.equal(nextLook(items, NOW + 3 * 60_000, seen), null);
});

test("doesn't wait for older files or folders", () => {
  const seen = new Map<string, number>();
  const folder: Item = { ...file("folder", "2026-11-02T11:59:50Z"), kind: "folder", sha256: null };
  assert.equal(nextLook([file("old", "2026-11-01T09:00:00Z"), folder], NOW, seen), null);
});
