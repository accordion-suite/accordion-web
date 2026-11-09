import assert from "node:assert/strict";
import { test } from "node:test";

import { kindOf } from "./icons.tsx";
import { setTypeList, typeOfName } from "./types.ts";

setTypeList({ extensions: { ts: "code", mp4: "videos", zip: "archives" }, names: { makefile: "code", ".bashrc": "code" } });

test("knows a type by extension or by whole name", () => {
  assert.equal(typeOfName("Holiday.MP4"), "videos");
  assert.equal(typeOfName("Makefile"), "code");
  assert.equal(typeOfName(".bashrc"), "code");
  assert.equal(typeOfName(".zip"), null);
  assert.equal(typeOfName("notes"), null);
});

test("an item's own type wins over its name", () => {
  // A ".ts" file the server found is a video, by its picture thumbnail.
  assert.equal(kindOf({ kind: "file", name: "Match.ts", type: "videos" }), "video");
  assert.equal(kindOf({ kind: "file", name: "main.ts" }), "code");
  assert.equal(kindOf({ kind: "file", name: "odd.mp4", type: null }), "file");
  assert.equal(kindOf({ kind: "folder", name: "Code.zip" }), "folder");
});
