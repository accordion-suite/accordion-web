// Filters for a list of items, as in Google Drive's row of chips: what type
// they are, who owns them, when they last changed, and where they are. They
// live in the page's address, so Back undoes one and a folder opens without
// them. The search page sends Type and Modified to the server as well, so
// they reach every folder.

import type { Found, Item } from "./item.ts";
import { kindOf } from "./icons.tsx";
import { modifiedRange } from "./search.ts";

export interface Filters {
  type: string;
  people: string;
  modified: string;
  source: string;
}

export const FILTER_NAMES = ["type", "people", "modified", "source"] as const;

/** The type filter's choices, by the names Drive's API knows them by, and
 * the kind of item each means. */
export const TYPE_KINDS: Readonly<Record<string, string>> = {
  folders: "folder",
  documents: "document",
  spreadsheets: "spreadsheet",
  presentations: "presentation",
  pdfs: "pdf",
  photos: "image",
  videos: "video",
  audio: "audio",
  archives: "archive",
};

/** The people filter's value for someone else's items. */
export function ownedBy(name: string): string {
  return `by:${name}`;
}

/** Whether `item` passes every filter that's set. */
export function matches(item: Item | Found, filters: Filters, now = new Date()): boolean {
  if (filters.type && kindOf(item) !== TYPE_KINDS[filters.type]) return false;
  if (filters.people === "me" && item.owner !== null) return false;
  if (filters.people === "shared" && !item.shared) return false;
  if (filters.people.startsWith("by:") && item.owner !== filters.people.slice(3)) return false;
  if (filters.source === "my-drive" && item.owner !== null) return false;
  if (filters.source === "shared" && item.owner === null) return false;
  if (filters.modified) {
    const { after, before } = modifiedRange(filters.modified, now);
    const modified = Date.parse(item.modified_at);
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
