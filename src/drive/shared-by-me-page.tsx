// What the reader shared with other people, most recently shared first,
// with who has each and when it was shared, as Proton Drive's Shared lists
// it. A shared folder shows once, not everything inside it.

import { t } from "../i18n.ts";
import { PageTitle } from "../shell/page.tsx";
import { FoundList, useFound } from "./home-page.tsx";
import type { SharedOut } from "./item.ts";
import { PageTools } from "./item-list.tsx";
import { useTarget } from "./layout.tsx";

export function SharedByMePage() {
  const { items, error } = useFound<SharedOut>("/api/drive/shared-by-me");
  useTarget(null, false);

  return (
    <main class="page">
      <div class="page-head">
        <PageTitle>{t("sharedByMe.title")}</PageTitle>
        <PageTools />
      </div>
      <FoundList
        items={items}
        error={error}
        label={t("sharedByMe.title")}
        empty={t("sharedByMe.empty")}
        shares
        sortScope="shared-by-me"
      />
    </main>
  );
}
