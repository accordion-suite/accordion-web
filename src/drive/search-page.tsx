// Search results: the reader's items whose names match, from every folder,
// most recently changed first. Filters narrow them by type and by when they
// last changed, and work without any words, such as to list every PDF.
//
// The words and filters are in the address, so a search can be bookmarked,
// and Back returns to the one before.

import { useState } from "preact/hooks";

import { t, type MessageKey } from "../i18n.ts";
import { Menu, type MenuPlace } from "../shell/menu.tsx";
import { PageTitle } from "../shell/page.tsx";
import { navigate, useQuery } from "../shell/router.ts";
import { FoundList, useFound } from "./home-page.tsx";
import { CheckIcon } from "./icons.tsx";
import { ViewToggle } from "./item-list.tsx";
import { useTarget } from "./layout.tsx";
import { searchPath } from "./search-box.tsx";
import { searchAddress } from "./search.ts";

/** The type filter's choices, which Drive's API knows by these names. */
const TYPES: readonly [string, MessageKey][] = [
  ["folders", "search.folders"],
  ["documents", "search.documents"],
  ["spreadsheets", "search.spreadsheets"],
  ["presentations", "search.presentations"],
  ["pdfs", "search.pdfs"],
  ["photos", "search.photos"],
  ["videos", "search.videos"],
  ["audio", "search.audio"],
  ["archives", "search.archives"],
];

const MODIFIED: readonly [string, MessageKey][] = [
  ["today", "search.today"],
  ["week", "search.week"],
  ["month", "search.month"],
  ["year", "search.thisYear"],
  ["last-year", "search.lastYear"],
];

export function SearchPage() {
  const words = useQuery("q") ?? "";
  const type = useQuery("type") ?? "";
  const modified = useQuery("modified") ?? "";
  // Worked out once per search, so the address and the list stay the same
  // while the page is open.
  const [address] = useState(() => new Map<string, string>());
  const key = `${words}\n${type}\n${modified}`;
  if (!address.has(key)) address.set(key, searchAddress(words, type, modified));
  const { items, error } = useFound(address.get(key)!);
  useTarget(null, false);

  function choose(name: "type" | "modified", value: string) {
    const query = new URLSearchParams(location.search);
    if (value) query.set(name, value);
    else query.delete(name);
    navigate(searchPath(words, query));
  }

  return (
    <main class="page">
      <div class="page-head">
        <PageTitle>{words ? t("search.titleFor", { words }) : t("search.title")}</PageTitle>
        <ViewToggle />
      </div>
      <div class="filters" role="group" aria-label={t("search.filters")}>
        <Filter
          label={t("search.type")}
          choices={TYPES}
          chosen={type}
          any={t("search.anyType")}
          onChoose={(value) => choose("type", value)}
        />
        <Filter
          label={t("search.modified")}
          choices={MODIFIED}
          chosen={modified}
          any={t("search.anyTime")}
          onChoose={(value) => choose("modified", value)}
        />
        {(type || modified) && (
          <button type="button" class="link" onClick={() => navigate(searchPath(words, new URLSearchParams()))}>
            {t("search.clearFilters")}
          </button>
        )}
      </div>
      <FoundList items={items} error={error} label={t("search.results")} empty={t("search.empty")} />
    </main>
  );
}

/** A filter's button, which shows what's chosen and opens the choices. */
function Filter({
  label,
  choices,
  chosen,
  any,
  onChoose,
}: {
  label: string;
  choices: readonly [string, MessageKey][];
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
        {current ? t(current[1]) : label}
      </button>
      {menu && (
        <Menu
          label={label}
          entries={[
            { label: any, checked: !current, onSelect: () => onChoose("") },
            ...choices.map(([value, name]) => ({
              label: t(name),
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
