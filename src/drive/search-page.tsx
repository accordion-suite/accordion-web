// Search results (decision 20): the reader's items whose names or text
// match, from every folder. Names that match come first, newest first, then
// files whose text matches, best first, each with a line of text around the
// words. The server applies every filter, so they work without any words,
// such as to list every PDF.
//
// The words and filters are in the address, so a search can be bookmarked,
// and Back returns to the one before.

import { useMemo, useState } from "preact/hooks";

import { t } from "../i18n.ts";
import { PageTitle } from "../shell/page.tsx";
import { useQueryString } from "../shell/router.ts";
import { FoundList, useFound } from "./home-page.tsx";
import type { Hit } from "./item.ts";
import { PageTools } from "./item-list.tsx";
import { useTarget } from "./layout.tsx";
import { readSearch, searchAddress } from "./search.ts";
import { SearchChips } from "./search-options.tsx";

export function SearchPage() {
  const query = useQueryString();
  const filters = useMemo(() => readSearch(new URLSearchParams(query)), [query]);
  // Worked out once per search, so the address and the list stay the same
  // while the page is open, though "last 7 days" moves on.
  const [addresses] = useState(() => new Map<string, string>());
  if (!addresses.has(query)) addresses.set(query, searchAddress(filters));
  const { items, error } = useFound<Hit>(addresses.get(query)!);
  useTarget(null, false);

  return (
    <main class="page">
      <div class="page-head">
        <PageTitle>{filters.q ? t("search.titleFor", { words: filters.q }) : t("search.title")}</PageTitle>
        <PageTools />
      </div>
      <FoundList
        items={items}
        error={error}
        label={t("search.results")}
        empty={t("search.empty")}
        sortScope="search"
        toolbar={<SearchChips filters={filters} />}
      />
    </main>
  );
}
