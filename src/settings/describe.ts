// The sentences that the Updates, Backups, and Network sections build from
// what the server reports. They're here, apart from the pages, so tests can
// check them.

import "./messages.ts";

import { formatDay, formatHour, formatList, formatMoment, formatSize, t } from "../i18n.ts";

/** What the update helper did once. Times are in milliseconds. */
export interface UpdateReport {
  outcome: "installed" | "rolled-back" | "failed";
  finished_at: number;
  from: string;
  version: string;
  reason: string | null;
}

export function updateLine(report: UpdateReport): string {
  const values = { when: formatMoment(report.finished_at), from: report.from, version: report.version };
  if (report.outcome === "installed") return t("updates.installedLine", values);
  const reason = report.reason ? ` ${report.reason}.` : "";
  if (report.outcome === "rolled-back") return t("updates.rolledBackLine", values) + reason;
  return t("updates.failedLine", values) + reason;
}

/** A try, a check, or a restore test, and how it went. */
interface Outcome {
  ok: boolean;
  finished_at: number;
  problem: string | null;
}

export interface Target {
  id: string;
  name: string;
  location: string;
  kind: "folder" | "s3" | "sftp" | "rest";
  paused: boolean;
  last_backup: Outcome | null;
  last_good_backup: number | null;
  last_check: Omit<Outcome, "finished_at"> | null;
  last_restore_test: Outcome | null;
  append_only: boolean;
  stored_bytes: number | null;
  oldest_backup: number | null;
}

/** What to say about a backup location, a sentence or two per line. */
export function targetLines(target: Target, hour: number): string[] {
  const lines: string[] = [];
  if (target.paused) lines.push(t("backups.paused"));
  const backup = target.last_backup;
  if (!backup) {
    lines.push(target.paused ? t("backups.noneYet") : t("backups.firstAt", { hour: formatHour(hour) }));
  } else if (backup.ok) {
    lines.push(t("backups.lastBackup", { when: formatMoment(backup.finished_at) }));
  } else {
    let line = t("backups.lastFailed", { when: formatMoment(backup.finished_at), problem: backup.problem ?? "" });
    if (target.last_good_backup) line += " " + t("backups.lastGood", { when: formatMoment(target.last_good_backup) });
    lines.push(line);
  }
  if (target.last_check && !target.last_check.ok) {
    lines.push(t("backups.checkFailed", { problem: target.last_check.problem ?? "" }));
  }
  if (target.append_only) {
    lines.push(t("backups.appendOnly"));
    if (target.stored_bytes !== null && target.oldest_backup !== null) {
      lines.push(t("backups.appendOnlyUse", { size: formatSize(target.stored_bytes), oldest: formatMoment(target.oldest_backup) }));
    }
  } else if (target.kind === "rest") {
    lines.push(t("backups.notAppendOnly"));
  }
  const test = target.last_restore_test;
  if (!test) lines.push(t("backups.noTest"));
  else if (test.ok) lines.push(t("backups.testPassed", { when: formatMoment(test.finished_at) }));
  else lines.push(t("backups.testFailed", { when: formatMoment(test.finished_at), problem: test.problem ?? "" }));
  return lines;
}

/** The last time a connection was made, in milliseconds, and how it went. */
interface Last {
  at: number;
  ok: boolean;
  problem: string | null;
}

export interface NetworkStatus {
  updates: { host: string; on: boolean; last: Last | null } | null;
  address: { host: string; on: boolean; off_by_setting: boolean; last: Last | null } | null;
  certificate: {
    authority_host: string;
    provider_host: string;
    last: Last | null;
    expires_at: number | null;
  } | null;
  backups: { id: string; name: string; host: string; on: boolean; last: Last | null }[];
  backup_hour: number;
}

/** One connection the server makes: why, where, how often, the last time,
 * and its switch, or why there's none. */
export interface Connection {
  title: string;
  purpose: string;
  where: string;
  often: string;
  last: string;
  fixed?: string;
  toggle?: { on: boolean; path: string; offLabel: string; onLabel: string; offHint: string };
}

function lastLine(last: Last | null, none: string): string {
  if (!last) return none;
  const when = formatMoment(last.at);
  if (last.ok) return t("network.worked", { when });
  return `${t("network.didntWork", { when })} ${last.problem ?? ""}`.trim();
}

export function connections(status: NetworkStatus): Connection[] {
  const all: Connection[] = [];
  const updates = status.updates;
  if (updates) {
    const github = updates.host === "github.com";
    all.push({
      title: t("network.updatesTitle"),
      purpose: t(github ? "network.updatesPurposeGithub" : "network.updatesPurpose"),
      where: github ? t("network.updatesWhereGithub") : t("network.connectsTo", { host: updates.host }),
      often: t("network.updatesOften"),
      last: lastLine(updates.last, t("network.notYet")),
      toggle: {
        on: updates.on,
        path: "/api/network/updates",
        offLabel: t("network.updatesOff"),
        onLabel: t("network.updatesOn"),
        offHint: t("network.updatesOffHint"),
      },
    });
  }

  const address = status.address;
  if (address) {
    const entry: Connection = {
      title: t("network.addressTitle"),
      purpose: t("network.addressPurpose"),
      where: t("network.addressWhere", { host: address.host }),
      often: t("network.addressOften"),
      last: lastLine(address.last, t("network.notSinceStart")),
    };
    if (address.off_by_setting) {
      entry.fixed = t("network.addressBySetting");
    } else {
      entry.toggle = {
        on: address.on,
        path: "/api/network/address",
        offLabel: t("network.addressOff"),
        onLabel: t("network.addressOn"),
        offHint: t("network.addressOffHint"),
      };
    }
    all.push(entry);
  }

  const certificate = status.certificate;
  if (certificate) {
    let last = lastLine(certificate.last, t("network.notSinceStart"));
    if (certificate.expires_at) last += " " + t("network.expires", { day: formatDay(certificate.expires_at) });
    all.push({
      title: t("network.certificateTitle"),
      purpose: t("network.certificatePurpose"),
      where: t("network.certificateWhere", {
        hosts: formatList([certificate.authority_host, certificate.provider_host, t("network.nameservers")]),
      }),
      often: t("network.certificateOften"),
      last,
      fixed: t("network.certificateFixed"),
    });
  }

  for (const target of status.backups) {
    all.push({
      title: t("network.backupsTitle", { name: target.name }),
      purpose: t("network.backupsPurpose"),
      where: t("network.connectsTo", { host: target.host }),
      often: t("network.backupsOften", { hour: formatHour(status.backup_hour) }),
      last: lastLine(target.last, t("network.notYet")),
      toggle: {
        on: target.on,
        path: `/api/network/backups/${target.id}`,
        offLabel: t("network.backupsOff"),
        onLabel: t("network.backupsOn"),
        offHint: t("network.backupsOffHint"),
      },
    });
  }
  return all;
}
