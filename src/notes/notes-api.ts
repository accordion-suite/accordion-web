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
  /** The contents' hash, sent back with a new text. */
  hash: string;
  created_at: string;
  modified_at: string;
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

export function listNotes(q?: string): Promise<{ notes: Note[]; labels: string[] }> {
  const query = q ? `?q=${encodeURIComponent(q)}` : "";
  return api("GET", `/api/notes/notes${query}`);
}

export function createNote(note: { title?: string; body: string; color?: string | null; pinned?: boolean; tags?: string[] }): Promise<Note> {
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
