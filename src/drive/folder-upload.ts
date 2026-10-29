// Uploading whole folders, from the folder chooser or by dropping them.
// Drive's API uploads files into folders that already exist, so this makes
// each folder first, parents before what's inside them, and then the page
// hands the files to the upload queue, folder by folder.
//
// A folder that's already there with the same name is used as it is, so
// uploading a folder again adds to it, and files with the same names become
// new versions, as they do when uploading files.

import { ApiError, api } from "../api.ts";
import { t } from "../i18n.ts";
import type { Item } from "./item.ts";

/** A file, and the names of the folders it's in, outermost first, inside
 * the folder it's uploaded to. */
export interface TreeFile {
  readonly file: File;
  readonly path: readonly string[];
}

/** What was chosen or dropped: the files, and every folder, including empty
 * ones, which have no files to name them. */
export interface Tree {
  readonly files: readonly TreeFile[];
  readonly folders: readonly (readonly string[])[];
}

/** The tree from a folder chooser, whose files know their place in it. */
export function chosenTree(files: readonly File[]): Tree {
  const tree = files.map((file) => ({ file, path: file.webkitRelativePath.split("/").slice(0, -1) }));
  return { files: tree, folders: [] };
}

/** The tree from a drop. It reads the drop's entries straight away, because
 * the browser empties them once the drop event ends. */
export function droppedTree(items: DataTransferItemList): Promise<Tree> | null {
  const entries: FileSystemEntry[] = [];
  for (const item of items) {
    if (item.kind !== "file") continue;
    const entry = item.webkitGetAsEntry?.();
    // Without entries, a dropped folder can't be read.
    if (!entry) return null;
    entries.push(entry);
  }
  return readTree(entries);
}

async function readTree(entries: readonly FileSystemEntry[]): Promise<Tree> {
  const files: TreeFile[] = [];
  const folders: string[][] = [];
  async function visit(entry: FileSystemEntry, path: string[]) {
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) =>
        (entry as FileSystemFileEntry).file(resolve, reject),
      );
      files.push({ file, path });
      return;
    }
    const inside = [...path, entry.name];
    folders.push(inside);
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    // Each read returns some of the entries, and an empty list at the end.
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
        reader.readEntries(resolve, reject),
      );
      if (batch.length === 0) break;
      for (const child of batch) await visit(child, inside);
    }
  }
  for (const entry of entries) await visit(entry, []);
  return { files, folders };
}

/** Every folder the tree needs, parents before the folders inside them. */
export function foldersNeeded(tree: Tree): string[][] {
  const seen = new Map<string, string[]>();
  for (const path of [...tree.files.map((file) => file.path), ...tree.folders]) {
    for (let depth = 1; depth <= path.length; depth++) {
      const folder = path.slice(0, depth);
      seen.set(key(folder), folder);
    }
  }
  return [...seen.values()].sort((a, b) => a.length - b.length);
}

/** Identifies a folder path, as a map key. Names can't contain "/". */
export function key(path: readonly string[]): string {
  return path.join("/");
}

/** Makes or finds folders. Tests use a fake one. */
export interface Folders {
  /** Makes the folder `name` in `parent`, and returns its ID. */
  create(parent: string, name: string): Promise<string>;
  /** The folder named `name` in `parent`, if there's one. */
  find(parent: string, name: string): Promise<string | null>;
}

export const httpFolders: Folders = {
  async create(parent, name) {
    return (await api<Item>("POST", `/api/drive/items/${parent}/children`, { name })).id;
  },
  async find(parent, name) {
    const children = await api<Item[]>("GET", `/api/drive/items/${parent}/children`);
    return children.find((child) => child.kind === "folder" && child.name === name)?.id ?? null;
  },
};

/** Makes the folders the tree needs inside `top`, and returns each one's
 * ID by its key. */
export async function makeFolders(
  top: string,
  tree: Tree,
  folders: Folders = httpFolders,
): Promise<Map<string, string>> {
  const ids = new Map<string, string>([[key([]), top]]);
  for (const path of foldersNeeded(tree)) {
    const parent = ids.get(key(path.slice(0, -1)))!;
    const name = path[path.length - 1]!;
    let id: string | null;
    try {
      id = await folders.create(parent, name);
    } catch (problem) {
      if (!(problem instanceof ApiError) || problem.status !== 409) throw problem;
      // Something has the name already. A folder is used as it is.
      id = await folders.find(parent, name);
      if (id === null) throw new ApiError(409, t("drive.folderTaken", { name }));
    }
    ids.set(key(path), id);
  }
  return ids;
}
