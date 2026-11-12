// A search's options (decision 20): the panel the search box opens, with a
// field for each filter, as Google Drive's Advanced search has, and the
// chips on the search page, which show what's chosen and change one filter
// at a time. Both are the same filters, kept in the page's address, so a
// search can be bookmarked and Back undoes a change.

import type { ComponentChildren, TargetedSubmitEvent } from "preact";
import { useEffect, useId, useState } from "preact/hooks";

import { api } from "../api.ts";
import { formatCalendarDay, t } from "../i18n.ts";
import { Dialog } from "../shell/dialog.tsx";
import { navigate } from "../shell/router.ts";
import { ChooseFolderDialog, type Person } from "./dialogs.tsx";
import { Filter, named, TYPES, typeIcon } from "./filter-bar.tsx";
import { CheckIcon, CloseIcon } from "./icons.tsx";
import type { Item } from "./item.ts";
import { anyFilter, MODIFIED, NO_FILTERS, type SearchFilters, searchPath } from "./search.ts";

/** The location filter's choice that opens the folder chooser, rather than
 * being a place itself. */
const CHOOSE = "choose";

/** Whether the location filter is a folder, rather than My Drive or what's
 * shared. */
function isFolder(place: string): boolean {
  return place !== "" && place !== "my-drive" && place !== "shared";
}

/** Everyone else on the server, for the owner and sharing filters. */
function usePeople(): Person[] {
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

/** The name of the folder a search looks in, if it looks in one. */
function useFolderName(place: string): string {
  const [name, setName] = useState("");
  useEffect(() => {
    setName("");
    if (!isFolder(place)) return;
    api<Item>("GET", `/api/drive/items/${place}`).then(
      (folder) => setName(folder.parent === null ? t("drive.myDrive") : folder.name),
      () => setName(t("search.chooseFolder")),
    );
  }, [place]);
  return name;
}

/** People as filter choices, with the chosen one first known by username
 * until the list arrives. */
function personChoices(
  people: readonly Person[],
  chosen: string,
  label: (name: string) => string,
): [string, string][] {
  const choices = people.map((person): [string, string] => [person.username, label(person.display_name)]);
  if (chosen && !people.some((person) => person.username === chosen)) choices.push([chosen, label(chosen)]);
  return choices;
}

/** What a filter between two dates covers, in words. */
function rangeText(filters: SearchFilters): string {
  const from = filters.from && formatCalendarDay(filters.from);
  const to = filters.to && formatCalendarDay(filters.to);
  if (from && to) return t("search.fromTo", { from, to });
  if (from) return t("search.since", { from });
  if (to) return t("search.until", { to });
  return t("search.between");
}

/** The panel of search options, starting from `initial`. Searching opens
 * the search page with them. */
export function SearchOptions({ initial, onClose }: { initial: SearchFilters; onClose: () => void }) {
  const [filters, setFilters] = useState(initial);
  const [choosing, setChoosing] = useState(false);
  const people = usePeople();
  const folderName = useFolderName(filters.in);
  const id = useId();

  function set<K extends keyof SearchFilters>(name: K, value: SearchFilters[K]) {
    setFilters((before) => ({ ...before, [name]: value }));
  }

  function submit(event: TargetedSubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    onClose();
    navigate(searchPath(filters));
  }

  const row = (name: string, label: string, control: ComponentChildren) => (
    <div class="option-row">
      <label for={`${id}-${name}`}>{label}</label>
      <div class="option-control">{control}</div>
    </div>
  );

  return (
    <Dialog title={t("search.options")} class="search-options" onClose={onClose}>
      <button type="button" class="icon-button dialog-close" aria-label={t("dialog.close")} onClick={onClose}>
        <CloseIcon />
      </button>
      <form onSubmit={submit}>
        {row(
          "type",
          t("search.type"),
          <select id={`${id}-type`} value={filters.type} onChange={(event) => set("type", event.currentTarget.value)}>
            <option value="">{t("search.anyType")}</option>
            {named(TYPES).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>,
        )}
        {row(
          "owner",
          t("search.owner"),
          <select id={`${id}-owner`} value={filters.owner} onChange={(event) => set("owner", event.currentTarget.value)}>
            <option value="">{t("search.anyOwner")}</option>
            <option value="me">{t("search.ownedByMe")}</option>
            <option value="others">{t("search.notOwnedByMe")}</option>
            {personChoices(people, filters.owner === "me" || filters.owner === "others" ? "" : filters.owner, (name) =>
              t("search.ownedBy", { name }),
            ).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>,
        )}
        {row(
          "words",
          t("search.hasWords"),
          <input
            id={`${id}-words`}
            type="search"
            placeholder={t("search.hasWordsHint")}
            value={filters.q}
            onInput={(event) => set("q", event.currentTarget.value)}
          />,
        )}
        {row(
          "name",
          t("search.itemName"),
          <input
            id={`${id}-name`}
            type="search"
            placeholder={t("search.itemNameHint")}
            value={filters.name}
            onInput={(event) => set("name", event.currentTarget.value)}
          />,
        )}
        {row(
          "in",
          t("search.location"),
          <>
            <select
              id={`${id}-in`}
              value={filters.in}
              onChange={(event) => {
                const value = event.currentTarget.value;
                if (value === CHOOSE) {
                  // The select shows the place chosen before until a
                  // folder is.
                  event.currentTarget.value = filters.in;
                  setChoosing(true);
                } else {
                  set("in", value);
                }
              }}
            >
              <option value="">{t("search.anywhere")}</option>
              <option value="my-drive">{t("drive.myDrive")}</option>
              <option value="shared">{t("search.sharedWithMe")}</option>
              {isFolder(filters.in) && <option value={filters.in}>{folderName || t("shell.loading")}</option>}
              <option value={CHOOSE}>{t("search.chooseFolderMenu")}</option>
            </select>
            <div class="option-checks">
              <label class="check">
                <input type="checkbox" checked={filters.trash} onChange={(event) => set("trash", event.currentTarget.checked)} />
                {t("search.inTrash")}
              </label>
              <label class="check">
                <input
                  type="checkbox"
                  checked={filters.starred}
                  onChange={(event) => set("starred", event.currentTarget.checked)}
                />
                {t("search.starred")}
              </label>
            </div>
          </>,
        )}
        {row(
          "modified",
          t("search.dateModified"),
          <>
            <select
              id={`${id}-modified`}
              value={filters.modified}
              onChange={(event) => set("modified", event.currentTarget.value)}
            >
              <option value="">{t("search.anyTime")}</option>
              {named(MODIFIED).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
              <option value="custom">{t("search.between")}</option>
            </select>
            {filters.modified === "custom" && (
              <div class="option-dates">
                <label>
                  {t("search.from")}
                  <input type="date" value={filters.from} onInput={(event) => set("from", event.currentTarget.value)} />
                </label>
                <label>
                  {t("search.to")}
                  <input type="date" value={filters.to} onInput={(event) => set("to", event.currentTarget.value)} />
                </label>
              </div>
            )}
          </>,
        )}
        {row(
          "shared-with",
          t("search.sharedWith"),
          <select
            id={`${id}-shared-with`}
            value={filters.shared_with}
            onChange={(event) => set("shared_with", event.currentTarget.value)}
          >
            <option value="">{t("search.sharedWithAnyone")}</option>
            {personChoices(people, filters.shared_with, (name) => name).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>,
        )}
        <div class="dialog-buttons">
          <button type="button" class="secondary" onClick={() => setFilters({ ...NO_FILTERS })}>
            {t("search.reset")}
          </button>
          <button type="submit">{t("search.search")}</button>
        </div>
      </form>
      {choosing && (
        <ChooseFolderDialog
          onChosen={(folder) => {
            setChoosing(false);
            set("in", folder);
          }}
          onClose={() => setChoosing(false)}
        />
      )}
    </Dialog>
  );
}

/** The search page's chips: one for each filter with a menu of choices,
 * and one for each other filter that's set, which removes it. */
export function SearchChips({ filters }: { filters: SearchFilters }) {
  const people = usePeople();
  const folderName = useFolderName(filters.in);
  const [choosing, setChoosing] = useState(false);
  const change = (next: Partial<SearchFilters>) => navigate(searchPath({ ...filters, ...next }));

  const owner = filters.owner === "me" || filters.owner === "others" ? "" : filters.owner;
  const sharedWith =
    filters.shared_with &&
    (people.find((person) => person.username === filters.shared_with)?.display_name ?? filters.shared_with);
  // Filters without a menu of their own show only while they're set.
  const set: [string, Partial<SearchFilters>][] = [
    ...(filters.name ? [[t("search.nameHas", { words: filters.name }), { name: "" }] as [string, Partial<SearchFilters>]] : []),
    ...(filters.starred ? [[t("search.starred"), { starred: false }] as [string, Partial<SearchFilters>]] : []),
    ...(filters.trash ? [[t("search.inTrash"), { trash: false }] as [string, Partial<SearchFilters>]] : []),
    ...(sharedWith
      ? [[t("search.sharedWithName", { name: sharedWith }), { shared_with: "" }] as [string, Partial<SearchFilters>]]
      : []),
  ];

  return (
    <div class="filters" role="group" aria-label={t("search.filters")}>
      <Filter
        label={t("search.type")}
        choices={named(TYPES)}
        chosen={filters.type}
        any={t("search.anyType")}
        icon={typeIcon}
        onChoose={(type) => change({ type })}
      />
      <Filter
        label={t("search.owner")}
        choices={[
          ["me", t("search.ownedByMe")],
          ["others", t("search.notOwnedByMe")],
          ...personChoices(people, owner, (name) => t("search.ownedBy", { name })),
        ]}
        chosen={filters.owner}
        any={t("search.anyOwner")}
        onChoose={(value) => change({ owner: value })}
      />
      <Filter
        label={t("search.modified")}
        choices={[...named(MODIFIED), ...(filters.modified === "custom" ? [["custom", rangeText(filters)] as [string, string]] : [])]}
        chosen={filters.modified}
        any={t("search.anyTime")}
        onChoose={(modified) => change({ modified })}
      />
      <Filter
        label={t("search.location")}
        choices={[
          ["my-drive", t("drive.myDrive")],
          ["shared", t("search.sharedWithMe")],
          ...(isFolder(filters.in) ? [[filters.in, folderName || t("shell.loading")] as [string, string]] : []),
          [CHOOSE, t("search.chooseFolderMenu")],
        ]}
        chosen={filters.in}
        any={t("search.anywhere")}
        onChoose={(value) => (value === CHOOSE ? setChoosing(true) : change({ in: value }))}
      />
      {set.map(([label, clear]) => (
        <button
          key={label}
          type="button"
          class="chip chosen"
          aria-label={t("search.removeFilter", { name: label })}
          onClick={() => change(clear)}
        >
          <CheckIcon />
          {label}
          <CloseIcon />
        </button>
      ))}
      {anyFilter(filters) && (
        <button type="button" class="link" onClick={() => navigate(searchPath({ ...NO_FILTERS, q: filters.q }))}>
          {t("search.clearFilters")}
        </button>
      )}
      {choosing && (
        <ChooseFolderDialog
          onChosen={(folder) => {
            setChoosing(false);
            change({ in: folder });
          }}
          onClose={() => setChoosing(false)}
        />
      )}
    </div>
  );
}
