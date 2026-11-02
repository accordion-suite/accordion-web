// What others shared with the reader, most recently shared first, with who
// owns each. Opening a shared folder shows what's inside it, as in Google
// Drive.

import { t } from "../i18n.ts";
import { PageTitle } from "../shell/page.tsx";
import { FoundList, useFound } from "./home-page.tsx";
import { PageTools } from "./item-list.tsx";
import { useTarget } from "./layout.tsx";

export function SharedPage() {
  const { items, error } = useFound("/api/drive/shared");
  useTarget(null, false);

  return (
    <main class="page">
      <div class="page-head">
        <PageTitle>{t("shared.title")}</PageTitle>
        <PageTools />
      </div>
      <FoundList items={items} error={error} label={t("shared.title")} empty={t("shared.empty")} owners />
    </main>
  );
}
