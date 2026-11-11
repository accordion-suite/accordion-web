// Drive's trash: what the reader deleted, newest first, to restore or to
// delete for good. Accordion deletes what's been in the trash for 30 days.
// It's the same list as every other page, with the same filters, details,
// and list or grid, but its items can only be opened, restored, or deleted.

import { useEffect, useState } from "preact/hooks";

import { api } from "../api.ts";
import { t } from "../i18n.ts";
import { ConfirmDialog } from "../shell/dialog.tsx";
import { PageTitle } from "../shell/page.tsx";
import type { Item } from "./item.ts";
import { ItemList, PageTools } from "./item-list.tsx";
import { useDrive, useTarget } from "./layout.tsx";
import { naming } from "./move.ts";
import { keptFor, useRetention } from "./retention.ts";
import { announceChange, useChanges } from "./store.ts";

type Confirming = { kind: "items"; items: Item[] } | { kind: "all" };

export function TrashPage() {
  const [items, setItems] = useState<Item[] | null>(null);
  const drive = useDrive();
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState<Confirming | null>(null);
  const retention = useRetention();
  useTarget(null, false);

  function refresh() {
    api<Item[]>("GET", "/api/drive/trash").then(
      (found) => {
        setItems(found);
        setError("");
      },
      (failure: Error) =>
        items ? drive.notify({ message: failure.message, problem: true }) : setError(failure.message),
    );
  }

  useEffect(refresh, []);
  // Items deleted on other pages, or in another tab, show up here.
  useChanges(refresh);

  function done(message: string) {
    drive.notify({ message });
    // Restoring and deleting change the space used, and the sidebar's
    // folders, and this list reloads with them.
    announceChange();
  }

  function failed(failure: unknown) {
    drive.notify({ message: failure instanceof Error ? failure.message : t("error.problem"), problem: true });
    announceChange();
  }

  async function restore(chosen: Item[]) {
    try {
      for (const item of chosen) await api("POST", `/api/drive/items/${item.id}/restore`);
      done(naming(chosen, "trash.restored", "trash.restoredMany"));
    } catch (failure) {
      failed(failure);
    }
  }

  const only = confirming?.kind === "items" && confirming.items.length === 1 ? confirming.items[0]! : null;
  return (
    <main class="page">
      <div class="page-head">
        <PageTitle>{t("trash.title")}</PageTitle>
        <PageTools />
      </div>
      {/* How long the trash keeps things, beside the button that deletes
          them all now. */}
      {(retention || (items && items.length > 0)) && (
        <div class="banner action-banner">
          {retention && (
            <p>
              {retention === "unknown"
                ? t("trash.explainUnknown")
                : t("trash.explain", { time: keptFor(retention.trash_days) })}
            </p>
          )}
          {items && items.length > 0 && (
            <button type="button" class="secondary" onClick={() => setConfirming({ kind: "all" })}>
              {t("trash.emptyTrash")}
            </button>
          )}
        </div>
      )}
      {error ? (
        <p class="error" role="alert">
          {error}
        </p>
      ) : !items ? (
        <p class="loading">{t("shell.loading")}</p>
      ) : (
        <ItemList
          items={items}
          label={t("trash.title")}
          empty={t("trash.empty")}
          trash={{ restore, remove: (chosen) => setConfirming({ kind: "items", items: chosen }) }}
        />
      )}

      {confirming?.kind === "items" && (
        <ConfirmDialog
          title={
            only
              ? t("trash.deleteTitle", { name: only.name })
              : t("trash.deleteManyTitle", { count: confirming.items.length })
          }
          body={
            !only
              ? t("trash.deleteManyBody")
              : only.kind === "folder"
                ? t("trash.deleteFolderBody")
                : t("trash.deleteFileBody")
          }
          confirm={t("trash.delete")}
          onConfirm={async () => {
            const chosen = confirming.items;
            try {
              for (const item of chosen) await api("DELETE", `/api/drive/trash/${item.id}`);
              setConfirming(null);
              done(naming(chosen, "trash.deletedOne", "trash.deletedMany"));
            } catch (failure) {
              setConfirming(null);
              failed(failure);
            }
          }}
          onClose={() => setConfirming(null)}
        />
      )}
      {confirming?.kind === "all" && (
        <ConfirmDialog
          title={t("trash.emptyTitle")}
          body={t("trash.emptyBody", { count: items?.length ?? 0 })}
          confirm={t("trash.emptyTrash")}
          onConfirm={async () => {
            await api("DELETE", "/api/drive/trash");
            setConfirming(null);
            done(t("trash.emptied"));
          }}
          onClose={() => setConfirming(null)}
        />
      )}
    </main>
  );
}
