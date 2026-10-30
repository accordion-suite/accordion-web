// Drive's trash: what the reader deleted, newest first, to restore or to
// delete for good. Accordion deletes what's been in the trash for 30 days.

import { useEffect, useState } from "preact/hooks";

import { api } from "../api.ts";
import { formatDate, formatSize, t } from "../i18n.ts";
import { PageTitle } from "../shell/page.tsx";
import { ConfirmDialog } from "./dialogs.tsx";
import { ItemIcon } from "./icons.tsx";
import type { Item } from "./item.ts";
import { useDrive, useTarget } from "./layout.tsx";
import { announceChange } from "./store.ts";

/** An item in the trash, which says when it was deleted. */
interface Trashed extends Item {
  trashed_at: string;
}

type Confirming = { kind: "one"; item: Trashed } | { kind: "all" };

export function TrashPage() {
  const [items, setItems] = useState<Trashed[] | null>(null);
  const drive = useDrive();
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState<Confirming | null>(null);
  useTarget(null, false);

  function refresh() {
    api<Trashed[]>("GET", "/api/drive/trash").then(setItems, (failure: Error) => setError(failure.message));
  }

  useEffect(refresh, []);

  function done(message: string) {
    drive.notify({ message });
    refresh();
    // Restoring and deleting change the space used, and the sidebar's
    // folders.
    announceChange();
  }

  async function restore(item: Trashed) {
    try {
      await api("POST", `/api/drive/items/${item.id}/restore`);
      done(t("trash.restored", { name: item.name }));
    } catch (failure) {
      drive.notify({ message: (failure as Error).message, problem: true });
    }
  }

  return (
    <main class="page">
      <div class="page-head">
        <PageTitle>{t("trash.title")}</PageTitle>
        {items && items.length > 0 && (
          <button type="button" class="quiet" onClick={() => setConfirming({ kind: "all" })}>
            {t("trash.emptyTrash")}
          </button>
        )}
      </div>
      <p class="banner">{t("trash.explain")}</p>
      {error ? (
        <p class="error" role="alert">
          {error}
        </p>
      ) : !items ? (
        <p class="loading">{t("shell.loading")}</p>
      ) : (
        <>
          {items.length === 0 ? (
            <div class="empty">
              <p class="hint">{t("trash.empty")}</p>
            </div>
          ) : (
            <>
              <table class="items trash" aria-label={t("trash.title")}>
                <thead>
                  <tr>
                    <th scope="col">{t("drive.name")}</th>
                    <th scope="col" class="modified">
                      {t("trash.deleted")}
                    </th>
                    <th scope="col" class="size">
                      {t("drive.size")}
                    </th>
                    <td />
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id}>
                      <th scope="row">
                        <span class="name-cell">
                          <ItemIcon item={item} />
                          <span class="item-name">{item.name}</span>
                        </span>
                      </th>
                      <td class="modified">{formatDate(item.trashed_at)}</td>
                      <td class="size">
                        {item.kind === "folder" ? "—" : formatSize(item.size ?? 0)}
                      </td>
                      <td class="actions">
                        <button
                          type="button"
                          class="quiet"
                          aria-label={t("trash.restoreNamed", { name: item.name })}
                          onClick={() => restore(item)}
                        >
                          {t("trash.restore")}
                        </button>
                        <button
                          type="button"
                          class="quiet"
                          aria-label={t("trash.deleteNamed", { name: item.name })}
                          onClick={() => setConfirming({ kind: "one", item })}
                        >
                          {t("trash.delete")}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </>
      )}

      {confirming?.kind === "one" && (
        <ConfirmDialog
          title={t("trash.deleteTitle", { name: confirming.item.name })}
          body={
            confirming.item.kind === "folder" ? t("trash.deleteFolderBody") : t("trash.deleteFileBody")
          }
          confirm={t("trash.delete")}
          onConfirm={async () => {
            await api("DELETE", `/api/drive/trash/${confirming.item.id}`);
            setConfirming(null);
            done(t("trash.deletedOne", { name: confirming.item.name }));
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
