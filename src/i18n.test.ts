import assert from "node:assert/strict";
import { test } from "node:test";

import { formatSize, t } from "./i18n.ts";

test("fills in values", () => {
  assert.equal(t("drive.up", { name: "Photos" }), "Back to Photos");
});

test("formats numbers in messages", () => {
  assert.equal(t("drive.count", { count: 1200 }), "1,200 items");
});

test("picks the plural form", () => {
  assert.equal(t("drive.count", { count: 1 }), "1 item");
  assert.equal(t("drive.count", { count: 0 }), "0 items");
});

test("leaves a placeholder without a value as it is", () => {
  assert.equal(t("drive.up"), "Back to {name}");
});

test("shows sizes in the unit that fits", () => {
  assert.equal(formatSize(1), "1 byte");
  assert.equal(formatSize(999), "999 bytes");
  assert.equal(formatSize(1500), "1.5 kB");
  assert.equal(formatSize(25_300_000), "25 MB");
  assert.equal(formatSize(4_200_000_000), "4.2 GB");
});
