// The kinds of file, such as photos or code, from the server's one list
// (decision 26), so icons, the Type filter, and search agree. Each item the
// server sends says its own type. The list is for names alone, such as in
// the activity log, and loads once after signing in.

import { api } from "../api.ts";

/** What `GET /api/drive/types` says: each extension's type, and whole names
 * that have one, such as "makefile", all in lowercase. */
export interface TypeList {
  extensions: Record<string, string>;
  names: Record<string, string>;
}

let list: TypeList = { extensions: {}, names: {} };
let loading: Promise<void> | null = null;

/** Loads the list, once. Without it, names alone get the generic icon. */
export function loadTypes(): Promise<void> {
  loading ??= api<TypeList>("GET", "/api/drive/types").then(
    (loaded) => {
      list = loaded;
    },
    () => {
      loading = null;
    },
  );
  return loading;
}

/** Uses `next` as the list, as tests do. */
export function setTypeList(next: TypeList): void {
  list = next;
}

/** The type of a file named `name`, as the server works it out from a name,
 * or null. A name that only starts with a dot has no extension. */
export function typeOfName(name: string): string | null {
  const lower = name.toLowerCase();
  const whole = list.names[lower];
  if (whole) return whole;
  const dot = lower.lastIndexOf(".");
  if (dot <= 0) return null;
  return list.extensions[lower.slice(dot + 1)] ?? null;
}

/** The icon kind for each type, and for folders. */
export const TYPE_KINDS: Readonly<Record<string, string>> = {
  folders: "folder",
  documents: "document",
  spreadsheets: "spreadsheet",
  presentations: "presentation",
  pdfs: "pdf",
  photos: "image",
  videos: "video",
  audio: "audio",
  archives: "archive",
  code: "code",
  fonts: "font",
  ebooks: "ebook",
  designs: "design",
};
