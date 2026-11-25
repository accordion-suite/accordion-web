// The reader's Notes settings: where a new note's caret starts, where a
// list's new items go, and whether checked items move to the bottom. The server keeps them, so they follow
// the reader to every device. They load once, and Settings changes them
// here, so Notes sees a change without loading them again.

import { useEffect, useState } from "preact/hooks";

import { api } from "../api.ts";

export interface NotesSettings {
  /** Where the caret starts in a new note: the text, under "Take a
   * note…", or the title. */
  start_in: "text" | "title";
  new_items: "bottom" | "top";
  /** Whether checked items show below the others, under "checked items".
   * Otherwise they stay where they are. */
  checked_at_bottom: boolean;
}

export const DEFAULT_NOTES_SETTINGS: NotesSettings = { start_in: "text", new_items: "bottom", checked_at_bottom: true };

const CHANGED = "accordion:notes-settings";

let current: NotesSettings | null = null;
let loading: Promise<NotesSettings> | null = null;

/** The settings, loaded the first time they're asked for. If they can't
 * load, Notes works with the defaults. */
export function notesSettings(): Promise<NotesSettings> {
  if (current) return Promise.resolve(current);
  loading ??= api<NotesSettings>("GET", "/api/notes/settings").then(
    (loaded) => (current = loaded),
    () => {
      loading = null;
      return DEFAULT_NOTES_SETTINGS;
    },
  );
  return loading;
}

/** Forgets the settings, which belong to whoever was signed in before. */
export function forgetNotesSettings(): void {
  current = null;
  loading = null;
}

/** Saves `change`, then tells every page using the settings. */
export async function saveNotesSettings(change: Partial<NotesSettings>): Promise<NotesSettings> {
  const next = { ...(await notesSettings()), ...change };
  await api("PUT", "/api/notes/settings", next);
  current = next;
  window.dispatchEvent(new Event(CHANGED));
  return next;
}

/** The settings, or null while they load. */
export function useNotesSettings(): NotesSettings | null {
  const [settings, setSettings] = useState(current);
  useEffect(() => {
    let live = true;
    const update = () => void notesSettings().then((loaded) => live && setSettings(loaded));
    update();
    window.addEventListener(CHANGED, update);
    return () => {
      live = false;
      window.removeEventListener(CHANGED, update);
    };
  }, []);
  return settings;
}

/** The settings as lists use them: the defaults until they load. */
export function useListSettings(): NotesSettings {
  return useNotesSettings() ?? DEFAULT_NOTES_SETTINGS;
}
