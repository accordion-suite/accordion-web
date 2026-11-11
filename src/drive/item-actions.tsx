// What can be done to files and folders from their menus: opening,
// downloading, sharing, renaming, copying, moving, starring, and moving to
// the trash, with the dialogs some of them open. Each menu offers only what
// the reader may do with the item, so a viewer of someone else's folder sees
// no Rename.
//
// The item list and the sidebar's folders both use these, so an item's
// right-click menu is the same wherever it's shown.

import type { VNode } from "preact";
import { useState } from "preact/hooks";

import { ApiError, api } from "../api.ts";
import { t } from "../i18n.ts";
import { type MenuEntry, SEPARATOR } from "../shell/menu.tsx";
import { navigate } from "../shell/router.ts";
import { ConfirmDialog } from "../shell/dialog.tsx";
import { ColorDialog, MoveDialog, NameDialog, ShareDialog, VersionsDialog } from "./dialogs.tsx";
import { type Found, type Item, canEdit } from "./item.ts";
import type { Notice } from "./layout.tsx";
import { naming } from "./move.ts";
import { freeName } from "./names.ts";
import { announceChange } from "./store.ts";

/** A folder's page. My Drive has its own address. */
export function folderPath(item: Pick<Item, "id" | "parent">): string {
  return item.parent === null ? "/drive/my-drive" : `/drive/folder/${item.id}`;
}

/** The folder an item is in, from a list that says where items are.
 * Something shared with the reader on its own is in Shared with me. */
export function locationPath(item: Found): string {
  if (item.folders.length > 0) return `/drive/folder/${item.parent}`;
  return item.owner === null ? "/drive/my-drive" : "/drive/shared";
}

/** This page's address with `file` open in the viewer. */
export function filePath(file: Item): string {
  const query = new URLSearchParams(location.search);
  query.set("file", file.id);
  return `${location.pathname}?${query}`;
}

/** Marks a history entry that the viewer opened from the list, so closing
 * it can go back rather than add another entry. */
export const OPENED_HERE = { viewer: true };

/** Saves a file as it is, or a folder or several items as one ZIP file, as
 * Google Drive does. The server builds the ZIP as it sends it. */
export function download(items: readonly Item[]) {
  const link = document.createElement("a");
  const only = items.length === 1 ? items[0]! : null;
  if (only?.kind === "file") {
    link.href = `/api/drive/items/${only.id}/content`;
    link.download = only.name;
  } else {
    link.href = `/api/drive/zip?ids=${items.map((item) => item.id).join(",")}`;
  }
  link.click();
}

export function located(item: Item | Found): item is Found {
  return "folders" in item;
}

type Open =
  | { kind: "rename"; item: Item }
  | { kind: "move"; items: Item[] }
  | { kind: "versions"; item: Item }
  | { kind: "share"; item: Item }
  | { kind: "unshare"; item: Item }
  | { kind: "color"; item: Item };

export interface ItemActions {
  /** The menu for one item, or for several selected together. */
  entries(chosen: Item[]): MenuEntry[];
  trash(chosen: Item[]): Promise<void>;
  star(chosen: Item[], on: boolean): Promise<void>;
  rename(item: Item): void;
  move(items: Item[]): void;
  /** Opens the share dialog, for anyone but a viewer. */
  share(item: Item): void;
  /** Whether one of the actions' dialogs is open. */
  busy: boolean;
  /** The open dialog, if any, for the owner to show. */
  dialog: VNode | null;
}

export function useItemActions({
  notify,
  details,
  trashed,
}: {
  notify: (notice: Notice) => void;
  /** Shows the item in the details panel. */
  details: (item: Item) => void;
  /** Called after items go to the trash. */
  trashed?: (items: Item[]) => void;
}): ItemActions {
  const [open, setOpen] = useState<Open | null>(null);

  function done(message: string, undo?: () => Promise<void>) {
    notify({ message, undo });
    announceChange();
  }

  function failed(failure: unknown) {
    notify({ message: failure instanceof Error ? failure.message : t("error.problem"), problem: true });
    announceChange();
  }

  async function trash(chosen: Item[]) {
    try {
      for (const item of chosen) await api("DELETE", `/api/drive/items/${item.id}`);
      trashed?.(chosen);
      // Someone else's items go to their owner's trash, and only the owner
      // can restore them.
      if (chosen.some((item) => item.access !== "owner")) {
        done(naming(chosen, "drive.trashedSharedOne", "drive.trashedSharedMany"));
        return;
      }
      done(naming(chosen, "drive.trashedOne", "drive.trashedMany"), async () => {
        for (const item of chosen) await api("POST", `/api/drive/items/${item.id}/restore`);
        notify({ message: naming(chosen, "drive.restoredOne", "drive.restoredMany") });
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
   * with a number if that's taken. A file in a folder the reader can't add
   * to goes to My Drive, where the server picks the number. */
  async function copy(item: Item) {
    const name = t("drive.copyName", { name: item.name });
    const toMyDrive = async () => {
      const made = await api<Item>("POST", `/api/drive/items/${item.id}/copy`, { name });
      done(t("drive.copiedToMyDrive", { name: made.name }));
    };
    try {
      if (!canEdit(item)) return await toMyDrive();
      for (let tries = 0; ; tries++) {
        let siblings: Item[];
        try {
          siblings = await api<Item[]>("GET", `/api/drive/items/${item.parent}/children`);
        } catch (problem) {
          // Shared on its own, so the folder it's in isn't the reader's.
          if (problem instanceof ApiError && problem.status === 404) return await toMyDrive();
          throw problem;
        }
        const free = freeName(name, new Set(siblings.map((child) => child.name)));
        try {
          await api("POST", `/api/drive/items/${item.id}/copy`, { name: free });
          done(t("drive.copied", { name: free }));
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

  function entries(chosen: Item[]): MenuEntry[] {
    const starring = chosen.some((item) => !item.starred);
    const starEntry: MenuEntry = {
      label: starring ? t("drive.addStar") : t("drive.removeStar"),
      onSelect: () => star(chosen, starring),
    };
    const editable = chosen.every(canEdit);
    if (chosen.length > 1) {
      const entries: MenuEntry[] = [];
      if (editable) {
        entries.push({
          label: t("drive.moveMany", { count: chosen.length }),
          onSelect: () => setOpen({ kind: "move", items: chosen }),
        });
      }
      entries.push({ label: t("viewer.download"), onSelect: () => download(chosen) }, starEntry);
      if (editable) {
        entries.push(SEPARATOR, {
          label: t("drive.trashMany", { count: chosen.length }),
          shortcut: "Delete",
          onSelect: () => trash(chosen),
        });
      }
      return entries;
    }
    const item = chosen[0]!;
    const entries: MenuEntry[] = [];
    if (item.kind === "folder") {
      entries.push(
        { label: t("drive.open"), onSelect: () => navigate(folderPath(item)) },
        { label: t("viewer.download"), onSelect: () => download(chosen) },
      );
    } else {
      entries.push(
        { label: t("drive.open"), onSelect: () => navigate(filePath(item), { state: OPENED_HERE }) },
        { label: t("viewer.download"), onSelect: () => download(chosen) },
      );
      // Viewers see only the current version, as in Google Drive.
      if (editable) {
        entries.push({ label: t("drive.manageVersions"), onSelect: () => setOpen({ kind: "versions", item }) });
      }
    }
    entries.push({ label: t("details.title"), onSelect: () => details(item) });
    entries.push(SEPARATOR);
    // Editors share by link. Only the owner shares with people.
    if (item.access !== "viewer") entries.push({ label: t("share.open"), onSelect: () => setOpen({ kind: "share", item }) });
    if (item.access === "owner" && item.shared) {
      entries.push({ label: t("sharedByMe.stop"), onSelect: () => setOpen({ kind: "unshare", item }) });
    }
    if (item.kind === "folder") entries.push({ label: t("color.open"), onSelect: () => setOpen({ kind: "color", item }) });
    if (editable) {
      entries.push({ label: t("drive.rename"), shortcut: "F2", onSelect: () => setOpen({ kind: "rename", item }) });
    }
    if (item.kind === "file") entries.push({ label: t("drive.makeCopy"), onSelect: () => copy(item) });
    if (editable) entries.push({ label: t("drive.move"), onSelect: () => setOpen({ kind: "move", items: chosen }) });
    entries.push(starEntry);
    if (located(item)) {
      entries.push({ label: t("drive.showLocation"), onSelect: () => navigate(locationPath(item)) });
    }
    if (editable) {
      entries.push(SEPARATOR, { label: t("drive.toTrash"), shortcut: "Delete", onSelect: () => trash(chosen) });
    }
    return entries;
  }

  const close = () => setOpen(null);
  let dialog: VNode | null = null;
  if (open?.kind === "rename") {
    dialog = (
      <NameDialog
        title={t("drive.renameNamed", { name: open.item.name })}
        submit={t("drive.rename")}
        initial={open.item.name}
        file={open.item.kind === "file"}
        onSubmit={async (name) => {
          const { id, name: before } = open.item;
          await api("PATCH", `/api/drive/items/${id}`, { name });
          setOpen(null);
          done(t("drive.renamed", { name }), async () => {
            await api("PATCH", `/api/drive/items/${id}`, { name: before });
          });
        }}
        onClose={close}
      />
    );
  } else if (open?.kind === "move") {
    dialog = (
      <MoveDialog
        items={open.items}
        onMoved={(to, id) => {
          setOpen(null);
          // Each goes back to the folder it came from.
          const moved = open.items.filter((item) => item.parent !== id);
          done(naming(open.items, "drive.movedOne", "drive.movedMany", to), async () => {
            for (const item of moved) await api("PATCH", `/api/drive/items/${item.id}`, { parent: item.parent });
          });
        }}
        onClose={close}
      />
    );
  } else if (open?.kind === "share") {
    dialog = (
      <ShareDialog
        item={open.item}
        onClose={(changed) => {
          setOpen(null);
          if (changed) announceChange();
        }}
      />
    );
  } else if (open?.kind === "unshare") {
    dialog = (
      <ConfirmDialog
        title={t("sharedByMe.stopTitle", { name: open.item.name })}
        body={t("sharedByMe.stopBody")}
        confirm={t("sharedByMe.stop")}
        onConfirm={async () => {
          await api("DELETE", `/api/drive/items/${open.item.id}/shares`);
          setOpen(null);
          done(t("sharedByMe.stopped", { name: open.item.name }));
        }}
        onClose={close}
      />
    );
  } else if (open?.kind === "color") {
    dialog = (
      <ColorDialog
        item={open.item}
        onChosen={() => {
          setOpen(null);
          announceChange();
        }}
        onClose={close}
      />
    );
  } else if (open?.kind === "versions") {
    dialog = (
      <VersionsDialog
        item={open.item}
        onRestored={(number) => {
          setOpen(null);
          done(t("drive.restoredVersion", { number, name: open.item.name }));
        }}
        onClose={close}
      />
    );
  }

  return {
    entries,
    trash,
    star,
    rename: (item) => setOpen({ kind: "rename", item }),
    move: (items) => setOpen({ kind: "move", items }),
    share: (item) => setOpen({ kind: "share", item }),
    busy: open !== null,
    dialog,
  };
}
