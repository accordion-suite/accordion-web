// The search box in the top bar. It searches names and the text inside
// files across all of the reader's Drive, and shows the results on the
// search page, keeping any filters chosen there. Its options button opens
// the panel with a field for each filter.

import { useEffect, useState } from "preact/hooks";

import { t } from "../i18n.ts";
import { navigate, usePath, useQuery } from "../shell/router.ts";
import { OptionsIcon, SearchIcon } from "./icons.tsx";
import { NO_FILTERS, readSearch, type SearchFilters, searchPath } from "./search.ts";
import { SearchOptions } from "./search-options.tsx";

export function SearchBox() {
  const path = usePath();
  const searched = useQuery("q") ?? "";
  const [words, setWords] = useState(searched);
  const [options, setOptions] = useState<SearchFilters | null>(null);

  // Shows the words of the search that's open, and clears on other pages.
  useEffect(() => setWords(path === "/drive/search" ? searched : ""), [path, searched]);

  /** The search that's open, with the words in the box. */
  function current(): SearchFilters {
    const filters = path === "/drive/search" ? readSearch(new URLSearchParams(location.search)) : NO_FILTERS;
    return { ...filters, q: words.trim() };
  }

  return (
    <>
      <form
        class="search"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          navigate(searchPath(current()));
        }}
      >
        <SearchIcon />
        <input
          type="search"
          aria-label={t("search.label")}
          placeholder={t("search.label")}
          autocomplete="off"
          value={words}
          onInput={(event) => setWords(event.currentTarget.value)}
        />
        <button
          type="button"
          class="icon-button search-options-button"
          title={t("search.options")}
          aria-label={t("search.options")}
          aria-haspopup="dialog"
          onClick={() => setOptions(current())}
        >
          <OptionsIcon />
        </button>
      </form>
      {options && <SearchOptions initial={options} onClose={() => setOptions(null)} />}
    </>
  );
}
