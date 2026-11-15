// Notes' calls to the server, at /api/notes (decision 31).

import { api } from "../api.ts";

/** The colors a note can have, as the server names them. */
export const NOTE_COLORS = [
  "red",
  "orange",
  "yellow",
  "green",
  "teal",
  "blue",
  "dark-blue",
  "purple",
  "pink",
  "brown",
  "gray",
] as const;

export type NoteColor = (typeof NOTE_COLORS)[number];

export interface Note {
  id: string;
  title: string;
  /** Whether someone gave it its title, rather than its first words. */
  titled: boolean;
  /** All of the text when opened, the start of it in lists. */
  body: string;
  color: NoteColor | null;
  pinned: boolean;
  archived: boolean;
  tags: string[];
  /** The folder it's in, or null at the top of the Notes place. */
  folder: string | null;
  /** The contents' hash, sent back with a new text. */
  hash: string;
  created_at: string;
  modified_at: string;
  /** Whether anyone else can open it, which makes it edited together,
   * live. */
  shared: boolean;
  /** Who owns it, when it's someone else's. */
  owner: { id: string; name: string | null } | null;
  /** What the reader may do. Others' pins, archive, and labels are their
   * own, and only an editor or the owner changes the note itself. */
  access: "owner" | "editor" | "viewer";
}

export interface TrashedNote {
  id: string;
  title: string;
  titled: boolean;
  body: string;
  color: NoteColor | null;
  trashed_at: string;
}

export interface NoteChange {
  base?: string;
  title?: string;
  body?: string;
  /** An empty string takes the color away. */
  color?: string;
  pinned?: boolean;
  archived?: boolean;
  tags?: string[];
}

/** A folder in the Notes place. Notes makes, renames, and moves folders
 * through Drive's API, so a move that would share something asks first. */
export interface NoteFolder {
  id: string;
  name: string;
  /** The folder it's in, or null at the top. */
  parent: string | null;
}

export interface NoteList {
  notes: Note[];
  labels: string[];
  folders: NoteFolder[];
  /** The Notes place's top folder in Drive. */
  top: string;
}

export function listNotes(q?: string): Promise<NoteList> {
  const query = q ? `?q=${encodeURIComponent(q)}` : "";
  return api("GET", `/api/notes/notes${query}`);
}

export function createNote(note: {
  title?: string;
  body: string;
  color?: string | null;
  pinned?: boolean;
  tags?: string[];
  /** A folder in the Notes place to save it in. */
  folder?: string | null;
}): Promise<Note> {
  return api("POST", "/api/notes/notes", { ...note, color: note.color ?? undefined });
}

export function openNote(id: string): Promise<Note> {
  return api("GET", `/api/notes/notes/${id}`);
}

export function changeNote(id: string, change: NoteChange): Promise<Note> {
  return api("PUT", `/api/notes/notes/${id}`, change);
}

export function trashNote(id: string): Promise<void> {
  return api("DELETE", `/api/notes/notes/${id}`);
}

export function listTrash(): Promise<{ notes: TrashedNote[] }> {
  return api("GET", "/api/notes/trash");
}

export function restoreNote(id: string): Promise<Note> {
  return api("POST", `/api/notes/trash/${id}/restore`);
}

export function deleteForever(id: string): Promise<void> {
  return api("DELETE", `/api/notes/trash/${id}`);
}

export function emptyTrash(): Promise<void> {
  return api("DELETE", "/api/notes/trash");
}

export function addLabel(name: string): Promise<{ labels: string[] }> {
  return api("POST", "/api/notes/labels", { name });
}

export function renameLabel(from: string, name: string): Promise<{ labels: string[] }> {
  return api("PUT", `/api/notes/labels/${encodeURIComponent(from)}`, { name });
}

export function removeLabel(name: string): Promise<{ labels: string[] }> {
  return api("DELETE", `/api/notes/labels/${encodeURIComponent(name)}`);
}

/** Makes a folder in the Notes place, in `parent` or its top folder. */
export function makeFolder(parent: string, name: string): Promise<{ id: string; name: string }> {
  return api("POST", `/api/drive/items/${parent}/children`, { name });
}

export function renameFolder(id: string, name: string): Promise<unknown> {
  return api("PATCH", `/api/drive/items/${id}`, { name });
}

/** Moves a folder to Drive's trash, with the notes in it. */
export function trashFolder(id: string): Promise<unknown> {
  return api("DELETE", `/api/drive/items/${id}`);
}

export function restoreFolder(id: string): Promise<unknown> {
  return api("POST", `/api/drive/items/${id}/restore`);
}
