// Filters for a list of items, as in Google Drive's row of chips: what type
// they are, who owns them, when they last changed, and where they are. They
// live in the page's address, so Back undoes one and a folder opens without
// them. The search page sends Type and Modified to the server as well, so
// they reach every folder.

import type { Found, Item, SharedOut } from "./item.ts";
import { kindOf } from "./icons.tsx";
import { modifiedRange } from "./search.ts";
import { TYPE_KINDS } from "./types.ts";

export interface Filters {
  type: string;
  people: string;
  modified: string;
  source: string;
}

export const FILTER_NAMES = ["type", "people", "modified", "source"] as const;


/** The people filter's value for someone: the items they own, and the
 * reader's items shared with them. */
export function withPerson(username: string): string {
  return `person:${username}`;
}

/** What the people filter needs to know about the person chosen. */
export interface PersonIndex {
  username: string;
  /** Their name, as items they own give it. */
  name: string;
  /** The reader's items shared with them. */
  shared: ReadonlySet<string>;
}

/** The people filter's value for someone else's items. */
export function ownedBy(name: string): string {
  return `by:${name}`;
}

/** The people filter's value for what the reader shared with someone, on
 * Shared by me. */
export function sharedWith(username: string): string {
  return `with:${username}`;
}

/** Whether `item` passes every filter that's set. In the trash, the date
 * filter is for when an item was deleted. A person chosen in the people
 * filter needs `person`, and nothing matches until it's there. */
export function matches(
  item: Item | Found,
  filters: Filters,
  now = new Date(),
  date: "modified" | "deleted" = "modified",
  person: PersonIndex | null = null,
): boolean {
  if (filters.type && kindOf(item) !== TYPE_KINDS[filters.type]) return false;
  if (filters.people === "me" && item.owner !== null) return false;
  if (filters.people === "shared" && !item.shared) return false;
  if (filters.people.startsWith("by:") && item.owner !== filters.people.slice(3)) return false;
  if (filters.people.startsWith("person:")) {
    if (person?.username !== filters.people.slice(7)) return false;
    const sharedOut =
      "shared_with" in item && (item as SharedOut).shared_with.some((share) => share.username === person.username);
    if (item.owner !== person.name && !person.shared.has(item.id) && !sharedOut) return false;
  }
  if (filters.people.startsWith("with:")) {
    const username = filters.people.slice(5);
    if (!("shared_with" in item) || !(item as SharedOut).shared_with.some((share) => share.username === username)) {
      return false;
    }
  }
  if (filters.source === "my-drive" && item.owner !== null) return false;
  if (filters.source === "shared" && item.owner === null) return false;
  if (filters.modified) {
    const { after, before } = modifiedRange(filters.modified, now);
    const modified = Date.parse((date === "deleted" ? item.trashed_at : item.modified_at) ?? "");
    if (after && modified < Date.parse(after)) return false;
    if (before && modified >= Date.parse(before)) return false;
  }
  return true;
}

/** The names of the other people who own `items`, for the people filter. */
export function owners(items: readonly Item[]): string[] {
  const names = new Set(items.flatMap((item) => (item.owner === null ? [] : [item.owner])));
  return [...names].sort((a, b) => a.localeCompare(b));
}

/** Everyone the reader shared `items` with, by username and name, for the
 * people filter on Shared by me. */
export function sharees(items: readonly Item[]): [string, string][] {
  const people = new Map<string, string>();
  for (const item of items) {
    if (!("shared_with" in item)) continue;
    for (const share of (item as SharedOut).shared_with) people.set(share.username, share.display_name);
  }
  return [...people].sort((a, b) => a[1].localeCompare(b[1]));
}
