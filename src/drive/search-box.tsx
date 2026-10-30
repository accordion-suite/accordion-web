// The search box in the top bar. It searches names across all of the
// reader's Drive, and shows the results on the search page, keeping any
// filters chosen there.

import { useEffect, useState } from "preact/hooks";

import { t } from "../i18n.ts";
import { navigate, usePath, useQuery } from "../shell/router.ts";
import { SearchIcon } from "./icons.tsx";

/** The search page's address for these words and filters. */
export function searchPath(words: string, filters: URLSearchParams): string {
  const query = new URLSearchParams(filters);
  query.delete("file");
  if (words.trim()) query.set("q", words.trim());
  else query.delete("q");
  const text = query.toString();
  return text ? `/drive/search?${text}` : "/drive/search";
}

export function SearchBox() {
  const path = usePath();
  const searched = useQuery("q") ?? "";
  const [words, setWords] = useState(searched);

  // Shows the words of the search that's open, and clears on other pages.
  useEffect(() => setWords(path === "/drive/search" ? searched : ""), [path, searched]);

  return (
    <form
      class="search"
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        const filters = path === "/drive/search" ? new URLSearchParams(location.search) : new URLSearchParams();
        navigate(searchPath(words, filters));
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
    </form>
  );
}
