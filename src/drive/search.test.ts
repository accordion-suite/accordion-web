import assert from "node:assert/strict";
import { test } from "node:test";

import { anyFilter, modifiedRange, NO_FILTERS, readSearch, searchAddress, searchPath } from "./search.ts";

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

test("between two dates includes the whole of the last day", () => {
  assert.deepEqual(modifiedRange("custom", NOW, "2026-03-01", "2026-03-31"), {
    after: new Date(2026, 2, 1).toISOString(),
    before: new Date(2026, 3, 1).toISOString(),
  });
  assert.deepEqual(modifiedRange("custom", NOW, "", "2026-12-31"), {
    before: new Date(2027, 0, 1).toISOString(),
  });
  assert.deepEqual(modifiedRange("custom", NOW, "someday", ""), {});
});

test("builds the API's address from words and filters", () => {
  assert.equal(searchAddress(NO_FILTERS, NOW), "/api/drive/search?");
  const address = new URL(
    searchAddress(
      { ...NO_FILTERS, q: "tax return", type: "pdfs", modified: "year", owner: "me", starred: true, in: "shared" },
      NOW,
    ),
    "http://x",
  );
  assert.equal(address.pathname, "/api/drive/search");
  assert.equal(address.searchParams.get("q"), "tax return");
  assert.equal(address.searchParams.get("type"), "pdfs");
  assert.equal(address.searchParams.get("owner"), "me");
  assert.equal(address.searchParams.get("in"), "shared");
  assert.equal(address.searchParams.get("starred"), "true");
  assert.equal(address.searchParams.get("trash"), null);
  assert.equal(address.searchParams.get("after"), new Date(2026, 0, 1).toISOString());
  assert.equal(address.searchParams.get("before"), null);
  assert.equal(address.searchParams.get("modified"), null);
});

test("keeps a search in the page's address and reads it back", () => {
  const filters = {
    ...NO_FILTERS,
    q: "lake",
    name: "plan",
    trash: true,
    modified: "custom",
    from: "2026-01-01",
    to: "2026-01-31",
    shared_with: "sam",
  };
  const path = searchPath(filters);
  assert.equal(
    path,
    "/drive/search?q=lake&name=plan&modified=custom&from=2026-01-01&to=2026-01-31&shared_with=sam&trash=true",
  );
  assert.deepEqual(readSearch(new URL(path, "http://x").searchParams), filters);
  assert.equal(searchPath(NO_FILTERS), "/drive/search");
  // Dates are kept only between two dates.
  assert.equal(searchPath({ ...NO_FILTERS, modified: "week", from: "2026-01-01" }), "/drive/search?modified=week");
});

test("knows when filters beyond the words are set", () => {
  assert.equal(anyFilter({ ...NO_FILTERS, q: "lake" }), false);
  assert.equal(anyFilter({ ...NO_FILTERS, starred: true }), true);
  assert.equal(anyFilter({ ...NO_FILTERS, owner: "me" }), true);
});
