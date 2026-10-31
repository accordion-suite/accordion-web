import assert from "node:assert/strict";
import { test } from "node:test";

import { type NetworkStatus, type Target, connections, targetLines, updateLine } from "./describe.ts";

const target: Target = {
  id: "t1",
  name: "Blue USB disk",
  location: "/media/usb/backups",
  kind: "folder",
  paused: false,
  last_backup: null,
  last_good_backup: null,
  last_check: null,
  last_restore_test: null,
  append_only: false,
  stored_bytes: null,
  oldest_backup: null,
};

test("says when a new location's first backup starts", () => {
  assert.deepEqual(targetLines(target, 2), [
    "No backups yet. The first one starts at 2 AM.",
    "No restore test yet. Accordion runs one each month.",
  ]);
});

test("says a paused location waits, without a start time", () => {
  const lines = targetLines({ ...target, paused: true }, 2);
  assert.match(lines[0]!, /^Paused\./);
  assert.equal(lines[1], "No backups yet.");
});

test("warns about a REST server that lets backups be deleted", () => {
  const lines = targetLines({ ...target, kind: "rest" }, 2);
  assert.ok(lines.some((line) => line.includes("append-only mode")));
});

test("adds the reason a rolled-back update didn't work", () => {
  const line = updateLine({
    outcome: "rolled-back",
    finished_at: Date.UTC(2026, 9, 22, 3, 4),
    from: "0.1.0",
    version: "0.2.0",
    reason: "The new version didn't start",
  });
  assert.match(line, /Accordion 0\.2\.0 didn't work, so Accordion went back to 0\.1\.0, with the data as it was\. The new version didn't start\.$/);
});

test("lists every connection, with a switch where there is one", () => {
  const status: NetworkStatus = {
    updates: { host: "github.com", on: true, last: null },
    address: { host: "api.cloudflare.com", on: true, off_by_setting: true, last: null },
    certificate: { authority_host: "acme-v02.api.letsencrypt.org", provider_host: "api.cloudflare.com", last: null, expires_at: null },
    backups: [{ id: "t1", name: "Blue USB disk", host: "nas.local", on: false, last: null }],
    backup_hour: 2,
  };
  const all = connections(status);
  assert.deepEqual(
    all.map((entry) => entry.title),
    ["Update check", "Keeping your server's name pointed at it", "Certificate renewal", "Backups to Blue USB disk"],
  );
  assert.ok(all[1]!.fixed && !all[1]!.toggle, "an address set by the server's setting has no switch");
  assert.equal(
    all[2]!.where,
    "Connects to acme-v02.api.letsencrypt.org, api.cloudflare.com, and your domain's nameservers, to prove the name is yours and see that the proof is live.",
  );
  assert.equal(all[3]!.toggle?.on, false);
});
