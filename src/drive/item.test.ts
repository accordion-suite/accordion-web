import assert from "node:assert/strict";
import { test } from "node:test";

import { canEdit, thumbnailAddress } from "./item.ts";

test("a thumbnail's address changes when the server makes it again", () => {
  const before = thumbnailAddress({ id: "f1", sha256: "abc", thumbnail_version: "19a1" });
  const after = thumbnailAddress({ id: "f1", sha256: "abc", thumbnail_version: "19a2" });
  assert.equal(before, "/api/drive/items/f1/thumbnail?v=abc-19a1");
  assert.notEqual(before, after);
  // From a server that doesn't say, the contents alone name it.
  assert.equal(thumbnailAddress({ id: "f1", sha256: "abc" }), "/api/drive/items/f1/thumbnail?v=abc");
});

test("nothing in the trash can change until it's restored", () => {
  assert.equal(canEdit({ access: "owner" }), true);
  assert.equal(canEdit({ access: "owner", trashed_at: null }), true);
  assert.equal(canEdit({ access: "owner", trashed_at: "2026-11-02T08:00:00Z" }), false);
  assert.equal(canEdit({ access: "viewer" }), false);
});
