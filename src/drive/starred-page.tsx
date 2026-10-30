// What the reader starred, most recently starred first, wherever it is.

import { t } from "../i18n.ts";
import { PageTitle } from "../shell/page.tsx";
import { FoundList, useFound } from "./home-page.tsx";
import { ViewToggle } from "./item-list.tsx";
import { useTarget } from "./layout.tsx";

export function StarredPage() {
  const { items, error } = useFound("/api/drive/starred");
  useTarget(null, false);

  return (
    <main class="page">
      <div class="page-head">
        <PageTitle>{t("starred.title")}</PageTitle>
        <ViewToggle />
      </div>
      <FoundList items={items} error={error} label={t("starred.title")} empty={t("starred.empty")} />
    </main>
  );
}
