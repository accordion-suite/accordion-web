// Search results: the reader's items whose names match, from every folder,
// most recently changed first. The list's filters narrow them, and the
// server applies Type and Modified across every folder, so they work
// without any words, such as to list every PDF.
//
// The words and filters are in the address, so a search can be bookmarked,
// and Back returns to the one before.

import { useState } from "preact/hooks";

import { t } from "../i18n.ts";
import { PageTitle } from "../shell/page.tsx";
import { useQuery } from "../shell/router.ts";
import { FoundList, useFound } from "./home-page.tsx";
import { PageTools } from "./item-list.tsx";
import { useTarget } from "./layout.tsx";
import { searchAddress } from "./search.ts";

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

  return (
    <main class="page">
      <div class="page-head">
        <PageTitle>{words ? t("search.titleFor", { words }) : t("search.title")}</PageTitle>
        <PageTools />
      </div>
      <FoundList items={items} error={error} label={t("search.results")} empty={t("search.empty")} />
    </main>
  );
}
