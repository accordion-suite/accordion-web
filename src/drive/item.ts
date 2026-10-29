/** A file or folder, as `/api/drive` describes it. */
export interface Item {
  id: string;
  parent: string | null;
  name: string;
  kind: "file" | "folder";
  size: number | null;
  /** For files the browser can show itself. */
  preview: "image" | "pdf" | null;
  created_at: string;
  modified_at: string;
}
