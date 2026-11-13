// The row of filter chips above a list, as in Google Drive. Each chip opens
// a menu of choices and shows the one that's chosen.

import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";

import { api } from "../api.ts";

import { type MessageKey, t } from "../i18n.ts";
import { Menu, type MenuPlace } from "../shell/menu.tsx";
import { navigate, useQuery } from "../shell/router.ts";
import type { Person } from "./dialogs.tsx";
import {
  FILTER_NAMES,
  type Filters,
  ownedBy,
  owners,
  type PersonIndex,
  sharedWith,
  sharees,
  withPerson,
} from "./filters.ts";
import { CheckIcon, DriveIcon, DropdownIcon, ItemIcon, SharedOutIcon } from "./icons.tsx";
import { MODIFIED } from "./search.ts";
import type { Item, SharedOut } from "./item.ts";
import { useChanges } from "./store.ts";

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

/** A type filter choice's icon, the one its items have in a list. */
export function typeIcon(type: string): ComponentChildren {
  return <ItemIcon item={{ kind: type === "folders" ? "folder" : "file", name: "", type }} />;
}

/** Everyone else on the server, for the people filters. */
export function usePeople(): Person[] {
  const [people, setPeople] = useState<Person[]>([]);
  useEffect(() => {
    let current = true;
    api<Person[]>("GET", "/api/directory").then(
      (all) => current && setPeople(all.filter((person) => !person.you)),
      // Without the list, the filters offer only the reader's own choices.
      () => {},
    );
    return () => {
      current = false;
    };
  }, []);
  return people;
}

/** For the people filter set to someone: their name, and which of the
 * reader's items are shared with them. Null while it loads, or when no one
 * is chosen. */
export function usePersonIndex(filter: string, people: readonly Person[]): PersonIndex | null {
  const username = filter.startsWith("person:") ? filter.slice(7) : "";
  const name = people.find((person) => person.username === username)?.display_name ?? null;
  const [shared, setShared] = useState<{ username: string; ids: ReadonlySet<string> } | null>(null);
  const [version, setVersion] = useState(0);
  useChanges(() => setVersion((count) => count + 1));
  useEffect(() => {
    if (!username) return;
    let current = true;
    api<SharedOut[]>("GET", "/api/drive/shared-by-me").then(
      (items) => {
        const ids = items.filter((item) => item.shared_with.some((share) => share.username === username));
        if (current) setShared({ username, ids: new Set(ids.map((item) => item.id)) });
      },
      // Without the list, the filter shows only what they own.
      () => current && setShared({ username, ids: new Set() }),
    );
    return () => {
      current = false;
    };
  }, [username, version]);
  // The same object until something in it changes, since the list filters
  // again whenever it does, and its effects run on what it shows.
  const ready = username && name !== null && shared?.username === username;
  return useMemo(() => (ready ? { username, name, shared: shared.ids } : null), [ready, username, name, shared]);
}

/** A person's first letter in a circle, as the account button shows it. */
function Initial({ name }: { name: string }) {
  return <span class="avatar tiny">{[...name.trim()][0]?.toUpperCase() ?? "?"}</span>;
}

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
  people: everyone,
  filters,
  source,
  mine,
  shares = false,
  deleted = false,
}: {
  /** Every item on the page, before filtering, for the people to offer. */
  items: readonly Item[];
  /** Everyone else on the server, from {@link usePeople}. */
  people: readonly Person[];
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
  // Everyone on the server, by name, and anyone on the page who isn't,
  // such as someone whose account was removed.
  const names = new Set(everyone.map((person) => person.display_name));
  const usernames = new Set(everyone.map((person) => person.username));
  const people: [string, string][] = [
    ...(mine && !shares
      ? ([
          ["me", t("filters.ownedByMe")],
          ["shared", t("filters.sharedByMe")],
        ] as [string, string][])
      : []),
    ...everyone.map((person): [string, string] => [withPerson(person.username), person.display_name]),
    ...(shares
      ? sharees(items)
          .filter(([username]) => !usernames.has(username))
          .map(([username, name]): [string, string] => [sharedWith(username), t("filters.sharedWith", { name })])
      : owners(items)
          .filter((name) => !names.has(name))
          .map((name): [string, string] => [ownedBy(name), t("filters.ownedBy", { name })])),
  ];
  const icon = (value: string) =>
    personIcon(
      value,
      everyone,
      value.startsWith("by:") ? value.slice(3) : sharees(items).find(([username]) => sharedWith(username) === value)?.[1],
    );
  const any = Object.values(filters).some(Boolean);
  return (
    <div class="filters" role="group" aria-label={t("search.filters")}>
      <Filter
        label={t("search.type")}
        choices={named(TYPES)}
        chosen={filters.type}
        any={t("search.anyType")}
        icon={typeIcon}
        onChoose={(value) => navigate(withFilter("type", value))}
      />
      {people.length > 0 && (
        <Filter
          label={t("filters.people")}
          choices={people}
          chosen={filters.people}
          any={t("filters.anyone")}
          icon={icon}
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

/** A People filter choice's icon: the person's initial, or for the reader's
 * own choices, the icons their pages have in the sidebar. `name` is for a
 * choice that isn't someone on the server, such as a removed account. */
export function personIcon(value: string, everyone: readonly Person[], name?: string) {
  if (value === "me") return <DriveIcon />;
  if (value === "shared") return <SharedOutIcon />;
  const person = everyone.find((each) => withPerson(each.username) === value);
  return <Initial name={person?.display_name ?? name ?? ""} />;
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
  icon,
  onChoose,
}: {
  label: string;
  choices: readonly [string, string][];
  chosen: string;
  any: string;
  /** Each choice's icon in the menu, if the choices have them. */
  icon?: (value: string) => ComponentChildren;
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
            // An empty space keeps "any" in line with the choices' names.
            { label: any, checked: !current, icon: icon && <span class="icon" />, onSelect: () => onChoose("") },
            ...choices.map(([value, name]) => ({
              label: name,
              checked: value === chosen,
              icon: icon?.(value),
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
