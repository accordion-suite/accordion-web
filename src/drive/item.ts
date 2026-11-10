/** A file or folder, as `/api/drive` describes it. */
export interface Item {
  id: string;
  parent: string | null;
  name: string;
  kind: "file" | "folder";
  size: number | null;
  /** For files: the SHA-256 hash of the current version's contents. */
  sha256: string | null;
  /** For files the browser can show itself, or "document" for an Office
   * document the server has made a PDF of. "convert" is a video the server
   * is making a version of that browsers play, which `/convert` asks for. */
  preview: "image" | "pdf" | "video" | "audio" | "document" | "convert" | "book" | "font" | null;
  /** For a document: whether its preview stops at its first pages, so the
   * document may go on past them. */
  preview_partial: boolean;
  /** What thumbnail the server has of the file yet: a small picture, or a
   * text file's first lines. */
  thumbnail: "picture" | "text" | null;
  /** Changes each time the server makes the thumbnail again, such as a
   * better one after an update. */
  thumbnail_version?: string | null;
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
  /** For a folder: the color the reader picked for it, if any. */
  color: FolderColor | null;
  /** For files: which type it is, such as "photos", by its name and, where
   * a name is shared, its contents. Null for none. */
  type?: string | null;
}

/** Where a file's thumbnail is. Browsers keep it for a year, so the
 * address names the contents and the thumbnail's version, and changes when
 * either does. */
export function thumbnailAddress(item: Pick<Item, "id" | "sha256" | "thumbnail_version">): string {
  const version = item.thumbnail_version ? `-${item.thumbnail_version}` : "";
  return `/api/drive/items/${item.id}/thumbnail?v=${item.sha256}${version}`;
}

/** The colors a folder can have, as Drive's API names them. */
export const FOLDER_COLORS = ["red", "orange", "yellow", "green", "teal", "blue", "purple", "pink", "brown"] as const;
export type FolderColor = (typeof FOLDER_COLORS)[number];

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

/** Part of a line of text from inside a file. */
export interface SnippetPiece {
  text: string;
  /** Whether it's a word the search matched. */
  matched: boolean;
}

/** A search result, with how it matched. */
export interface Hit extends Found {
  /** Whether the words were in its name or inside it. Null without words. */
  matched: "name" | "text" | null;
  /** A line of text around where the words matched inside the file. */
  snippet: SnippetPiece[] | null;
}

/** Someone an item is shared with, as `/api/drive/items/{id}/shares` lists
 * them. */
export interface ShareEntry {
  user: string;
  username: string;
  display_name: string;
  level: "viewer" | "editor";
}

/** Something the reader shared, with who has it, for Shared by me. */
export interface SharedOut extends Found {
  shared_with: ShareEntry[];
  /** How many of its links still work. */
  links: number;
  /** When it was last shared with someone new, or got a new link. */
  shared_at: string;
}

/** Something someone else shared with the reader. */
export interface Shared extends Found {
  shared_at: string;
}
