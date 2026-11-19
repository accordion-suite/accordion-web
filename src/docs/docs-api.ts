// Docs' API (accordion-docs' `src/api.rs`). Renaming, sharing, and the
// trash go through Drive's, since a document is a file like any other.

import { api, send } from "../api.ts";
import type { PageSize } from "./page-setup.ts";

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

/** Makes a new document on `page`'s paper. `state` is the co-editing
 * state of one started in the browser, which the file keeps as its own;
 * without it, the document is empty. */
export function createDocument(page: PageSize, state?: Uint8Array): Promise<DocumentInfo> {
  return api("POST", "/api/docs/documents", state ? { page, state: toBase64(state) } : { page });
}

function toBase64(bytes: Uint8Array): string {
  let text = "";
  for (let at = 0; at < bytes.length; at += 0x8000) {
    text += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  }
  return btoa(text);
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

/** Adds a picture to a document. The server checks it and shrinks it to
 * 2,560 pixels on its longer side, and replies with its hash, which the
 * editor's picture keeps. */
export function addPicture(id: string, file: Blob): Promise<{ hash: string; width: number; height: number }> {
  return send("POST", `/api/docs/documents/${id}/images`, {
    headers: { "Content-Type": "application/octet-stream" },
    body: file,
  });
}

/** Where a picture in a document is, by its hash. */
export function pictureAddress(id: string, hash: string): string {
  return `/api/docs/documents/${id}/images/${hash}`;
}

/** Where a new, blank document opens. It has no file until something in
 * it changes, so one opened and left leaves nothing behind. */
export const NEW_DOCUMENT_PATH = "/docs/new";

/** Where a document opens. */
export function documentPath(id: string): string {
  return `/docs/d/${id}`;
}

/** The document as a page to print, with everyone's latest edits, on its
 * own paper and margins. */
export function printAddress(id: string): string {
  return `/api/docs/documents/${id}/print`;
}

/** The formats a document downloads in, by file name extension. */
export type DownloadFormat = "docx" | "odt" | "html" | "md";

/** The document to keep, with everyone's latest edits: "html" is the file
 * itself, which any browser opens, and the others are Word, OpenDocument,
 * and Markdown files the server writes from it. */

export function downloadAddress(id: string, format: DownloadFormat): string {
  return `/api/docs/documents/${id}/download?as=${format}`;
}
