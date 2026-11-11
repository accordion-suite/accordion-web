// The orders a list can be sorted in, from the list view's column headers.
// Folders stay above files, as in the grid, and names sort the way people
// read them, so "Photo 2" comes before "Photo 10".

import type { Found, Item, SharedOut } from "./item.ts";

/** `with` and `shared` are Shared by me's columns: who an item is shared
 * with, and when. `deleted` is the trash's: when an item went there. */
export type SortKey = "name" | "location" | "modified" | "size" | "with" | "shared" | "deleted";

export interface Sort {
  key: SortKey;
  descending: boolean;
}

/** The way each column sorts first: names and places A to Z, and the newest
 * and largest first, as in Google Drive. */
const FIRST_DESCENDING: Record<SortKey, boolean> = {
  name: false,
  location: false,
  modified: true,
  size: true,
  with: false,
  shared: true,
  deleted: true,
};

const names = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** The sort after selecting `key`'s header: the other way round if it's the
 * sort already, or its first way if not. */
export function nextSort(current: Sort | null, key: SortKey): Sort {
  return current?.key === key ? { key, descending: !current.descending } : { key, descending: FIRST_DESCENDING[key] };
}

/** A sort kept as text, or `null` if it isn't one. */
export function readSort(text: string | null): Sort | null {
  try {
    const sort = JSON.parse(text ?? "null") as Partial<Sort> | null;
    return sort && typeof sort.key === "string" && sort.key in FIRST_DESCENDING && typeof sort.descending === "boolean"
      ? { key: sort.key, descending: sort.descending }
      : null;
  } catch {
    return null;
  }
}

/** `items` in `sort`'s order, or as they came without one, such as Home's
 * newest first. Items that tie are in name order. */
export function sortItems<T extends Item | Found>(items: readonly T[], sort: Sort | null): readonly T[] {
  if (!sort) return items;
  const direction = sort.descending ? -1 : 1;
  const compare = (a: T, b: T): number => {
    switch (sort.key) {
      case "name":
        return names.compare(a.name, b.name);
      case "location":
        return names.compare(place(a), place(b));
      case "modified":
        return Date.parse(a.modified_at) - Date.parse(b.modified_at);
      case "size":
        return (a.size ?? 0) - (b.size ?? 0);
      case "with":
        return names.compare(sharedWith(a), sharedWith(b));
      case "shared":
        return Date.parse(sharedAt(a)) - Date.parse(sharedAt(b));
      case "deleted":
        return Date.parse(a.trashed_at ?? "") - Date.parse(b.trashed_at ?? "");
    }
  };
  return [...items].sort(
    (a, b) =>
      Number(a.kind === "file") - Number(b.kind === "file") ||
      direction * compare(a, b) ||
      names.compare(a.name, b.name),
  );
}

/** Where an item is, as a path to compare, from a list that says so.
 * Someone else's items start with their owner, so Shared with me sorts by
 * who shared what. */
function place(item: Item | Found): string {
  return "folders" in item ? [item.owner ?? "", ...item.folders].join("/") : "";
}

function sharedWith(item: Item | Found): string {
  return "shared_with" in item ? (item as SharedOut).shared_with.map((share) => share.display_name).join(", ") : "";
}

function sharedAt(item: Item | Found): string {
  return "shared_with" in item ? (item as SharedOut).shared_at : item.modified_at;
}
