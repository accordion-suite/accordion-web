// Events from the server's event log (decision 18), as Drive's Activity
// tab, the notifications bell, and the activity logs in Settings receive
// them. The server fills in names as they are now, and leaves out the names
// of folders the reader can't open.

import { formatMoment, type MessageKey, t } from "../i18n.ts";

/** Someone in an event. `name` is null for an account that was deleted. */
export interface Person {
  id: string;
  name: string | null;
}

/** An item in an event, if the reader can still open it. `name` is empty
 * for the reader's top folder. */
export interface EventItem {
  id: string;
  name: string;
  folder?: boolean;
}

export interface LoggedEvent {
  /** Later events have higher numbers. */
  id: number;
  at: string;
  action: string;
  /** Null for Accordion itself, or someone who wasn't signed in. */
  actor: Person | null;
  via: "web" | "webdav" | "app" | "server";
  item: EventItem | null;
  /** Whether the event is about an item, even one the reader can't open. */
  about_item?: boolean;
  other: Person | null;
  /** Depends on the action. Null when there's nothing more to say. */
  details: Record<string, unknown> | null;
}

/** A page of events, with whether there are older ones. */
export interface EventPage {
  events: LoggedEvent[];
  more: boolean;
}

/** Who did something, as a sentence starts: "You" for the reader. */
export function who(person: Person | null, me: string): string {
  if (person === null) return t("events.accordion");
  if (person.id === me) return t("events.you");
  return person.name ?? t("events.deletedAccount");
}

/** A person's name, without "You". */
export function personName(person: Person | null): string {
  if (person === null) return t("events.someone");
  return person.name ?? t("events.deletedAccount");
}

/** An item's name, with "My Drive" for the reader's top folder. */
export function itemName(item: EventItem): string {
  return item.name === "" ? t("drive.myDrive") : item.name;
}

/** A detail as text, or "" if it's missing. */
export function detail(event: Pick<LoggedEvent, "details">, name: string): string {
  const value = event.details?.[name];
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

/** How long ago, such as "5 minutes ago", for the last day, then the date
 * and time. */
export function when(at: string, now = Date.now()): string {
  const seconds = Math.max(0, (now - Date.parse(at)) / 1000);
  if (seconds < 60) return t("events.justNow");
  if (seconds < 60 * 60) return t("events.minutesAgo", { count: Math.floor(seconds / 60) });
  if (seconds < 24 * 60 * 60) return t("events.hoursAgo", { count: Math.floor(seconds / 3600) });
  return formatMoment(at);
}

/** How a change was made, when it wasn't the web app: "Over WebDAV", for
 * example. */
export function viaText(via: LoggedEvent["via"]): string {
  switch (via) {
    case "webdav":
      return t("events.viaWebdav");
    case "app":
      return t("events.viaApp");
    default:
      return "";
  }
}

/** One notification, or several about the same thing. */
export interface Notification {
  /** The newest event's ID. */
  id: number;
  /** Every event in the group, to read or remove it whole. */
  ids: number[];
  at: string;
  action: string;
  actor: Person | null;
  /** Whether the reader opened the list since it arrived. */
  seen: boolean;
  /** Whether they selected it. */
  read: boolean;
  item: EventItem | null;
  count: number;
  folder: EventItem | null;
  details: Record<string, unknown> | null;
}

export interface Notifications {
  /** Notifications the reader hasn't seen, for the count on the bell. */
  new: number;
  notifications: Notification[];
}

const SENTENCES: Record<string, MessageKey> = {
  shared: "notify.shared",
  share_changed: "notify.shareChanged",
  added: "notify.added",
  edited: "notify.edited",
  renamed: "notify.renamed",
  moved: "notify.moved",
  trashed: "notify.trashed",
  restored: "notify.restored",
  version_restored: "notify.versionRestored",
  description_changed: "notify.descriptionChanged",
};

/** What a notification says, such as "Sam Rivera added 12 items to
 * Holiday". */
export function notificationText(notification: Notification, me: string): string {
  return t(SENTENCES[notification.action] ?? "notify.changed", {
    who: who(notification.actor, me),
    name: notification.item ? itemName(notification.item) : "",
    folder: notification.folder ? itemName(notification.folder) : t("drive.myDrive"),
    count: notification.count,
  });
}

/** Where a notification leads: the shared item, or the folder with the
 * changes. */
export function notificationLink(notification: Notification): string {
  const { item, folder } = notification;
  if (notification.action === "shared" || notification.action === "share_changed") {
    if (!item) return "/drive/shared";
    return item.folder ? `/drive/folder/${item.id}` : `/drive/shared?file=${item.id}`;
  }
  if (notification.action === "trashed") return "/drive/trash";
  if (!folder) return "/drive/";
  const place = folder.name === "" ? "/drive/my-drive" : `/drive/folder/${folder.id}`;
  return notification.count === 1 && item && !item.folder ? `${place}?file=${item.id}` : place;
}
