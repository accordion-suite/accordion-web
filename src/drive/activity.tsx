// The Activity tab in the details panel, as in Google Drive: who changed an
// item, or anything inside a folder, and when, newest first. Events in a
// row by the same person, of the same kind, on the same day, show as one,
// such as "Sam Rivera uploaded 12 items", with the items listed under it.

import { useEffect, useState } from "preact/hooks";

import { api } from "../api.ts";
import { type MessageKey, t } from "../i18n.ts";
import { detail, type EventItem, type EventPage, itemName, type LoggedEvent, personName, viaText, when, who } from "../shell/events.ts";
import { ItemIcon } from "./icons.tsx";
import type { Item } from "./item.ts";

/** Events shown as one line. */
export interface Group {
  first: LoggedEvent;
  events: LoggedEvent[];
}

/** What makes events one group: the same person doing the same thing on
 * the same day, adding the same way or moving to the same folder. */
function groupKey(event: LoggedEvent): string {
  const day = new Date(event.at).toDateString();
  const how = event.action === "added" ? detail(event, "how") : "";
  const to = event.action === "moved" ? JSON.stringify(event.details?.["to"] ?? null) : "";
  return [event.actor?.id ?? "", event.action, day, how, to].join("|");
}

/** Groups events in a row that read as one, keeping their order. */
export function groupEvents(events: readonly LoggedEvent[]): Group[] {
  const groups: Group[] = [];
  let last = "";
  for (const event of events) {
    const key = groupKey(event);
    const group = groups[groups.length - 1];
    // Sharing names who it's with, so each stays its own line.
    const sharing = event.action === "shared" || event.action === "share_changed" || event.action === "unshared";
    if (group && key === last && !sharing) {
      group.events.push(event);
    } else {
      groups.push({ first: event, events: [event] });
    }
    last = key;
  }
  return groups;
}

const SENTENCES: Record<string, MessageKey> = {
  edited: "events.edited",
  renamed: "events.renamed",
  moved: "events.moved",
  trashed: "events.trashed",
  restored: "events.restored",
  deleted: "events.deletedForGood",
  version_restored: "events.versionRestored",
  description_changed: "events.descriptionChanged",
  shared: "events.shared",
  share_changed: "events.shareChanged",
  unshared: "events.unshared",
};

/** What a group says happened, such as "You uploaded 3 items". */
export function sentence(group: Group, me: string): string {
  const { first } = group;
  const values = { who: who(first.actor, me), count: group.events.length };
  if (first.action === "added") {
    const how = detail(first, "how");
    const key: MessageKey =
      how === "created" ? "events.created" : how === "copied" ? "events.copied" : "events.uploaded";
    return t(key, values);
  }
  return t(SENTENCES[first.action] ?? "events.changed", values);
}

/** A line under an item saying more, such as its old name. */
function note(event: LoggedEvent): string {
  switch (event.action) {
    case "renamed":
      return t("events.wasNamed", { name: detail(event, "from") });
    case "moved": {
      const to = event.details?.["to"] as EventItem | null;
      const from = event.details?.["from"] as EventItem | null;
      if (to && from) return t("events.movedFromTo", { from: itemName(from), to: itemName(to) });
      if (to) return t("events.movedTo", { to: itemName(to) });
      if (from) return t("events.movedFrom", { from: itemName(from) });
      return t("events.movedHidden");
    }
    case "shared":
    case "share_changed":
      return t(detail(event, "level") === "editor" ? "events.canEdit" : "events.canView", {
        name: personName(event.other),
      });
    case "unshared":
      return t("events.noAccess", { name: personName(event.other) });
    case "version_restored":
      return t("events.version", { number: detail(event, "number") });
    default:
      return "";
  }
}

/** The items a group is about, each once, with what changed. Something
 * deleted for good is named from the event, since it's gone. */
function GroupItems({ group }: { group: Group }) {
  const seen = new Set<string>();
  const rows = group.events.flatMap((event) => {
    if (event.action === "deleted") {
      return [{ key: String(event.id), name: detail(event, "name"), folder: event.details?.["folder"] === true, note: "" }];
    }
    if (!event.item || seen.has(event.item.id)) return [];
    seen.add(event.item.id);
    return [{ key: event.item.id, name: itemName(event.item), folder: event.item.folder === true, note: note(event) }];
  });
  return (
    <ul class="activity-items">
      {rows.map((row) => (
        <li key={row.key}>
          <ItemIcon item={{ kind: row.folder ? "folder" : "file", name: row.name }} />
          <span class="activity-item-text">
            <span class="activity-item-name">{row.name}</span>
            {row.note && <span class="hint">{row.note}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function ActivityTab({ item, me }: { item: Item; me: string }) {
  const [events, setEvents] = useState<LoggedEvent[] | null>(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const address = `/api/drive/items/${item.id}/activity`;

  useEffect(() => {
    let current = true;
    setEvents(null);
    api<EventPage>("GET", address).then(
      (page) => {
        if (!current) return;
        setEvents(page.events);
        setMore(page.more);
        setError("");
      },
      (problem: Error) => current && setError(problem.message),
    );
    return () => {
      current = false;
    };
  }, [item]);

  async function loadMore() {
    const last = events?.[events.length - 1];
    if (!last) return;
    setLoading(true);
    try {
      const page = await api<EventPage>("GET", `${address}?before=${last.id}`);
      setEvents([...(events ?? []), ...page.events]);
      setMore(page.more);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : t("error.problem"));
    } finally {
      setLoading(false);
    }
  }

  if (error && events === null) {
    return (
      <p class="error details-body" role="alert">
        {error}
      </p>
    );
  }
  if (events === null) return <p class="hint details-body">{t("shell.loading")}</p>;
  if (events.length === 0) {
    return <p class="hint details-body">{t(item.kind === "folder" ? "activity.noneFolder" : "activity.none")}</p>;
  }
  return (
    <div class="details-body">
      <ol class="activity">
        {groupEvents(events).map((group) => {
          const how = viaText(group.first.via);
          return (
            <li key={group.first.id} class="activity-entry">
              <p class="activity-sentence">{sentence(group, me)}</p>
              <p class="hint activity-when">
                <time dateTime={group.first.at}>{when(group.first.at)}</time>
                {how && ` · ${how}`}
              </p>
              <GroupItems group={group} />
            </li>
          );
        })}
      </ol>
      {error && (
        <p class="error" role="alert">
          {error}
        </p>
      )}
      {more && (
        <button type="button" class="secondary" disabled={loading} onClick={() => void loadMore()}>
          {t("activity.more")}
        </button>
      )}
    </div>
  );
}
