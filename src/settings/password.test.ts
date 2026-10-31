import assert from "node:assert/strict";
import { test } from "node:test";

import { ApiError } from "../api.ts";
import { needsPassword } from "./password.ts";

test("asks for the password again only when the server wants it", () => {
  assert.ok(needsPassword(new ApiError(403, "For your security, enter your password again.", "password_needed")));
  // The message alone isn't enough: it can change, and it'll be translated.
  assert.ok(!needsPassword(new ApiError(403, "For your security, enter your password again.")));
  assert.ok(!needsPassword(new ApiError(403, "Only admins can manage backups.")));
  assert.ok(!needsPassword(new Error("For your security")));
});
