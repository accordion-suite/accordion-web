// Sorting notes into folders inside Notes (decision 32). A folder is a
// Drive folder in the Notes place, so moves go through Drive's API: a move
// into a folder that's shared asks first, as it does in Drive, and undoing
// a move out of one doesn't ask again.

import { useEffect, useRef, useState } from "preact/hooks";

import { ApiError, api } from "../api.ts";
import { type Consent, type Person, askToMove, consentFor, everyone, movedNotice, moveWithConsent } from "../drive/move-check.tsx";
import { ItemIcon } from "../drive/icons.tsx";
import { freeName } from "../drive/names.ts";
import { t } from "../i18n.ts";
import { Dialog, problemText } from "../shell/dialog.tsx";
import type { Note, NoteFolder } from "./notes-api.ts";

/** A note or folder to move, with the folder it's in now. */
export interface Movable {
  id: string;
  /** What the reader calls it, such as a note's title. */
  name: string;
  parent: string;
  /** What moves with it: a note's pictures beside it, so they stay side
   * by side (decision 31). */
  along?: Movable[];
}

/** What a move says, with how to undo it. */
export interface Moved {
  text: string;
  undo?: () => Promise<unknown>;
}

/** What a note is called in messages. */
export function noteName(note: Pick<Note, "title" | "titled">): string {
  return note.title || t("notes.untitled");
}

/** A note as something to move. A note at the top is in `top`. */
export function movableNote(note: Note, top: string): Movable {
  const parent = note.folder ?? top;
  const along = note.images.filter((image) => image.beside).map((image) => ({ id: image.id, name: image.name, parent }));
  return { id: note.id, name: noteName(note), parent, along };
}

/** A folder as something to move. */
export function movableFolder(folder: NoteFolder, top: string): Movable {
  return { id: folder.id, name: folder.name, parent: folder.parent ?? top };
}

/** What a folder is called, with the top named Notes. */
export function placeName(folders: readonly NoteFolder[], id: string, top: string): string {
  return id === top ? t("notes.notes") : (folders.find((folder) => folder.id === id)?.name ?? t("notes.notes"));
}

/** Moves `things` into `folder`, asking first if that lets anyone new open
 * them. Returns what to say, or null if the reader canceled. */
export async function moveInto(things: readonly Movable[], folder: { id: string; name: string }): Promise<Moved | null> {
  const moving = things.filter((thing) => thing.parent !== folder.id && thing.id !== folder.id);
  if (moving.length === 0) return null;
  const consent = await askToMove(moving, folder);
  if (!consent) return null;
  const done: Movable[] = [];
  const lost: Person[][] = [];
  for (const thing of moving) {
    const gone = await moveOne(thing, folder.id, consent, folder.name);
    if (gone === null) break;
    done.push(thing);
    lost.push(gone);
    // The pictures follow their note. One that won't move stays where it
    // is, and the note still shows it.
    for (const image of thing.along ?? []) {
      try {
        await moveOne(image, folder.id, consent, folder.name);
      } catch {
        // Left where it was.
      }
    }
  }
  if (done.length === 0) return null;
  const who = everyone(lost);
  const moved =
    done.length === 1
      ? t("notes.movedOne", { name: done[0]!.name, folder: folder.name })
      : t("notes.movedMany", { count: done.length, folder: folder.name });
  return {
    text: movedNotice(moved, who, done.length).message,
    async undo() {
      // Each goes back where it was, which gives back what the move took.
      const back = consentFor(who);
      for (const thing of done) {
        await moveOne(thing, thing.parent, back, t("move.cameFrom"));
        for (const image of thing.along ?? []) await moveOne(image, image.parent, back, t("move.cameFrom")).catch(() => null);
      }
    },
  };
}

/** Moves one note or folder. A note whose name the folder has already
 * gets a number, as a new note does. */
async function moveOne(thing: Movable, parent: string, consent: Consent, folderName: string): Promise<Person[] | null> {
  try {
    return await moveWithConsent(thing, { parent }, consent, folderName);
  } catch (problem) {
    if (!(problem instanceof ApiError) || problem.status !== 409 || problem.code !== null) throw problem;
    const [item, there] = await Promise.all([
      api<{ name: string }>("GET", `/api/drive/items/${thing.id}`),
      api<{ name: string }[]>("GET", `/api/drive/items/${parent}/children`),
    ]);
    const taken = new Set(there.map((child) => child.name));
    if (!taken.has(item.name)) throw problem;
    return moveWithConsent(thing, { parent, name: freeName(item.name, taken) }, consent, folderName);
  }
}

/** `id` and the folders inside it, however deep. */
export function inside(folders: readonly NoteFolder[], id: string): Set<string> {
  const within = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const folder of folders) {
      if (folder.parent !== null && within.has(folder.parent) && !within.has(folder.id)) {
        within.add(folder.id);
        grew = true;
      }
    }
  }
  return within;
}

/** The folders in the order the sidebar shows them: each folder's folders
 * right after it, by name, with how deep each is. */
export function treeOrder(folders: readonly NoteFolder[]): { folder: NoteFolder; depth: number }[] {
  const collator = new Intl.Collator(undefined, { numeric: true });
  const ordered: { folder: NoteFolder; depth: number }[] = [];
  const add = (parent: string | null, depth: number) => {
    const here = folders.filter((folder) => folder.parent === parent).sort((a, b) => collator.compare(a.name, b.name));
    for (const folder of here) {
      ordered.push({ folder, depth });
      add(folder.id, depth + 1);
    }
  };
  add(null, 0);
  return ordered;
}

/** Chooses a folder in Notes to move notes or a folder into. A folder
 * can't go inside itself, so those aren't offered. */
export function FolderPicker({
  things,
  folders,
  top,
  onMoved,
  onNewFolder,
  onClose,
}: {
  things: readonly Movable[];
  folders: readonly NoteFolder[];
  top: string;
  onMoved: (moved: Moved) => void;
  /** Makes a folder named `name` in `parent`, and returns it once the
   * list of folders has it. */
  onNewFolder: (parent: string, name: string) => Promise<string>;
  onClose: () => void;
}) {
  const now = things.length === 1 ? things[0]!.parent : null;
  const [chosen, setChosen] = useState(now ?? top);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  /** The name of a folder being made in the chosen one. */
  const [naming, setNaming] = useState<string | null>(null);
  const nameBox = useRef<HTMLInputElement>(null);
  const isNaming = naming !== null;
  useEffect(() => {
    if (isNaming) nameBox.current?.focus();
  }, [isNaming]);
  const barred = new Set<string>();
  for (const thing of things) if (folders.some((folder) => folder.id === thing.id)) for (const id of inside(folders, thing.id)) barred.add(id);
  const rows = treeOrder(folders).filter(({ folder }) => !barred.has(folder.id));
  const title =
    things.length === 1 ? t("notes.moveTitleOne", { name: things[0]!.name }) : t("notes.moveTitleMany", { count: things.length });

  async function move() {
    setBusy(true);
    setError("");
    try {
      const moved = await moveInto(things, { id: chosen, name: placeName(folders, chosen, top) });
      if (moved) onMoved(moved);
      else setBusy(false);
    } catch (problem) {
      setError(problemText(problem));
      setBusy(false);
    }
  }

  async function make() {
    const name = naming?.trim();
    if (!name) return;
    setBusy(true);
    setError("");
    try {
      setChosen(await onNewFolder(chosen, name));
      setNaming(null);
    } catch (problem) {
      setError(problemText(problem));
    }
    setBusy(false);
  }

  const row = (id: string, name: string, depth: number) => (
    <label class="choice folder-choice" key={id} style={{ paddingLeft: `${depth * 20}px` }}>
      <input type="radio" name="note-folder" checked={chosen === id} onChange={() => setChosen(id)} />
      <ItemIcon item={{ kind: "folder", name }} />
      <span>
        {name}
        {id === now && <span class="hint"> {t("notes.here")}</span>}
      </span>
    </label>
  );

  return (
    <Dialog title={title} class="folder-picker" onClose={onClose}>
      <fieldset class="choices">
        <legend class="visually-hidden">{t("notes.folders")}</legend>
        {row(top, t("notes.notes"), 0)}
        {rows.map(({ folder, depth }) => row(folder.id, folder.name, depth + 1))}
      </fieldset>
      {naming === null ? (
        <button type="button" class="link folder-new" disabled={busy} onClick={() => setNaming("")}>
          {t("notes.newFolderIn", { folder: placeName(folders, chosen, top) })}
        </button>
      ) : (
        <form
          class="label-new"
          onSubmit={(event) => {
            event.preventDefault();
            void make();
          }}
        >
          <input
            aria-label={t("notes.newFolderIn", { folder: placeName(folders, chosen, top) })}
            placeholder={t("notes.folderName")}
            ref={nameBox}
            maxLength={255}
            value={naming}
            onInput={(event) => setNaming(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                setNaming(null);
              }
            }}
          />
          <button type="submit" class="secondary" disabled={busy}>
            {t("notes.create")}
          </button>
        </form>
      )}
      {error && (
        <p class="error" role="alert">
          {error}
        </p>
      )}
      <div class="dialog-buttons">
        <button type="button" disabled={busy || chosen === now} onClick={() => void move()}>
          {t("notes.moveHere")}
        </button>
        <button type="button" class="secondary" onClick={onClose}>
          {t("dialog.cancel")}
        </button>
      </div>
    </Dialog>
  );
}
