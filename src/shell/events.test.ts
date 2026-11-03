import assert from "node:assert/strict";
import { test } from "node:test";

import { groupEvents, sentence } from "../drive/activity.tsx";
import "../settings/messages.ts";
import { logText } from "../settings/log-text.ts";
import type { LoggedEvent } from "./events.ts";
import { notificationLink, notificationText, when } from "./events.ts";

const ME = "me";
const SAM = { id: "sam", name: "Sam Rivera" };

function event(id: number, action: string, more: Partial<LoggedEvent> = {}): LoggedEvent {
  return {
    id,
    at: "2026-11-02T10:00:00.000Z",
    action,
    actor: SAM,
    via: "web",
    item: { id: `item-${id}`, name: `file ${id}.txt` },
    other: null,
    details: {},
    ...more,
  };
}

test("events in a row by the same person, doing the same thing, read as one", () => {
  const groups = groupEvents([
    event(5, "added", { details: { how: "uploaded" } }),
    event(4, "added", { details: { how: "uploaded" } }),
    event(3, "added", { details: { how: "created" }, item: { id: "f", name: "Album", folder: true } }),
    event(2, "added", { details: { how: "uploaded" }, actor: { id: ME, name: "Alex" } }),
    event(1, "shared", { other: { id: "kim", name: "Kim" } }),
  ]);
  assert.deepEqual(
    groups.map((group) => sentence(group, ME)),
    ["Sam Rivera uploaded 2 items", "Sam Rivera created a folder", "You uploaded an item", "Sam Rivera shared an item"],
  );
});

test("each share stays its own line", () => {
  const groups = groupEvents([
    event(2, "shared", { other: { id: "kim", name: "Kim" } }),
    event(1, "shared", { other: { id: "lee", name: "Lee" } }),
  ]);
  assert.equal(groups.length, 2);
});

test("a deleted account and Accordion itself have names", () => {
  const [deleted] = groupEvents([event(1, "edited", { actor: { id: "gone", name: null } })]);
  assert.equal(sentence(deleted!, ME), "Deleted account edited an item");
  const [server] = groupEvents([event(1, "deleted", { actor: null })]);
  assert.equal(sentence(server!, ME), "Accordion deleted an item for good");
});

test("notifications say what happened and lead to it", () => {
  const added = {
    id: 9,
    ids: [9, 8, 7],
    at: "2026-11-02T10:00:00.000Z",
    action: "added",
    actor: SAM,
    seen: false,
    read: false,
    item: { id: "one", name: "one.jpg" },
    count: 3,
    folder: { id: "holiday", name: "Holiday", folder: true },
    details: {},
  };
  assert.equal(notificationText(added, ME), "Sam Rivera added 3 items to Holiday");
  assert.equal(notificationLink(added), "/drive/folder/holiday");
  assert.equal(notificationText({ ...added, count: 1 }, ME), "Sam Rivera added one.jpg to Holiday");
  assert.equal(notificationLink({ ...added, count: 1 }), "/drive/folder/holiday?file=one");

  const shared = { ...added, action: "shared", count: 1, folder: null, item: { id: "h", name: "Holiday", folder: true } };
  assert.equal(notificationText(shared, ME), "Sam Rivera shared Holiday with you");
  assert.equal(notificationLink(shared), "/drive/folder/h");
  assert.equal(notificationLink({ ...shared, item: { id: "p", name: "plan.pdf" } }), "/drive/shared?file=p");
});

test("logs say what happened from the reader's side", () => {
  const out = event(1, "shared", { actor: { id: ME, name: "Alex" }, other: SAM, item: { id: "h", name: "Holiday" } });
  assert.equal(logText(out, ME), "Shared Holiday with Sam Rivera");
  const into = event(2, "shared", { other: { id: ME, name: "Alex" }, item: null });
  assert.equal(logText(into, ME), "Sam Rivera shared an item with you");
  const failed = event(3, "sign_in_failed", { actor: null, other: { id: ME, name: "Alex" } });
  assert.equal(logText(failed, ME), "Wrong password entered");
  assert.equal(logText({ ...failed, other: SAM }, ME), "Wrong password entered for Sam Rivera");
  // Events with nothing more to say come with no details.
  assert.equal(logText(event(5, "signed_out", { actor: { id: ME, name: "Alex" }, details: null }), ME), "Signed out");
  assert.equal(groupEvents([event(6, "moved", { details: null })]).length, 1);
  const role = event(4, "account_changed", { other: SAM, details: { change: "role", role: "admin" } });
  assert.equal(logText(role, ME), "Made Sam Rivera an admin");
});

test("recent times read as how long ago", () => {
  const now = Date.parse("2026-11-02T10:00:00.000Z");
  assert.equal(when("2026-11-02T09:59:30.000Z", now), "Just now");
  assert.equal(when("2026-11-02T09:55:00.000Z", now), "5 minutes ago");
  assert.equal(when("2026-11-02T09:00:00.000Z", now), "1 hour ago");
});
