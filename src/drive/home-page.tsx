// Drive's home page: the reader's files, most recently changed first, from
// every folder, so what they're working on is a step away.

import { useEffect, useState } from "preact/hooks";

import { api } from "../api.ts";
import { t } from "../i18n.ts";
import { PageTitle } from "../shell/page.tsx";
import { ItemList, ViewToggle } from "./item-list.tsx";
import type { Found } from "./item.ts";
import { useDrive, useTarget } from "./layout.tsx";
import { useChanges } from "./store.ts";

/** A page that lists what an address of Drive's API returns, such as
 * recent or starred files. */
export function useFound(address: string): { items: Found[] | null; error: string } {
  const drive = useDrive();
  const [items, setItems] = useState<Found[] | null>(null);
  const [error, setError] = useState("");
  const refresh = () => {
    api<Found[]>("GET", address).then(
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
        <ViewToggle />
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
}: {
  items: Found[] | null;
  error: string;
  label: string;
  empty: string;
}) {
  if (error) {
    return (
      <p class="error" role="alert">
        {error}
      </p>
    );
  }
  if (!items) return <p class="loading">{t("shell.loading")}</p>;
  if (items.length === 0) {
    return (
      <div class="empty">
        <p class="hint">{empty}</p>
      </div>
    );
  }
  return <ItemList items={items} label={label} location />;
}
