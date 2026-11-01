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
  preview: "image" | "pdf" | null;
  /** Whether the server has a thumbnail of the file yet. */
  thumbnail: boolean;
  created_at: string;
  modified_at: string;
  /** Whether the reader starred it. */
  starred: boolean;
}

/** An item in a list that reaches across folders, such as search results,
 * with the names of the folders it's in, outermost first, not counting My
 * Drive. */
export interface Found extends Item {
  folders: string[];
}
