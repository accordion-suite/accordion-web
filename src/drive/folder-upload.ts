// Uploading files and whole folders, chosen or dropped. Drive's API uploads
// files into folders that already exist, so this makes each folder first,
// parents before what's inside them, and names everything, and then the page
// hands the files to the upload queue.
//
// Names follow Google Drive. When an upload has the same name as an item of
// the same kind, the reader chooses to replace it or keep both. Replacing a
// file adds a new version, and replacing a folder adds to it. Keeping both,
// or meeting an item of the other kind, gives the upload a free name, such
// as "Photos (1)".

import { ApiError, api } from "../api.ts";
import type { Item } from "./item.ts";
import { freeName } from "./names.ts";

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

/** What's in a folder, as far as names go. An upload that hasn't finished
 * has no ID yet. */
export interface Child {
  readonly name: string;
  readonly kind: Item["kind"];
  readonly id?: string;
}

/** Makes and lists folders. Tests use a fake one. */
export interface Folders {
  /** Makes the folder `name` in `parent`, and returns its ID. */
  create(parent: string, name: string): Promise<string>;
  children(parent: string): Promise<readonly Child[]>;
}

export const httpFolders: Folders = {
  async create(parent, name) {
    return (await api<Item>("POST", `/api/drive/items/${parent}/children`, { name })).id;
  },
  children(parent) {
    return api<Item[]>("GET", `/api/drive/items/${parent}/children`);
  },
};

/** The items in `here` that something at the top of the tree would replace:
 * the ones with the same name and kind. */
export function clashes(tree: Tree, here: readonly Child[]): Child[] {
  const top = new Map<string, Item["kind"]>();
  for (const { file, path } of tree.files) {
    if (path.length === 0) top.set(file.name, "file");
    else top.set(path[0]!, "folder");
  }
  for (const folder of tree.folders) top.set(folder[0]!, "folder");
  return here.filter((child) => top.get(child.name) === child.kind);
}

/** A file to upload, with the name it gets and the folder it goes in. */
export interface Placed {
  readonly file: File;
  readonly name: string;
  readonly folder: { readonly id: string; readonly name: string };
}

/** Makes the folders the tree needs inside `top`, and places each file.
 * With `replace`, an item with the same name and kind as one that's there
 * replaces it; otherwise it takes a free name. */
export async function placeTree(
  top: { id: string; name: string },
  tree: Tree,
  replace: boolean,
  folders: Folders = httpFolders,
): Promise<Placed[]> {
  interface Place {
    id: string;
    name: string;
    /** What was there before the upload, by name. */
    there: Map<string, Child>;
    /** Names that are there or that the upload has given out. */
    taken: Set<string>;
  }
  async function existing(id: string, name: string): Promise<Place> {
    const children = await folders.children(id);
    return {
      id,
      name,
      there: new Map(children.map((child) => [child.name, child])),
      taken: new Set(children.map((child) => child.name)),
    };
  }

  const places = new Map<string, Place>([[key([]), await existing(top.id, top.name)]]);
  for (const path of foldersNeeded(tree)) {
    const parent = places.get(key(path.slice(0, -1)))!;
    const wanted = path[path.length - 1]!;
    const there = parent.there.get(wanted);
    if (replace && there?.kind === "folder" && there.id) {
      places.set(key(path), await existing(there.id, wanted));
      continue;
    }
    for (;;) {
      const name = freeName(wanted, parent.taken);
      parent.taken.add(name);
      try {
        const id = await folders.create(parent.id, name);
        places.set(key(path), { id, name, there: new Map(), taken: new Set() });
        break;
      } catch (problem) {
        if (!(problem instanceof ApiError) || problem.status !== 409) throw problem;
        // Something took the name since the folder was listed, so this
        // tries the next number. Any other conflict, such as the folder
        // having moved to the trash, stops the upload.
        const now = await folders.children(parent.id);
        if (!now.some((child) => child.name === name)) throw problem;
      }
    }
  }

  return tree.files.map(({ file, path }) => {
    const place = places.get(key(path))!;
    const name =
      replace && place.there.get(file.name)?.kind === "file" ? file.name : freeName(file.name, place.taken);
    place.taken.add(name);
    return { file, name, folder: { id: place.id, name: place.name } };
  });
}
