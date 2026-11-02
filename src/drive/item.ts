/** A file or folder, as `/api/drive` describes it. */
export interface Item {
  id: string;
  parent: string | null;
  name: string;
  kind: "file" | "folder";
  size: number | null;
  /** For files: the SHA-256 hash of the current version's contents. */
  sha256: string | null;
  /** For files the browser can show itself. */
  preview: "image" | "pdf" | "video" | "audio" | null;
  /** What thumbnail the server has of the file yet: a small picture, or a
   * text file's first lines. */
  thumbnail: "picture" | "text" | null;
  created_at: string;
  modified_at: string;
  /** Whether the reader starred it. */
  starred: boolean;
  /** What the reader may do with it. An editor can add, rename, move, and
   * delete inside a folder someone shared with them, and a viewer can only
   * open, download, and copy. */
  access: "owner" | "editor" | "viewer";
  /** The owner's name, when it's someone else's. */
  owner: string | null;
  /** For the owner: whether they shared it with anyone. */
  shared: boolean;
}

/** Whether the reader can change an item: rename it, move it, delete it, or
 * add to it. */
export function canEdit(item: Pick<Item, "access">): boolean {
  return item.access !== "viewer";
}

/** An item in a list that reaches across folders, such as search results,
 * with the names of the folders it's in, outermost first, not counting My
 * Drive. */
export interface Found extends Item {
  /** For someone else's item, these start at the folder they shared, and
   * are empty for the shared item itself. */
  folders: string[];
}

/** Something someone else shared with the reader. */
export interface Shared extends Found {
  shared_at: string;
}
