// What Drive's pages share: whether items show as a list or a grid, news
// that something changed, so the page and the sidebar load again, and the
// folders the app has seen, so a folder's path shows without asking the
// server for every folder above it each time.

import { useEffect, useRef, useState } from "preact/hooks";

import { api } from "../api.ts";
import type { Item } from "./item.ts";

export type ViewMode = "list" | "grid";

const VIEW_KEY = "accordion.drive.view";
const VIEW_CHANGED = "accordion:drive-view";
const CHANGED = "accordion:drive-changed";

const folders = new Map<string, Item>();

/** The reader's choice of list or grid. It's kept in this browser only, and
 * the list is used when the browser keeps nothing, such as in a private
 * window. */
export function useViewMode(): [ViewMode, (mode: ViewMode) => void] {
  const read = (): ViewMode => {
    try {
      return localStorage.getItem(VIEW_KEY) === "grid" ? "grid" : "list";
    } catch {
      return "list";
    }
  };
  const [mode, setMode] = useState(read);
  useEffect(() => {
    const update = () => setMode(read());
    window.addEventListener(VIEW_CHANGED, update);
    return () => window.removeEventListener(VIEW_CHANGED, update);
  }, []);
  return [
    mode,
    (next) => {
      try {
        localStorage.setItem(VIEW_KEY, next);
      } catch {
        // The choice lasts until the page reloads.
      }
      setMode(next);
      window.dispatchEvent(new Event(VIEW_CHANGED));
    },
  ];
}

/** Says that files or folders changed, such as after an upload. A folder
 * may have been renamed or moved, so the folders seen so far are
 * forgotten. */
export function announceChange(): void {
  folders.clear();
  window.dispatchEvent(new Event(CHANGED));
}

/** Calls the latest `listener` after each change. */
export function useChanges(listener: () => void): void {
  const latest = useRef(listener);
  latest.current = listener;
  useEffect(() => {
    const run = () => latest.current();
    window.addEventListener(CHANGED, run);
    return () => window.removeEventListener(CHANGED, run);
  }, []);
}

/** Remembers folders from a response, for `pathTo`. */
export function remember(items: readonly Item[]): void {
  for (const item of items) {
    if (item.kind === "folder") folders.set(item.id, item);
  }
}

async function folder(id: string): Promise<Item> {
  const known = folders.get(id);
  if (known) return known;
  const item = await api<Item>("GET", `/api/drive/items/${id}`);
  folders.set(id, item);
  return item;
}

/** The folders from My Drive down to `item`, outermost first, including
 * both. */
export async function pathTo(item: Item): Promise<Item[]> {
  folders.set(item.id, item);
  const path = [item];
  for (let at = item; at.parent !== null; ) {
    at = await folder(at.parent);
    path.unshift(at);
  }
  return path;
}
