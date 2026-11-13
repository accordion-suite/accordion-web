import assert from "node:assert/strict";
import { test } from "node:test";

import { formatCalendarDay, formatHour, formatLength, formatList, formatPercent, formatSize, t } from "./i18n.ts";

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

test("shows shares as percentages, and a tiny one as more than nothing", () => {
  assert.equal(formatPercent(0.7), "70%");
  assert.equal(formatPercent(0.015), "1.5%");
  assert.equal(formatPercent(0.00015), "<0.1%");
  assert.equal(formatPercent(0), "0%");
});

test("shows sizes in the unit that fits", () => {
  assert.equal(formatSize(1), "1 byte");
  assert.equal(formatSize(999), "999 bytes");
  assert.equal(formatSize(1500), "1.5 kB");
  assert.equal(formatSize(25_300_000), "25 MB");
  assert.equal(formatSize(4_200_000_000), "4.2 GB");
});

test("reads a release date as a local date", () => {
  assert.equal(formatCalendarDay("2026-11-02"), "November 2, 2026");
});

test("names hours of the day", () => {
  assert.equal(formatHour(0), "12 AM");
  assert.equal(formatHour(3), "3 AM");
  assert.equal(formatHour(15), "3 PM");
});

test("joins items with a serial comma", () => {
  assert.equal(formatList(["a"]), "a");
  assert.equal(formatList(["a", "b"]), "a and b");
  assert.equal(formatList(["a", "b", "c"]), "a, b, and c");
});

test("lengths read as a player's clock does", () => {
  assert.equal(formatLength(0.2), "0:01");
  assert.equal(formatLength(3), "0:03");
  assert.equal(formatLength(125.4), "2:05");
  assert.equal(formatLength(3725), "1:02:05");
  assert.equal(formatLength(36000), "10:00:00");
});
