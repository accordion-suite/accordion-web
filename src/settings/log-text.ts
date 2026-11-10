// What each event in Settings' activity logs says happened, as the reader
// sees it, such as "Shared Holiday with Sam Rivera" or "Sam Rivera shared
// Holiday with you".

import { type MessageKey, t } from "../i18n.ts";
import { detail, type LoggedEvent, personName, who } from "../shell/events.ts";

const ACCOUNT_CHANGES: Record<string, MessageKey> = {
  name: "log.renamedAccount",
  turned_off: "log.turnedOff",
  turned_on: "log.turnedOn",
  password_reset: "log.passwordReset",
  password_link: "log.passwordLink",
  quota: "log.quota",
};

const BACKUP_CHANGES: Record<string, MessageKey> = {
  key_created: "log.keyCreated",
  target_added: "log.targetAdded",
  target_removed: "log.targetRemoved",
  hour: "log.backupHour",
  paused: "log.backupPaused",
  resumed: "log.backupResumed",
};

/** What an event says happened, as the reader `me` sees it. */
export function logText(event: LoggedEvent, me: string): string {
  const values = {
    who: who(event.actor, me),
    other: personName(event.other),
    item: event.item?.name ?? t("log.anItem"),
    device: detail(event, "device"),
    name: detail(event, "name"),
    version: detail(event, "version"),
  };
  const mine = event.actor?.id === me;
  switch (event.action) {
    case "signed_in":
      return t("log.signedIn", values);
    case "sign_in_failed":
      return event.other?.id === me ? t("log.signInFailed") : t("log.signInFailedFor", values);
    case "signed_out":
      return t("log.signedOut");
    case "session_ended":
      return t("log.sessionEnded", values);
    case "password_changed":
      return t("log.passwordChanged");
    case "app_password_created":
      return t("log.appPasswordCreated", values);
    case "app_password_removed":
      return t("log.appPasswordRemoved", values);
    case "remote_device_added":
      return t("log.remoteDeviceAdded", values);
    case "remote_device_removed":
      return t("log.remoteDeviceRemoved", values);
    case "link_sharing_changed":
      return t(event.details?.on === true ? "log.linkSharingOn" : "log.linkSharingOff");
    case "link_created":
      return t("log.linkCreated", values);
    case "link_removed":
      return t("log.linkRemoved", values);
    case "link_opened":
      return t("log.linkOpened", values);
    case "remote_access_changed":
      return t(event.details?.on === true ? "log.remoteAccessOn" : "log.remoteAccessOff");
    case "shared":
      return t(mine ? "log.sharedOut" : "log.sharedIn", values);
    case "share_changed":
      return t(mine ? "log.shareChangedOut" : "log.shareChangedIn", values);
    case "unshared":
      return t(mine ? "log.unsharedOut" : "log.unsharedIn", values);
    case "account_created":
      return t("log.accountCreated", values);
    case "account_deleted":
      return t("log.accountDeleted", values);
    case "account_changed": {
      const change = detail(event, "change");
      if (change === "role") return t(detail(event, "role") === "admin" ? "log.roleAdmin" : "log.roleUser", values);
      return t(ACCOUNT_CHANGES[change] ?? "log.accountChanged", values);
    }
    case "backup_changed":
      return t(BACKUP_CHANGES[detail(event, "change")] ?? "log.backupChanged", values);
    case "backup_restored":
      return t("log.backupRestored");
    case "update_installed":
      return values.version ? t("log.updateInstalled", values) : t("log.updateInstalledUnknown");
    case "retention_changed":
      // Storage's change names its days. The activity log's names keep_days.
      return t(event.details?.trash_days !== undefined ? "log.storageRetentionChanged" : "log.retentionChanged");
    case "previews_changed":
      return t("log.previewsChanged");
    default:
      return t("log.other");
  }
}
