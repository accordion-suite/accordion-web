// Drive's home page: the reader's files, most recently changed first, from
// every folder, so what they're working on is a step away.

import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";

import { api } from "../api.ts";
import { t } from "../i18n.ts";
import { PageTitle } from "../shell/page.tsx";
import { ItemList, PageTools } from "./item-list.tsx";
import type { Found } from "./item.ts";
import { useDrive, useTarget } from "./layout.tsx";
import { type SortScope, useChanges } from "./store.ts";

/** A page that lists what an address of Drive's API returns, such as
 * recent or starred files. */
export function useFound<T extends Found = Found>(address: string): { items: T[] | null; error: string } {
  const drive = useDrive();
  const [items, setItems] = useState<T[] | null>(null);
  const [error, setError] = useState("");
  const refresh = () => {
    api<T[]>("GET", address).then(
      (found) => {
        setItems(found);
        setError("");
      },
      (problem: Error) => (items ? drive.notify({ message: problem.message, problem: true }) : setError(problem.message)),
    );
  };
  useEffect(refresh, [address]);
  useChanges(refresh);
  return { items, error };
}

export function HomePage() {
  const { items, error } = useFound("/api/drive/recent");
  // Files dropped here go to My Drive, as New's uploads do.
  useTarget(null, true);

  return (
    <main class="page">
      <div class="page-head">
        <PageTitle>{t("home.title")}</PageTitle>
        <PageTools />
      </div>
      <h2 class="list-title">{t("home.recent")}</h2>
      <FoundList items={items} error={error} label={t("home.recent")} empty={t("home.empty")} />
    </main>
  );
}

/** The list for a `useFound` page, or why it's empty. */
export function FoundList({
  items,
  error,
  label,
  empty,
  owners = false,
  shares = false,
  sortScope,
  toolbar,
}: {
  items: Found[] | null;
  error: string;
  label: string;
  empty: string;
  /** Shows who owns each item rather than where it is. */
  owners?: boolean;
  /** Shows who each item is shared with and when, for Shared by me. */
  shares?: boolean;
  sortScope?: SortScope;
  /** Filters in place of the list's own, for a page whose server applies
   * them. */
  toolbar?: ComponentChildren;
}) {
  if (error) {
    return (
      <p class="error" role="alert">
        {error}
      </p>
    );
  }
  if (!items) return <p class="loading">{t("shell.loading")}</p>;
  // The list says when it's empty, under its filters, so a filter that
  // matches nothing can be changed.
  return (
    <ItemList
      items={items}
      label={label}
      location
      owners={owners}
      shares={shares}
      empty={empty}
      sortScope={sortScope}
      toolbar={toolbar}
    />
  );
}
