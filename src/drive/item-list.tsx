// A list of files and folders, as rows or as a grid, and what can be done to
// them: opening, downloading, renaming, copying, moving, starring, and moving
// to the trash. Those are in each item's ⋮ menu and its right-click menu,
// and on keys for what's selected. Photos and PDFs open in the viewer, over
// the list, with the list's other photos and PDFs a step away.
//
// Every page with items uses this, so they all work the same. A list that
// reaches across folders, such as search results, says where each item is.

import type { TargetedMouseEvent } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

import { ApiError, api } from "../api.ts";
import { formatDate, formatSize, t } from "../i18n.ts";
import { Menu, type MenuEntry, type MenuPlace, SEPARATOR } from "../shell/menu.tsx";
import { followLink, navigate, useQuery } from "../shell/router.ts";
import { MoveDialog, NameDialog } from "./dialogs.tsx";
import { CloseIcon, GridIcon, ItemIcon, ListIcon, MoreIcon, StarIcon } from "./icons.tsx";
import type { Found, Item } from "./item.ts";
import { typing, useDrive } from "./layout.tsx";
import { freeName } from "./names.ts";
import { announceChange, useViewMode } from "./store.ts";
import { Viewer } from "./viewer.tsx";

/** A folder's page. My Drive has its own address. */
export function folderPath(item: Pick<Item, "id" | "parent">): string {
  return item.parent === null ? "/drive/my-drive" : `/drive/folder/${item.id}`;
}

/** The folder an item is in, from a list that says where items are. */
function locationPath(item: Found): string {
  return item.folders.length === 0 ? "/drive/my-drive" : `/drive/folder/${item.parent}`;
}

/** This page's address with `file` open in the viewer. */
function filePath(file: Item): string {
  const query = new URLSearchParams(location.search);
  query.set("file", file.id);
  return `${location.pathname}?${query}`;
}

/** Marks a history entry that the viewer opened from the list, so closing
 * it can go back rather than add another entry. */
const OPENED_HERE = { viewer: true };

/** Saves a file, as its download link would. */
function download(item: Item) {
  const link = document.createElement("a");
  link.href = `/api/drive/items/${item.id}/content`;
  link.download = item.name;
  link.click();
}

function located(item: Item | Found): item is Found {
  return "folders" in item;
}

/** "Photo.jpg" for one item, or "3 items" for more. */
function naming(items: readonly Item[], one: Parameters<typeof t>[0], many: Parameters<typeof t>[0], to = "") {
  return items.length === 1
    ? t(one, { name: items[0]!.name, folder: to })
    : t(many, { count: items.length, folder: to });
}

/** Whether a key, rather than the pointer, pressed a button. A click from
 * Enter or Space counts no presses. */
function keyed(event: MouseEvent): boolean {
  return event.detail === 0;
}

/** An open menu. `owner` names the button that opened it, if one did. */
interface OpenMenu {
  label: string;
  entries: MenuEntry[];
  place: MenuPlace;
  byKeyboard: boolean;
  owner?: string;
}

type Open = { kind: "rename"; item: Item } | { kind: "move"; items: Item[] };

export function ItemList({
  items,
  label,
  location: showLocation = false,
}: {
  items: readonly (Item | Found)[];
  /** Names the list for screen readers, such as the folder's name. */
  label: string;
  /** Whether to show where each item is. */
  location?: boolean;
}) {
  const drive = useDrive();
  const [mode] = useViewMode();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const [open, setOpen] = useState<Open | null>(null);
  const showing = useQuery("file");
  // The shortcuts need what's shown now, so the list sets them each time.
  const shortcuts = useRef<((event: KeyboardEvent) => void) | null>(null);

  useEffect(() => {
    const keys = (event: KeyboardEvent) => shortcuts.current?.(event);
    document.addEventListener("keydown", keys);
    return () => document.removeEventListener("keydown", keys);
  }, []);

  // Drops what's no longer here, such as a file moved elsewhere.
  useEffect(() => {
    const here = new Set(items.map((item) => item.id));
    setSelected((before) => new Set([...before].filter((id) => here.has(id))));
  }, [items]);

  const chosenItems = items.filter((item) => selected.has(item.id));
  const shown = items.filter((item) => item.preview !== null);
  const shownFile = shown.find((file) => file.id === showing);

  function openFile(event: MouseEvent, file: Item) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(filePath(file), { state: OPENED_HERE });
  }

  function closeFile() {
    if ((history.state as typeof OPENED_HERE | null)?.viewer) {
      history.back();
    } else {
      // Opened from a link or a reload, so there's nothing to go back to.
      const query = new URLSearchParams(location.search);
      query.delete("file");
      const rest = query.toString();
      navigate(rest ? `${location.pathname}?${rest}` : location.pathname, { replace: true });
    }
  }

  function done(message: string, undo?: () => Promise<void>) {
    drive.notify({ message, undo });
    announceChange();
  }

  function failed(failure: unknown) {
    drive.notify({ message: failure instanceof Error ? failure.message : t("error.problem"), problem: true });
    announceChange();
  }

  async function trash(chosen: Item[]) {
    try {
      for (const item of chosen) await api("DELETE", `/api/drive/items/${item.id}`);
      done(naming(chosen, "drive.trashedOne", "drive.trashedMany"), async () => {
        for (const item of chosen) await api("POST", `/api/drive/items/${item.id}/restore`);
        drive.notify({ message: naming(chosen, "drive.restoredOne", "drive.restoredMany") });
      });
    } catch (failure) {
      failed(failure);
    }
  }

  async function star(chosen: Item[], on: boolean) {
    try {
      for (const item of chosen) await api(on ? "PUT" : "DELETE", `/api/drive/items/${item.id}/star`);
      done(
        on
          ? naming(chosen, "drive.starredOne", "drive.starredMany")
          : naming(chosen, "drive.unstarredOne", "drive.unstarredMany"),
      );
    } catch (failure) {
      failed(failure);
    }
  }

  /** Copies a file into its own folder as "Copy of …", as Google Drive does,
   * with a number if that's taken. */
  async function copy(item: Item) {
    try {
      for (let tries = 0; ; tries++) {
        const siblings = await api<Item[]>("GET", `/api/drive/items/${item.parent}/children`);
        const name = freeName(t("drive.copyName", { name: item.name }), new Set(siblings.map((child) => child.name)));
        try {
          await api("POST", `/api/drive/items/${item.id}/copy`, { name });
          done(t("drive.copied", { name }));
          return;
        } catch (problem) {
          // Something took the name since the folder was listed.
          if (!(problem instanceof ApiError) || problem.status !== 409 || tries > 2) throw problem;
        }
      }
    } catch (failure) {
      failed(failure);
    }
  }

  /** What an action on `item` applies to: everything selected, if it's
   * among them, or else just the item. */
  function targets(item: Item): Item[] {
    return selected.has(item.id) && chosenItems.length > 1 ? chosenItems : [item];
  }

  function itemEntries(chosen: Item[]): MenuEntry[] {
    const starring = chosen.some((item) => !item.starred);
    const starEntry: MenuEntry = {
      label: starring ? t("drive.addStar") : t("drive.removeStar"),
      onSelect: () => star(chosen, starring),
    };
    if (chosen.length > 1) {
      return [
        { label: t("drive.moveMany", { count: chosen.length }), onSelect: () => setOpen({ kind: "move", items: chosen }) },
        starEntry,
        SEPARATOR,
        { label: t("drive.trashMany", { count: chosen.length }), shortcut: "Delete", onSelect: () => trash(chosen) },
      ];
    }
    const item = chosen[0]!;
    const entries: MenuEntry[] = [];
    if (item.kind === "folder") {
      entries.push({ label: t("drive.open"), onSelect: () => navigate(folderPath(item)) });
    } else {
      if (item.preview) {
        entries.push({ label: t("drive.open"), onSelect: () => navigate(filePath(item), { state: OPENED_HERE }) });
      }
      entries.push({ label: t("viewer.download"), onSelect: () => download(item) });
    }
    entries.push(
      SEPARATOR,
      { label: t("drive.rename"), shortcut: "F2", onSelect: () => setOpen({ kind: "rename", item }) },
    );
    if (item.kind === "file") entries.push({ label: t("drive.makeCopy"), onSelect: () => copy(item) });
    entries.push({ label: t("drive.move"), onSelect: () => setOpen({ kind: "move", items: chosen }) }, starEntry);
    if (located(item)) {
      entries.push({ label: t("drive.showLocation"), onSelect: () => navigate(locationPath(item)) });
    }
    entries.push(SEPARATOR, { label: t("drive.toTrash"), shortcut: "Delete", onSelect: () => trash(chosen) });
    return entries;
  }

  function itemMenu(item: Item, place: MenuPlace, byKeyboard: boolean, owner?: string): OpenMenu {
    const chosen = targets(item);
    const label =
      chosen.length > 1 ? t("drive.actionsForMany", { count: chosen.length }) : t("drive.actionsFor", { name: item.name });
    return { label, entries: itemEntries(chosen), place, byKeyboard, owner };
  }

  /** Right-clicking an item, or the context menu key on one. Empty space is
   * left to the page. */
  function contextMenu(event: TargetedMouseEvent<HTMLElement>) {
    const target = event.target as Element;
    const holder = target.closest<HTMLElement>("[data-id]");
    const item = holder && items.find((child) => child.id === holder.dataset["id"]);
    if (!item || typing(target)) return;
    event.preventDefault();
    event.stopPropagation();
    // The context menu key may give no position, so the menu opens under
    // the item.
    const byKeyboard = !event.clientX && !event.clientY;
    const place: MenuPlace = byKeyboard ? { under: holder } : { x: event.clientX, y: event.clientY };
    setMenu(itemMenu(item, place, byKeyboard));
  }

  shortcuts.current = (event) => {
    if (open || menu || shownFile || typing(event.target)) return;
    if (event.target instanceof Element && event.target.closest("dialog")) return;
    const command = event.ctrlKey || event.metaKey;
    const focused = (document.activeElement as Element | null)?.closest<HTMLElement>("[data-id]");
    const focusedItem = focused && items.find((item) => item.id === focused.dataset["id"]);
    const chosen = chosenItems.length > 0 ? chosenItems : focusedItem ? [focusedItem] : [];
    if (event.key === "Delete" || (event.key === "Backspace" && event.metaKey)) {
      if (chosen.length === 0) return;
      void trash(chosen);
    } else if (event.key === "F2") {
      if (chosen.length !== 1) return;
      setOpen({ kind: "rename", item: chosen[0]! });
    } else if (command && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "a") {
      setSelected(new Set(items.map((item) => item.id)));
    } else if (event.key === "Escape" && selected.size > 0) {
      setSelected(new Set());
    } else {
      return;
    }
    event.preventDefault();
  };

  function toggle(id: string) {
    setSelected((before) => {
      const next = new Set(before);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(chosenItems.length === items.length ? new Set() : new Set(items.map((item) => item.id)));
  }

  /** The item's name, as a link that opens it. */
  function nameLink(item: Item, className?: string) {
    if (item.kind === "folder") {
      return (
        <a class={className} href={folderPath(item)} onClick={followLink}>
          {item.name}
        </a>
      );
    }
    if (item.preview) {
      return (
        <a class={className} href={filePath(item)} onClick={(event) => openFile(event, item)}>
          {item.name}
        </a>
      );
    }
    return (
      <a
        class={className}
        href={`/api/drive/items/${item.id}/content`}
        download={item.name}
        aria-label={t("drive.download", { name: item.name })}
      >
        {item.name}
      </a>
    );
  }

  function checkbox(item: Item, className?: string) {
    return (
      <input
        type="checkbox"
        class={className}
        aria-label={t("drive.select", { name: item.name })}
        checked={selected.has(item.id)}
        onChange={() => toggle(item.id)}
      />
    );
  }

  function moreButton(item: Item) {
    return (
      <button
        type="button"
        class="icon-button more"
        aria-label={t("drive.moreActions", { name: item.name })}
        aria-haspopup="menu"
        aria-expanded={menu?.owner === item.id}
        onClick={(event) => setMenu(itemMenu(item, { under: event.currentTarget }, keyed(event), item.id))}
      >
        <MoreIcon />
      </button>
    );
  }

  function starMark(item: Item) {
    return (
      item.starred && (
        <span class="star-mark" title={t("drive.starred")}>
          <StarIcon filled />
          <span class="visually-hidden">{t("drive.starred")}</span>
        </span>
      )
    );
  }

  function where(item: Item | Found) {
    if (!located(item)) return null;
    const path = [t("drive.myDrive"), ...item.folders];
    return (
      <a href={locationPath(item)} onClick={followLink} title={path.join(" › ")}>
        {path[path.length - 1]}
      </a>
    );
  }

  const folders = items.filter((item) => item.kind === "folder");
  const files = items.filter((item) => item.kind === "file");

  return (
    <div class="item-list" onContextMenu={contextMenu}>
      {chosenItems.length > 0 && (
        <div class="selection-bar" role="group" aria-label={t("drive.selection")}>
          <button
            type="button"
            class="icon-button"
            aria-label={t("drive.clearSelection")}
            onClick={() => setSelected(new Set())}
          >
            <CloseIcon />
          </button>
          <span class="selection-count">{t("drive.selected", { count: chosenItems.length })}</span>
          {chosenItems.length === 1 && (
            <button type="button" class="quiet" onClick={() => setOpen({ kind: "rename", item: chosenItems[0]! })}>
              {t("drive.rename")}
            </button>
          )}
          <button type="button" class="quiet" onClick={() => setOpen({ kind: "move", items: chosenItems })}>
            {t("drive.move")}
          </button>
          <button
            type="button"
            class="quiet"
            onClick={() => star(chosenItems, chosenItems.some((item) => !item.starred))}
          >
            {chosenItems.some((item) => !item.starred) ? t("drive.addStar") : t("drive.removeStar")}
          </button>
          <button type="button" class="quiet" onClick={() => trash(chosenItems)}>
            {t("drive.toTrash")}
          </button>
        </div>
      )}

      {mode === "list" ? (
        <table class="items" aria-label={label}>
          <thead>
            <tr>
              <td class="select">
                <input
                  type="checkbox"
                  aria-label={t("drive.selectAll")}
                  checked={chosenItems.length === items.length}
                  indeterminate={chosenItems.length > 0 && chosenItems.length < items.length}
                  onChange={toggleAll}
                />
              </td>
              <th scope="col">{t("drive.name")}</th>
              {showLocation && (
                <th scope="col" class="location">
                  {t("drive.location")}
                </th>
              )}
              <th scope="col" class="modified">
                {t("drive.modified")}
              </th>
              <th scope="col" class="size">
                {t("drive.size")}
              </th>
              <td class="more-cell" />
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} data-id={item.id} class={selected.has(item.id) ? "selected" : undefined}>
                <td class="select">{checkbox(item)}</td>
                <th scope="row">
                  <span class="name-cell">
                    <ItemIcon item={item} />
                    {nameLink(item, "item-name")}
                    {starMark(item)}
                  </span>
                </th>
                {showLocation && <td class="location">{where(item)}</td>}
                <td class="modified">{formatDate(item.modified_at)}</td>
                <td class="size">{item.kind === "folder" ? "—" : formatSize(item.size ?? 0)}</td>
                <td class="more-cell">{moreButton(item)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div class="grid-view" role="group" aria-label={label}>
          {folders.length > 0 && (
            <section>
              <h2 class="section-title">{t("drive.folders")}</h2>
              <ul class="tiles">
                {folders.map((item) => (
                  <li key={item.id} data-id={item.id} class={selected.has(item.id) ? "tile selected" : "tile"}>
                    {checkbox(item, "tile-check")}
                    <ItemIcon item={item} />
                    {nameLink(item, "tile-name")}
                    {starMark(item)}
                    {moreButton(item)}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {files.length > 0 && (
            <section>
              <h2 class="section-title">{t("drive.files")}</h2>
              <ul class="cards">
                {files.map((item) => (
                  <li key={item.id} data-id={item.id} class={selected.has(item.id) ? "card selected" : "card"}>
                    <div class="card-top">
                      {checkbox(item, "tile-check")}
                      <ItemIcon item={item} />
                      {nameLink(item, "tile-name")}
                      {starMark(item)}
                      {moreButton(item)}
                    </div>
                    {/* The tile's name link covers the card, so this only
                        shows what kind of file it is. Thumbnails are
                        planned. */}
                    <div class="card-preview" aria-hidden="true">
                      <ItemIcon item={item} />
                    </div>
                    <p class="card-meta">
                      {located(item) ? where(item) : formatDate(item.modified_at)}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      {menu && (
        <Menu
          label={menu.label}
          entries={menu.entries}
          place={menu.place}
          byKeyboard={menu.byKeyboard}
          onClose={() => setMenu(null)}
        />
      )}
      {open?.kind === "rename" && (
        <NameDialog
          title={t("drive.renameNamed", { name: open.item.name })}
          submit={t("drive.rename")}
          initial={open.item.name}
          file={open.item.kind === "file"}
          onSubmit={async (name) => {
            await api("PATCH", `/api/drive/items/${open.item.id}`, { name });
            setOpen(null);
            done(t("drive.renamed", { name }));
          }}
          onClose={() => setOpen(null)}
        />
      )}
      {open?.kind === "move" && (
        <MoveDialog
          items={open.items}
          onMoved={(to) => {
            setOpen(null);
            done(naming(open.items, "drive.movedOne", "drive.movedMany", to));
          }}
          onClose={() => setOpen(null)}
        />
      )}
      {shownFile && (
        <Viewer
          files={shown}
          file={shownFile}
          // Steps replace the entry, so Back closes the viewer.
          onShow={(file) => navigate(filePath(file), { replace: true, state: history.state })}
          onClose={closeFile}
        />
      )}
    </div>
  );
}

/** Switches every list between rows and a grid. */
export function ViewToggle() {
  const [mode, setMode] = useViewMode();
  return (
    <div class="view-toggle" role="group" aria-label={t("drive.layout")}>
      <button
        type="button"
        aria-pressed={mode === "list"}
        aria-label={t("drive.listView")}
        title={t("drive.listView")}
        onClick={() => setMode("list")}
      >
        <ListIcon />
      </button>
      <button
        type="button"
        aria-pressed={mode === "grid"}
        aria-label={t("drive.gridView")}
        title={t("drive.gridView")}
        onClick={() => setMode("grid")}
      >
        <GridIcon />
      </button>
    </div>
  );
}
