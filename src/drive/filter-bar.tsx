// The row of filter chips above a list, as in Google Drive. Each chip opens
// a menu of choices and shows the one that's chosen.

import { useState } from "preact/hooks";

import { type MessageKey, t } from "../i18n.ts";
import { Menu, type MenuPlace } from "../shell/menu.tsx";
import { navigate, useQuery } from "../shell/router.ts";
import { FILTER_NAMES, type Filters, ownedBy, owners, sharedWith, sharees } from "./filters.ts";
import { CheckIcon, DropdownIcon } from "./icons.tsx";
import { MODIFIED } from "./search.ts";
import type { Item } from "./item.ts";

/** The type filter's choices, with their messages. */
export const TYPES: readonly [string, string][] = [
  ["folders", "search.folders"],
  ["documents", "search.documents"],
  ["spreadsheets", "search.spreadsheets"],
  ["presentations", "search.presentations"],
  ["pdfs", "search.pdfs"],
  ["photos", "search.photos"],
  ["videos", "search.videos"],
  ["audio", "search.audio"],
  ["archives", "search.archives"],
  ["code", "search.code"],
  ["fonts", "search.fonts"],
  ["ebooks", "search.ebooks"],
  ["designs", "search.designs"],
];


/** The filters in the page's address. */
export function useFilters(): Filters {
  return {
    type: useQuery("type") ?? "",
    people: useQuery("people") ?? "",
    modified: useQuery("modified") ?? "",
    source: useQuery("source") ?? "",
  };
}

/** This page's address with `name` set to `value`, or without it. */
function withFilter(name: string | null, value = ""): string {
  const query = new URLSearchParams(location.search);
  query.delete("file");
  if (name === null) {
    for (const each of FILTER_NAMES) query.delete(each);
  } else if (value) {
    query.set(name, value);
  } else {
    query.delete(name);
  }
  const rest = query.toString();
  return rest ? `${location.pathname}?${rest}` : location.pathname;
}

/** Turns every filter off. */
export function clearFilters(): void {
  navigate(withFilter(null));
}

export function FilterBar({
  items,
  filters,
  source,
  mine,
  shares = false,
  deleted = false,
}: {
  /** Every item on the page, before filtering, for the people to offer. */
  items: readonly Item[];
  filters: Filters;
  /** Whether to offer Source, for pages with both the reader's items and
   * other people's. */
  source: boolean;
  /** Whether the reader may own any of the items, unlike in Shared with me. */
  mine: boolean;
  /** Whether the items are all the reader's own and shared, as in Shared by
   * me, so People offers who they're shared with. */
  shares?: boolean;
  /** Whether the items are in the trash, so the date is when each was
   * deleted. */
  deleted?: boolean;
}) {
  const people: [string, string][] = shares
    ? sharees(items).map(([username, name]): [string, string] => [sharedWith(username), t("filters.sharedWith", { name })])
    : [
    ...(mine
      ? ([
          ["me", t("filters.ownedByMe")],
          ["shared", t("filters.sharedByMe")],
        ] as [string, string][])
      : []),
    ...owners(items).map((name): [string, string] => [ownedBy(name), t("filters.ownedBy", { name })]),
  ];
  const any = Object.values(filters).some(Boolean);
  return (
    <div class="filters" role="group" aria-label={t("search.filters")}>
      <Filter
        label={t("search.type")}
        choices={named(TYPES)}
        chosen={filters.type}
        any={t("search.anyType")}
        onChoose={(value) => navigate(withFilter("type", value))}
      />
      {people.length > 0 && (
        <Filter
          label={t("filters.people")}
          choices={people}
          chosen={filters.people}
          any={t("filters.anyone")}
          onChoose={(value) => navigate(withFilter("people", value))}
        />
      )}
      <Filter
        label={deleted ? t("trash.deleted") : t("search.modified")}
        choices={named(MODIFIED)}
        chosen={filters.modified}
        any={t("search.anyTime")}
        onChoose={(value) => navigate(withFilter("modified", value))}
      />
      {source && (
        <Filter
          label={t("filters.source")}
          choices={[
            ["my-drive", t("drive.myDrive")],
            ["shared", t("shared.title")],
          ]}
          chosen={filters.source}
          any={t("filters.anywhere")}
          onChoose={(value) => navigate(withFilter("source", value))}
        />
      )}
      {any && (
        <button type="button" class="link" onClick={clearFilters}>
          {t("search.clearFilters")}
        </button>
      )}
    </div>
  );
}

/** Choices with their messages' keys, as choices with their words. */
export function named(choices: readonly [string, string][]): [string, string][] {
  return choices.map(([value, key]) => [value, t(key as MessageKey)]);
}

/** A filter's button, which shows what's chosen and opens the choices. */
export function Filter({
  label,
  choices,
  chosen,
  any,
  onChoose,
}: {
  label: string;
  choices: readonly [string, string][];
  chosen: string;
  any: string;
  onChoose: (value: string) => void;
}) {
  const [menu, setMenu] = useState<{ place: MenuPlace; byKeyboard: boolean } | null>(null);
  const current = choices.find(([value]) => value === chosen);
  return (
    <>
      <button
        type="button"
        class={current ? "chip chosen" : "chip"}
        aria-haspopup="menu"
        aria-expanded={menu !== null}
        onClick={(event) => setMenu({ place: { under: event.currentTarget }, byKeyboard: event.detail === 0 })}
      >
        {current && <CheckIcon />}
        {current ? current[1] : label}
        <DropdownIcon />
      </button>
      {menu && (
        <Menu
          label={label}
          entries={[
            { label: any, checked: !current, onSelect: () => onChoose("") },
            ...choices.map(([value, name]) => ({
              label: name,
              checked: value === chosen,
              onSelect: () => onChoose(value),
            })),
          ]}
          place={menu.place}
          byKeyboard={menu.byKeyboard}
          onClose={() => setMenu(null)}
        />
      )}
    </>
  );
}
