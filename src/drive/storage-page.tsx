// What takes the reader's space: how much they use, and their largest
// files, largest first, as Google Drive's storage page shows, so they can
// find what to delete. Older versions and the trash count too, so the page
// says so and links to the trash.

import { useEffect, useState } from "preact/hooks";

import { api } from "../api.ts";
import { formatSize, t } from "../i18n.ts";
import { PageTitle } from "../shell/page.tsx";
import { followLink } from "../shell/router.ts";
import { FoundList, useFound } from "./home-page.tsx";
import { PageTools } from "./item-list.tsx";
import { useTarget, type Usage } from "./layout.tsx";
import { useChanges } from "./store.ts";

export function StoragePage() {
  const { items, error } = useFound("/api/drive/largest");
  const [usage, setUsage] = useState<Usage | null>(null);
  const load = () => {
    api<Usage>("GET", "/api/drive/usage").then(setUsage, () => undefined);
  };
  useEffect(load, []);
  useChanges(load);
  useTarget(null, false);

  const used = usage ? formatSize(usage.used) : "";
  return (
    <main class="page">
      <div class="page-head">
        <PageTitle>{t("storage.title")}</PageTitle>
        <PageTools />
      </div>
      {usage && (
        <div class="storage-summary">
          <p>
            {usage.quota === null
              ? t("drive.storageUsedNoLimit", { used })
              : t("drive.storageUsed", { used, quota: formatSize(usage.quota) })}
          </p>
          {usage.quota !== null && <progress max={usage.quota} value={Math.min(usage.used, usage.quota)} />}
          <p class="hint">
            {t("storage.counts")}{" "}
            <a href="/drive/trash" onClick={followLink}>
              {t("storage.trash")}
            </a>
          </p>
        </div>
      )}
      <h2 class="list-title">{t("storage.largest")}</h2>
      <FoundList
        items={items}
        error={error}
        label={t("storage.largest")}
        empty={t("storage.empty")}
        sortScope="storage"
      />
    </main>
  );
}
