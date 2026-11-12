// What takes the reader's space: how much they use, of their limit, with
// a bar that shows each type of file, and their largest files, largest
// first, as Google Drive's storage page shows, so they can find what to
// delete.

import { useEffect, useState } from "preact/hooks";

import { api } from "../api.ts";
import { t } from "../i18n.ts";
import { PageTitle } from "../shell/page.tsx";
import { FoundList, useFound } from "./home-page.tsx";
import { PageTools } from "./item-list.tsx";
import { useTarget, type Usage } from "./layout.tsx";
import { StorageBar, TypeLegend, type TypeUsage, usedText } from "./storage-meter.tsx";
import { useChanges } from "./store.ts";

export function StoragePage() {
  const { items, error } = useFound("/api/drive/largest");
  const [usage, setUsage] = useState<Usage | null>(null);
  const [types, setTypes] = useState<TypeUsage[] | null>(null);
  const load = () => {
    api<Usage>("GET", "/api/drive/usage").then(setUsage, () => undefined);
    // Without the types, the bar shows only how much is used.
    api<TypeUsage[]>("GET", "/api/drive/usage/types").then(setTypes, () => undefined);
  };
  useEffect(load, []);
  useChanges(load);
  useTarget(null, false);

  return (
    <main class="page">
      <div class="page-head">
        <PageTitle>{t("storage.title")}</PageTitle>
        <PageTools />
      </div>
      {/* The page only lists files, so the grid's heading over them says
          what they are, as on Home. The summary goes under the filters. */}
      <FoundList
        items={items}
        error={error}
        label={t("storage.largest")}
        empty={t("storage.empty")}
        sortScope="storage"
        filesTitle={t("storage.largest")}
        summary={
          usage && (
            <section class="storage-summary" aria-label={t("storage.byType")}>
              <p class="storage-total">{usedText(usage.used, usage.quota)}</p>
              <StorageBar usage={usage} types={types ?? undefined} />
              {types && types.length > 0 && <TypeLegend usage={usage} types={types} />}
            </section>
          )
        }
      />
    </main>
  );
}
