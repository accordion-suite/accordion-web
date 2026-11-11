// A folder in Drive, with the path down to it from My Drive, or from Shared
// with me for someone else's folder. Right-clicking empty space opens New's
// menu for the folder, and files dropped on the page upload into it, unless
// the reader can only view it. The folders in the path work as they do in
// the sidebar: right-clicking one opens its menu, and items dragged onto
// one move into it.

import type { TargetedKeyboardEvent, TargetedMouseEvent } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

import { api } from "../api.ts";
import { t } from "../i18n.ts";
import { Menu, type MenuPlace } from "../shell/menu.tsx";
import { PageTitle } from "../shell/page.tsx";
import { followLink, navigate } from "../shell/router.ts";
import { folderPath } from "./item-actions.tsx";
import { ItemList, PageTools } from "./item-list.tsx";
import { type Item, canEdit } from "./item.ts";
import { typing, useDrive, useTarget } from "./layout.tsx";
import { dropProps } from "./move.ts";
import { focusNextList, pathTo, remember, useChanges } from "./store.ts";

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
  const [dropOn, setDropOn] = useState<string | null>(null);
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

  /** The open folder's name at the end of the path, which has its menu. */
  const crumb = useRef<HTMLDivElement>(null);

  // Alt+Up goes to the folder this one is in, as in a file manager.
  // Alt+Shift+A goes to the folder's name at the end of the path, where
  // Enter opens its menu, for Google Drive's current folder actions. Alt is
  // Option on a Mac, which changes the letter a key types, so A goes by the
  // key's place.
  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey) return;
      if (!loaded || typing(event.target) || document.querySelector("dialog[open]")) return;
      if (event.shiftKey && event.code === "KeyA") {
        event.preventDefault();
        crumb.current?.focus();
        return;
      }
      if (event.shiftKey || event.key !== "ArrowUp") return;
      const parent = loaded.path[loaded.path.length - 2];
      const up = parent ? folderPath(parent) : loaded.path[0]!.parent !== null ? "/drive/shared" : null;
      if (!up) return;
      event.preventDefault();
      focusNextList();
      navigate(up);
    };
    document.addEventListener("keydown", keys);
    return () => document.removeEventListener("keydown", keys);
  }, [loaded]);

  /** Keys in the path: left and right go from folder to folder, Enter opens
   * one, or the open folder's menu on its name, and down goes to the
   * list. */
  function pathKeys(event: TargetedKeyboardEvent<HTMLElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const at = (event.target as Element).closest<HTMLElement>("li > a, li > div.crumb");
    if (!at) return;
    const all = [...event.currentTarget.querySelectorAll<HTMLElement>("li > a, li > div.crumb")];
    const index = all.indexOf(at);
    let next: HTMLElement | null | undefined;
    if (event.key === "ArrowLeft") next = all[index - 1];
    else if (event.key === "ArrowRight") next = all[index + 1];
    else if (event.key === "Home") next = all[0];
    else if (event.key === "End") next = all[all.length - 1];
    else if (event.key === "ArrowDown") {
      const list = document.querySelector(".item-list");
      next = list?.querySelector<HTMLElement>(".selected [data-open]") ?? list?.querySelector<HTMLElement>("[data-open]");
    } else if (event.key === "Enter" && at === crumb.current) {
      // With no position, the menu opens under the name, as it does for the
      // context menu key.
      event.preventDefault();
      at.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      return;
    } else if (event.key === "Enter") {
      // The link opens the folder, and its first item takes the focus.
      focusNextList();
      return;
    } else return;
    event.preventDefault();
    next?.focus();
  }

  /** Right-clicking empty space, or the context menu key there. */
  function contextMenu(event: TargetedMouseEvent<HTMLElement>) {
    const target = event.target as Element;
    // A folder in the path opens its own menu.
    if (event.defaultPrevented || !here || !editable || typing(target) || target.closest("dialog, a, button")) {
      return;
    }
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
  const crumbClass = (item: Item) =>
    ["crumb", dropOn === item.id && "drop-target", drive.menuOn === item.id && "menu-open"].filter(Boolean).join(" ");
  const shared = loaded.path[0]!.parent !== null;
  return (
    <main class="page" onContextMenu={contextMenu}>
      <div class="page-head">
        <nav class="crumbs" aria-label={t("drive.path")} onKeyDown={pathKeys}>
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
                <a
                  class={crumbClass(item)}
                  href={folderPath(item)}
                  onClick={followLink}
                  onContextMenu={(event) => drive.folderMenu(item, event)}
                  {...(canEdit(item) ? dropProps({ id: item.id, name: folderName(item) }, setDropOn, drive.notify) : {})}
                >
                  {folderName(item)}
                </a>
              </li>
            ))}
            <li>
              {/* Nothing on this page can be dragged into the folder that's
                  open, so it only has the menu. */}
              <div
                class={crumbClass(here)}
                ref={crumb}
                // Alt+Shift+A moves the focus here, and Enter opens the menu.
                tabIndex={-1}
                aria-haspopup="menu"
                onContextMenu={(event) => drive.folderMenu(here, event)}
              >
                <PageTitle>{folderName(here)}</PageTitle>
              </div>
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
