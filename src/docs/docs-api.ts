// Docs' API (accordion-docs' `src/api.rs`). Renaming, sharing, and the
// trash go through Drive's, since a document is a file like any other.

import { api } from "../api.ts";

export interface DocumentInfo {
  id: string;
  /** The file's name, with `.html`. */
  name: string;
  folder: string | null;
  modified_at: string;
  access: "owner" | "editor" | "viewer";
  /** Who owns it, for a document someone shared. */
  owner: string | null;
  /** The contents' SHA-256, which the thumbnail's address carries. */
  sha256: string | null;
  /** "page" once the server has made the document's thumbnail, its first
   * lines with their headings and styles. */
  thumbnail: "page" | null;
  /** Changes each time the server makes the thumbnail again. */
  thumbnail_version: string | null;
}

export function listDocuments(): Promise<{ top: string; documents: DocumentInfo[] }> {
  return api("GET", "/api/docs/documents");
}

export function createDocument(): Promise<DocumentInfo> {
  return api("POST", "/api/docs/documents", {});
}

export function openDocument(id: string): Promise<DocumentInfo> {
  return api("GET", `/api/docs/documents/${id}`);
}

/** Renames a document through Drive. A name without `.html` gets it, so
 * the file stays a document. */
export async function renameDocument(id: string, name: string): Promise<string> {
  const trimmed = name.trim();
  const named = /\.html$/i.test(trimmed) ? trimmed : `${trimmed}.html`;
  await api("PATCH", `/api/drive/items/${id}`, { name: named });
  return named;
}

/** Where a document opens. */
export function documentPath(id: string): string {
  return `/docs/d/${id}`;
}
