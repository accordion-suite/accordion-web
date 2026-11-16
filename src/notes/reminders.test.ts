import assert from "node:assert/strict";
import { test } from "node:test";

import "./messages.ts";

import { byDue, localText, quickTimes, type Reminder, reminderText, waiting } from "./reminders.ts";

const reminder = (change: Partial<Reminder> = {}): Reminder => ({
  local: "2026-11-20T09:00",
  zone: "UTC",
  repeat: null,
  due_at: "2026-11-20T09:00:00Z",
  rang: false,
  ...change,
});

test("a clock time reads as the server takes it", () => {
  assert.equal(localText(new Date(2026, 0, 5, 7, 3)), "2026-01-05T07:03");
});

test("quick choices are this evening, tomorrow morning, and next Monday", () => {
  // Thursday, November 19, 2026, at 2:30 PM.
  const thursday = new Date(2026, 10, 19, 14, 30);
  assert.deepEqual(
    quickTimes(thursday).map(({ quick, at }) => [quick, localText(at)]),
    [
      ["laterToday", "2026-11-19T18:00"],
      ["tomorrow", "2026-11-20T08:00"],
      ["nextWeek", "2026-11-23T08:00"],
    ],
  );
  // Too late for this evening, and on a Monday, next week is a week away.
  const monday = new Date(2026, 10, 23, 17, 30);
  assert.deepEqual(
    quickTimes(monday).map(({ quick, at }) => [quick, localText(at)]),
    [
      ["tomorrow", "2026-11-24T08:00"],
      ["nextWeek", "2026-11-30T08:00"],
    ],
  );
  // Snoozing starts with an hour from now.
  const snooze = quickTimes(new Date(2026, 10, 19, 14, 30, 45), true)[0]!;
  assert.equal(snooze.quick, "inAnHour");
  assert.equal(localText(snooze.at), "2026-11-19T15:30");
});

test("a reminder reads as today, tomorrow, or its day, with how often", () => {
  const now = new Date(2026, 10, 19, 10, 0);
  const at = (hours: number) => new Date(2026, 10, 19 + Math.floor(hours / 24), hours % 24).toISOString();
  assert.match(reminderText(reminder({ due_at: at(18) }), now), /^Today, /);
  assert.match(reminderText(reminder({ due_at: at(24 + 8) }), now), /^Tomorrow, /);
  assert.match(reminderText(reminder({ due_at: at(4 * 24 + 8), repeat: "weekly" }), now), /, .* · Weekly$/);
});

test("only a reminder that doesn't repeat waits once it's passed", () => {
  const now = new Date("2026-11-20T10:00:00Z");
  assert.equal(waiting(reminder(), now), true);
  assert.equal(waiting(reminder({ due_at: "2026-11-21T09:00:00Z" }), now), false);
  assert.equal(waiting(reminder({ due_at: "2026-11-21T09:00:00Z", rang: true }), now), true);
  assert.equal(waiting(reminder({ repeat: "daily", rang: true, due_at: "2026-11-21T09:00:00Z" }), now), false);
});

test("notes sort by when their reminders ring", () => {
  const later = { reminder: reminder({ due_at: "2026-12-01T09:00:00Z" }) };
  const sooner = { reminder: reminder({ due_at: "2026-11-21T09:00:00Z" }) };
  assert.deepEqual([later, sooner].sort(byDue), [sooner, later]);
});
