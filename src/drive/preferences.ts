// The reader's Drive settings: the page Drive opens on, and whether grid
// view shows thumbnails. The server keeps them, so they follow the reader
// to every device. They load once, and Settings changes them here, so Drive
// sees a change without loading them again.

import { useEffect, useState } from "preact/hooks";

import { api } from "../api.ts";

export interface DriveSettings {
  start_page: "home" | "my-drive";
  thumbnails: boolean;
}

export const DEFAULT_SETTINGS: DriveSettings = { start_page: "home", thumbnails: true };

const CHANGED = "accordion:drive-settings";

let current: DriveSettings | null = null;
let loading: Promise<DriveSettings> | null = null;

/** The settings, loaded the first time they're asked for. If they can't
 * load, Drive works with the defaults. */
export function driveSettings(): Promise<DriveSettings> {
  if (current) return Promise.resolve(current);
  loading ??= api<DriveSettings>("GET", "/api/drive/settings").then(
    (loaded) => (current = loaded),
    () => {
      loading = null;
      return DEFAULT_SETTINGS;
    },
  );
  return loading;
}

/** Saves `change`, then tells every page using the settings. */
export async function saveDriveSettings(change: Partial<DriveSettings>): Promise<DriveSettings> {
  const next = { ...(await driveSettings()), ...change };
  await api("PUT", "/api/drive/settings", next);
  current = next;
  window.dispatchEvent(new Event(CHANGED));
  return next;
}

/** The settings, or null while they load. */
export function useDriveSettings(): DriveSettings | null {
  const [settings, setSettings] = useState(current);
  useEffect(() => {
    let live = true;
    const update = () => void driveSettings().then((loaded) => live && setSettings(loaded));
    update();
    window.addEventListener(CHANGED, update);
    return () => {
      live = false;
      window.removeEventListener(CHANGED, update);
    };
  }, []);
  return settings;
}

/** The address of the page Drive opens on. */
export function startPath(settings: DriveSettings): string {
  return settings.start_page === "my-drive" ? "/drive/my-drive" : "/drive/";
}
