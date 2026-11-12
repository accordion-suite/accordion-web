// Cut, copy, and paste for files and folders, as in a file manager: cut
// items move to the folder they're pasted in, and copied files are copied
// there. Folders can't be copied, as in Google Drive.
//
// What's cut or copied stays in this tab. Its names also go on the system
// clipboard, so a paste can tell whether something else was copied since,
// such as a screenshot, which uploads instead.

import { useEffect, useState } from "preact/hooks";

import { api } from "../api.ts";
import { t } from "../i18n.ts";
import type { Item } from "./item.ts";
import type { Notice } from "./layout.tsx";
import { naming } from "./move.ts";
import { freeName } from "./names.ts";
import { announceChange } from "./store.ts";

export interface Clipped {
  mode: "cut" | "copy";
  items: readonly Item[];
  /** The names put on the system clipboard, or null if the browser didn't
   * allow it, such as from a menu on a page that isn't secure. */
  text: string | null;
}

const CHANGED = "accordion:drive-clipboard";
let clipped: Clipped | null = null;

function set(next: Clipped | null): void {
  clipped = next;
  window.dispatchEvent(new Event(CHANGED));
}

/** What's cut or copied, updated as it changes, so cut items can look
 * faded. */
export function useClipped(): Clipped | null {
  const [now, setNow] = useState(clipped);
  useEffect(() => {
    const update = () => setNow(clipped);
    window.addEventListener(CHANGED, update);
    return () => window.removeEventListener(CHANGED, update);
  }, []);
  return now;
}

/** Whether anything is cut or copied, for menus to offer Paste. */
export function hasClipped(): boolean {
  return clipped !== null;
}

/** The items to cut or copy, or a problem to say why there are none:
 * someone else's items that the reader can only view can't be cut, and
 * folders can't be copied. */
export function clippable(mode: Clipped["mode"], chosen: readonly Item[]): Item[] | string {
  if (mode === "cut") {
    return chosen.every((item) => item.access !== "viewer" && !item.trashed_at) ? [...chosen] : t("drive.cantCut");
  }
  const files = chosen.filter((item) => item.kind === "file");
  return files.length > 0 ? files : t("drive.cantCopyFolders");
}

/** Keeps `items` to paste, with the names that went on the system
 * clipboard, and says so. */
export function clip(
  mode: Clipped["mode"],
  items: readonly Item[],
  text: string | null,
  chosen: readonly Item[],
  notify: (notice: Notice) => void,
): void {
  set({ mode, items, text });
  const message =
    mode === "cut"
      ? naming(items, "drive.cutOne", "drive.cutMany")
      : items.length < chosen.length
        ? t("drive.clippedNoFolders", { count: items.length })
        : naming(items, "drive.clippedOne", "drive.clippedMany");
  notify({ message });
}

/** The names that go on the system clipboard, one to a line. */
export function clipText(items: readonly Item[]): string {
  return items.map((item) => item.name).join("\n");
}

/** Cuts or copies from a menu, which has no clipboard event, so the names
 * go on the system clipboard if the browser allows it. */
export async function clipFromMenu(
  mode: Clipped["mode"],
  chosen: readonly Item[],
  notify: (notice: Notice) => void,
): Promise<void> {
  const items = clippable(mode, chosen);
  if (typeof items === "string") return notify({ message: items, problem: true });
  const text = clipText(items);
  let written: string | null = text;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    written = null;
  }
  clip(mode, items, written, chosen, notify);
}

/** Whether a paste is of what was cut or copied here. Files on the
 * clipboard, such as a screenshot, upload instead, and other text means
 * something else was copied since. */
export function pastingClipped(event: ClipboardEvent): boolean {
  if (!clipped || (event.clipboardData?.files.length ?? 0) > 0) return false;
  const text = event.clipboardData?.getData("text/plain") ?? "";
  return clipped.text === null || text === "" || text === clipped.text;
}

/** Pastes what's cut or copied into `folder`: cut items move there, and
 * copied files are copied there. A name that's taken gets a number, as an
 * upload's does. Cut items can be pasted once, and copies again and again. */
export async function pasteInto(folder: Item, folderName: string, notify: (notice: Notice) => void): Promise<void> {
  const now = clipped;
  if (!now) return;
  try {
    const siblings = await api<Item[]>("GET", `/api/drive/items/${folder.id}/children`);
    const taken = new Set(siblings.map((child) => child.name));
    if (now.mode === "cut") await move(now.items, folder, folderName, taken, notify);
    else await copy(now.items, folder, folderName, taken, notify);
  } catch (problem) {
    notify({ message: problem instanceof Error ? problem.message : t("error.problem"), problem: true });
  }
  announceChange();
}

async function move(
  items: readonly Item[],
  folder: Item,
  folderName: string,
  taken: Set<string>,
  notify: (notice: Notice) => void,
): Promise<void> {
  const moving = items.filter((item) => item.parent !== folder.id);
  if (moving.length === 0) {
    notify({ message: naming(items, "drive.alreadyThereOne", "drive.alreadyThereMany", folderName) });
    return;
  }
  /** What moved, and the name each has there. */
  const moved: { item: Item; name: string }[] = [];
  const undo = async () => {
    for (const { item } of moved) {
      await api("PATCH", `/api/drive/items/${item.id}`, { parent: item.parent, name: item.name });
    }
  };
  const redo = async () => {
    for (const { item, name } of moved) await api("PATCH", `/api/drive/items/${item.id}`, { parent: folder.id, name });
  };
  try {
    for (const item of moving) {
      const name = freeName(item.name, taken);
      taken.add(name);
      const change = name === item.name ? { parent: folder.id } : { parent: folder.id, name };
      await api("PATCH", `/api/drive/items/${item.id}`, change);
      moved.push({ item, name });
    }
  } catch (problem) {
    // What moved before the problem can still go back.
    const message = problem instanceof Error ? problem.message : t("error.problem");
    notify({ message, problem: true, undo: moved.length > 0 ? undo : undefined });
    return;
  }
  // Cut items move once, as in a file manager.
  set(null);
  notify({
    message: naming(
      moved.map(({ item }) => item),
      "drive.movedOne",
      "drive.movedMany",
      folderName,
    ),
    undo,
    redo,
  });
}

async function copy(
  files: readonly Item[],
  folder: Item,
  folderName: string,
  taken: Set<string>,
  notify: (notice: Notice) => void,
): Promise<void> {
  const made: Item[] = [];
  // Undoing a paste puts the copies in the trash, and redoing it takes
  // them out.
  const undo = async () => {
    for (const item of made) await api("DELETE", `/api/drive/items/${item.id}`);
  };
  const redo = async () => {
    for (const item of made) await api("POST", `/api/drive/items/${item.id}/restore`);
  };
  try {
    for (const file of files) {
      const name = freeName(file.name, taken);
      taken.add(name);
      made.push(await api<Item>("POST", `/api/drive/items/${file.id}/copy`, { parent: folder.id, name }));
    }
  } catch (problem) {
    const message = problem instanceof Error ? problem.message : t("error.problem");
    notify({ message, problem: true, undo: made.length > 0 ? undo : undefined });
    return;
  }
  notify({ message: naming(made, "drive.pastedOne", "drive.pastedMany", folderName), undo, redo });
}
