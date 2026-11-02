// The server makes thumbnails and document previews in the background, so a
// new file shows its icon at first. While a file that changed in the last
// few minutes has none, Drive's page asks for its list again now and then,
// sooner at first, until the thumbnail is there or it gives up. Files that
// never get one, such as ZIP archives, stop it asking after a while.

import { useEffect } from "preact/hooks";

import type { Item } from "./item.ts";
import { lookAgain } from "./store.ts";

/** How recently a file must have changed, by the server's clock, for its
 * thumbnail to be worth waiting for. */
const RECENT = 5 * 60_000;

/** How long the page waits for one version's thumbnail, by this browser's
 * clock, so a clock that's wrong can't keep it asking. */
const PATIENCE = 3 * 60_000;

/** When each version was first seen without a thumbnail, by ID and hash. */
const seen = new Map<string, number>();

/** How long to wait before asking for `items` again, or `null` if no file
 * is waiting for a thumbnail. */
export function nextLook(items: readonly Item[], now: number, firstSeen: Map<string, number>): number | null {
  let earliest: number | null = null;
  for (const item of items) {
    if (item.kind !== "file" || item.sha256 === null || item.thumbnail !== null) continue;
    if (now - Date.parse(item.modified_at) > RECENT) continue;
    const key = `${item.id}:${item.sha256}`;
    const first = firstSeen.get(key) ?? now;
    firstSeen.set(key, first);
    if (now - first < PATIENCE) earliest = Math.min(earliest ?? first, first);
  }
  if (earliest === null) return null;
  const waited = now - earliest;
  return waited < 20_000 ? 2_000 : waited < 60_000 ? 5_000 : 15_000;
}

/** Asks for the page's list again while `items` has files waiting for a
 * thumbnail, but not while the tab is hidden. */
export function useThumbnailWait(items: readonly Item[]): void {
  useEffect(() => {
    const delay = nextLook(items, Date.now(), seen);
    if (delay === null) return;
    const look = () => {
      if (!document.hidden) return lookAgain();
      document.addEventListener("visibilitychange", look, { once: true });
    };
    const timer = setTimeout(look, delay);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", look);
    };
  }, [items]);
}
