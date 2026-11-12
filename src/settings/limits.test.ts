import assert from "node:assert/strict";
import { test } from "node:test";

import { limitBytes, limitParts } from "./limits.ts";

test("a limit shows in the largest unit, to one decimal place", () => {
  assert.deepEqual(limitParts(null), { amount: "10", unit: 1 });
  assert.deepEqual(limitParts(10e9), { amount: "10", unit: 1 });
  assert.deepEqual(limitParts(1.5e12), { amount: "1.5", unit: 2 });
  assert.deepEqual(limitParts(500e9), { amount: "500", unit: 1 });
  assert.deepEqual(limitParts(250e6), { amount: "250", unit: 0 });
  // A limit set some other way rounds to a tenth of a megabyte.
  assert.deepEqual(limitParts(1_234_567_890), { amount: "1234.6", unit: 0 });
  assert.deepEqual(limitParts(1000), { amount: "0.1", unit: 0 });
});

test("a typed limit keeps one decimal place", () => {
  assert.equal(limitBytes("1.5", 2), 1.5e12);
  assert.equal(limitBytes("2.25", 1), 2.3e9);
  assert.equal(limitBytes("10", 1), 10e9);
  assert.equal(limitBytes("0.1", 0), 100_000);
  for (const bad of ["", "0", "0.04", "-1", "abc"]) assert.equal(limitBytes(bad, 1), null, bad);
});
