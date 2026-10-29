// Drive's trash: what the reader deleted, newest first, to restore or to
// delete for good. Accordion deletes what's been in the trash for 30 days.

import { useEffect, useState } from "preact/hooks";

import { api } from "../api.ts";
import { formatDate, formatSize, t } from "../i18n.ts";
import { PageTitle } from "../shell/page.tsx";
import { followLink } from "../shell/router.ts";
import { ConfirmDialog } from "./dialogs.tsx";
import type { Item } from "./item.ts";

/** An item in the trash, which says when it was deleted. */
interface Trashed extends Item {
  trashed_at: string;
}

type Confirming = { kind: "one"; item: Trashed } | { kind: "all" };

export function TrashPage() {
  const [items, setItems] = useState<Trashed[] | null>(null);
  const [error, setError] = useState("");
  const [problem, setProblem] = useState("");
  const [done, setDone] = useState("");
  const [confirming, setConfirming] = useState<Confirming | null>(null);

  function refresh() {
    api<Trashed[]>("GET", "/api/drive/trash").then(setItems, (failure: Error) => setError(failure.message));
  }

  useEffect(refresh, []);

  async function restore(item: Trashed) {
    setProblem("");
    setDone("");
    try {
      await api("POST", `/api/drive/items/${item.id}/restore`);
      setDone(t("trash.restored", { name: item.name }));
      refresh();
    } catch (failure) {
      setProblem((failure as Error).message);
    }
  }

  return (
    <main>
      <p>
        <a href="/drive/" onClick={followLink}>
          {t("drive.up", { name: t("drive.title") })}
        </a>
      </p>
      <PageTitle>{t("trash.title")}</PageTitle>
      <p class="hint">{t("trash.explain")}</p>
      {error ? (
        <p class="error" role="alert">
          {error}
        </p>
      ) : !items ? (
        <p class="loading">{t("shell.loading")}</p>
      ) : (
        <>
          <p class="error" role="alert">
            {problem}
          </p>
          <p class="done" role="status">
            {done}
          </p>
          {items.length === 0 ? (
            <p>{t("trash.empty")}</p>
          ) : (
            <>
              <div class="toolbar">
                <button type="button" class="secondary" onClick={() => setConfirming({ kind: "all" })}>
                  {t("trash.emptyTrash")}
                </button>
              </div>
              <table class="items trash">
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
                      <th scope="row">{item.name}</th>
                      <td class="modified">{formatDate(item.trashed_at)}</td>
                      <td class="size">
                        {item.kind === "folder" ? t("drive.folder") : formatSize(item.size ?? 0)}
                      </td>
                      <td class="actions">
                        <button
                          type="button"
                          class="secondary"
                          aria-label={t("trash.restoreNamed", { name: item.name })}
                          onClick={() => restore(item)}
                        >
                          {t("trash.restore")}
                        </button>
                        <button
                          type="button"
                          class="secondary"
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
            setDone(t("trash.deletedOne", { name: confirming.item.name }));
            refresh();
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
            setDone(t("trash.emptied"));
            refresh();
          }}
          onClose={() => setConfirming(null)}
        />
      )}
    </main>
  );
}
