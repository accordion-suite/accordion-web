import assert from "node:assert/strict";
import { test } from "node:test";

import { DEFAULT_SETTINGS, startPath } from "./preferences.ts";

test("opens Home unless the reader chose My Drive", () => {
  assert.equal(startPath(DEFAULT_SETTINGS), "/drive/");
  assert.equal(startPath({ ...DEFAULT_SETTINGS, start_page: "my-drive" }), "/drive/my-drive");
});
