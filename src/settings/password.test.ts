import assert from "node:assert/strict";
import { test } from "node:test";

import { ApiError } from "../api.ts";
import { needsPassword } from "./password.ts";

test("asks for the password again only when the server wants it", () => {
  assert.ok(needsPassword(new ApiError(403, "For your security, enter your password again before you see the recovery key.")));
  assert.ok(!needsPassword(new ApiError(403, "Only admins can manage backups.")));
  assert.ok(!needsPassword(new ApiError(400, "For your security, something else.")));
  assert.ok(!needsPassword(new Error("For your security")));
});
