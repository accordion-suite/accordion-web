// A folder in Drive, with the path down to it from My Drive, or from Shared
// with me for someone else's folder. Right-clicking empty space opens New's
// menu for the folder, and files dropped on the page upload into it, unless
// the reader can only view it.

import type { TargetedMouseEvent } from "preact";
import { useEffect, useState } from "preact/hooks";

import { api } from "../api.ts";
import { t } from "../i18n.ts";
import { Menu, type MenuPlace } from "../shell/menu.tsx";
import { PageTitle } from "../shell/page.tsx";
import { followLink } from "../shell/router.ts";
import { folderPath } from "./item-actions.tsx";
import { ItemList, PageTools } from "./item-list.tsx";
import { type Item, canEdit } from "./item.ts";
import { typing, useDrive, useTarget } from "./layout.tsx";
import { pathTo, remember, useChanges } from "./store.ts";

interface Loaded {
  path: Item[];
  children: Item[];
}

/** What's in a folder: folders first, then by name in the reader's
 * language. */
export function sortChildren(children: Item[]): Item[] {
  const collator = new Intl.Collator(undefined, { numeric: true });
  return children.sort(
    (a, b) => Number(b.kind === "folder") - Number(a.kind === "folder") || collator.compare(a.name, b.name),
  );
}

async function load(id: string | null): Promise<Loaded> {
  const folder = await api<Item>("GET", id === null ? "/api/drive/top" : `/api/drive/items/${id}`);
  const [path, children] = await Promise.all([
    pathTo(folder),
    api<Item[]>("GET", `/api/drive/items/${folder.id}/children`),
  ]);
  remember(children);
  return { path, children: sortChildren(children) };
}

/** A folder's name, or "My Drive" for the top folder. */
export function folderName(folder: Item): string {
  return folder.parent === null ? t("drive.myDrive") : folder.name;
}

/** `folder` is null for My Drive. */
export function FolderPage({ folder }: { folder: string | null }) {
  const drive = useDrive();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState("");
  const [menu, setMenu] = useState<{ place: MenuPlace; byKeyboard: boolean } | null>(null);
  const here = loaded?.path[loaded.path.length - 1] ?? null;

  function refresh() {
    load(folder).then(setLoaded, (problem: Error) =>
      loaded ? drive.notify({ message: problem.message, problem: true }) : setError(problem.message),
    );
  }

  useEffect(refresh, [folder]);
  useChanges(refresh, { folder: here?.id });
  // With nothing selected, the details panel shows the folder.
  useEffect(() => {
    drive.setPageItem(here);
    return () => drive.setPageItem(null);
  }, [here]);
  const editable = here !== null && canEdit(here);
  // New in a folder the reader can only view goes to My Drive.
  useTarget(editable ? here : null, editable, loaded?.path.map((item) => item.id) ?? []);

  /** Right-clicking empty space, or the context menu key there. */
  function contextMenu(event: TargetedMouseEvent<HTMLElement>) {
    const target = event.target as Element;
    if (!here || !editable || typing(target) || target.closest("dialog, a, button")) return;
    event.preventDefault();
    const byKeyboard = !event.clientX && !event.clientY;
    setMenu({ place: byKeyboard ? { under: target } : { x: event.clientX, y: event.clientY }, byKeyboard });
  }

  if (error) {
    return (
      <main class="page">
        <PageTitle>{t("drive.myDrive")}</PageTitle>
        <p class="error" role="alert">
          {error}
        </p>
      </main>
    );
  }
  if (!loaded || !here) {
    return (
      <main class="page">
        <p class="loading">{t("shell.loading")}</p>
      </main>
    );
  }

  const above = loaded.path.slice(0, -1);
  const shared = loaded.path[0]!.parent !== null;
  return (
    <main class="page" onContextMenu={contextMenu}>
      <div class="page-head">
        <nav class="crumbs" aria-label={t("drive.path")}>
          <ol>
            {shared && (
              <li>
                <a href="/drive/shared" onClick={followLink}>
                  {t("shared.title")}
                </a>
              </li>
            )}
            {above.map((item) => (
              <li key={item.id}>
                <a href={folderPath(item)} onClick={followLink}>
                  {folderName(item)}
                </a>
              </li>
            ))}
            <li>
              <PageTitle>{folderName(here)}</PageTitle>
            </li>
          </ol>
        </nav>
        <PageTools />
      </div>
      {loaded.children.length === 0 ? (
        <div class="empty">
          <p class="empty-title">{t("drive.emptyTitle")}</p>
          {editable && <p class="hint">{t("drive.emptyHint")}</p>}
        </div>
      ) : (
        <ItemList items={loaded.children} label={folderName(here)} />
      )}
      {menu && (
        <Menu
          label={t("drive.newIn", { folder: folderName(here) })}
          entries={drive.newEntries()}
          place={menu.place}
          byKeyboard={menu.byKeyboard}
          onClose={() => setMenu(null)}
        />
      )}
    </main>
  );
}
