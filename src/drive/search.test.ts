import assert from "node:assert/strict";
import { test } from "node:test";

import { modifiedRange, searchAddress } from "./search.ts";

// A Thursday afternoon, in the time zone the tests run in.
const NOW = new Date(2026, 9, 29, 15, 30);

test("today starts at local midnight", () => {
  assert.deepEqual(modifiedRange("today", NOW), { after: new Date(2026, 9, 29).toISOString() });
});

test("last year runs from one New Year to the next", () => {
  assert.deepEqual(modifiedRange("last-year", NOW), {
    after: new Date(2025, 0, 1).toISOString(),
    before: new Date(2026, 0, 1).toISOString(),
  });
});

test("week and month count back from now", () => {
  const day = 24 * 60 * 60 * 1000;
  assert.equal(modifiedRange("week", NOW).after, new Date(NOW.getTime() - 7 * day).toISOString());
  assert.equal(modifiedRange("month", NOW).after, new Date(NOW.getTime() - 30 * day).toISOString());
});

test("an unknown choice filters nothing", () => {
  assert.deepEqual(modifiedRange("", NOW), {});
  assert.deepEqual(modifiedRange("someday", NOW), {});
});

test("builds the API's address from words and filters", () => {
  assert.equal(searchAddress("", "", "", NOW), "/api/drive/search?");
  const address = new URL(searchAddress("tax return", "pdfs", "year", NOW), "http://x");
  assert.equal(address.pathname, "/api/drive/search");
  assert.equal(address.searchParams.get("q"), "tax return");
  assert.equal(address.searchParams.get("type"), "pdfs");
  assert.equal(address.searchParams.get("after"), new Date(2026, 0, 1).toISOString());
  assert.equal(address.searchParams.get("before"), null);
});
