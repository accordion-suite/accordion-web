// Notes, as in Google Keep (decision 31): a box to take a note, then the
// notes as cards, pinned ones first. The sidebar has the notes, each label,
// the archive, and the trash, then the folders in the Notes place under a
// heading of their own (decision 32), last so the heading covers only them.
// The app loads this module only when Notes opens, so Drive's first load
// stays small.
//
// Right-clicking works as it does in Drive: the page offers a new note,
// list, or folder, a note offers what its buttons do and more, and each row
// in the sidebar offers what fits it, such as renaming a label or a folder.
// Notes can also be dragged onto a folder in the sidebar.

import "./messages.ts";

import type { ComponentChildren, HTMLAttributes, TargetedMouseEvent } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

import type { Session } from "../api.ts";
import { NameDialog } from "../drive/dialogs.tsx";
import { holdDrag, releaseDrag } from "../drive/move.ts";
import { CloseIcon, ItemIcon, PlusIcon, SearchIcon, TrashIcon } from "../drive/icons.tsx";
import { t } from "../i18n.ts";
import { ConfirmDialog, Dialog, problemText } from "../shell/dialog.tsx";
import { useLive } from "../shell/live.ts";
import { Menu, type MenuEntry, type MenuPlace, SEPARATOR } from "../shell/menu.tsx";
import { PageTitle } from "../shell/page.tsx";
import { followLink, navigate, usePath, useQuery } from "../shell/router.ts";
import { TopBar } from "../shell/top-bar.tsx";
import { toggleTask } from "./checklist.ts";
import {
  FolderPicker,
  type Movable,
  inside,
  movableFolder,
  movableNote,
  moveInto,
  noteName,
  placeName,
  treeOrder,
} from "./folders.tsx";
import { ArchiveIcon, ChecklistIcon, EditIcon, LabelIcon, NoteIcon } from "./icons.tsx";
import { NoteBody, NoteCard } from "./note-card.tsx";
import { ColorMenu, Composer, LabelPicker, NoteEditor } from "./note-editor.tsx";
import {
  addLabel,
  changeNote,
  createNote,
  deleteForever,
  emptyTrash,
  listNotes,
  listTrash,
  makeFolder,
  type Note,
  type NoteFolder,
  openNote,
  removeLabel,
  renameFolder,
  renameLabel,
  restoreFolder,
  restoreNote,
  trashFolder,
  trashNote,
  type TrashedNote,
} from "./notes-api.ts";

type View =
  | { kind: "notes" }
  | { kind: "archive" }
  | { kind: "trash" }
  | { kind: "label"; label: string }
  | { kind: "folder"; id: string }
  | { kind: "search"; q: string };

function viewOf(path: string, q: string | null): View | null {
  const trimmed = path.replace(/\/$/, "");
  if (trimmed === "/notes") return { kind: "notes" };
  if (trimmed === "/notes/archive") return { kind: "archive" };
  if (trimmed === "/notes/trash") return { kind: "trash" };
  if (trimmed === "/notes/search") return { kind: "search", q: q ?? "" };
  const folder = /^\/notes\/folder\/([^/]+)$/.exec(trimmed);
  if (folder) return { kind: "folder", id: folder[1]! };
  const label = /^\/notes\/label\/([^/]+)$/.exec(trimmed);
  if (label) {
    try {
      return { kind: "label", label: decodeURIComponent(label[1]!) };
    } catch {
      return null;
    }
  }
  return null;
}

export function labelPath(label: string): string {
  return `/notes/label/${encodeURIComponent(label)}`;
}

function folderPath(id: string): string {
  return `/notes/folder/${id}`;
}

interface Notice {
  text: string;
  undo?: () => Promise<unknown>;
}

/** An open right-click menu. `on` is what it's for, which is marked. */
interface OpenMenu {
  label: string;
  entries: MenuEntry[];
  place: MenuPlace;
  byKeyboard: boolean;
  on: string;
}

/** Where a right-click menu opens: at the pointer, or under what has focus
 * for the context menu key, which gives no position. */
function menuAt(event: MouseEvent, holder: Element): { place: MenuPlace; byKeyboard: boolean } {
  const byKeyboard = !event.clientX && !event.clientY;
  return { place: byKeyboard ? { under: holder } : { x: event.clientX, y: event.clientY }, byKeyboard };
}

/** A dialog that a menu opened. */
type Open =
  | { kind: "move"; things: Movable[] }
  | { kind: "labels"; note: Note }
  | { kind: "newFolder"; parent: string }
  | { kind: "renameFolder"; folder: NoteFolder }
  | { kind: "deleteFolder"; folder: NoteFolder }
  | { kind: "renameLabel"; label: string }
  | { kind: "deleteLabel"; label: string }
  | { kind: "emptyTrash" };

/** What's being dragged onto the sidebar's folders. */
type Dragged = { kind: "note"; note: Note } | { kind: "folder"; folder: NoteFolder };

export function Notes({ session, onSignOut }: { session: Session; onSignOut: () => void }) {
  const path = usePath();
  const q = useQuery("q");
  const view = viewOf(path, q);
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [labels, setLabels] = useState<string[]>([]);
  const [folders, setFolders] = useState<NoteFolder[]>([]);
  const [top, setTop] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editingLabels, setEditingLabels] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [colors, setColors] = useState<{ note: Note; place: MenuPlace } | null>(null);
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const [open, setOpen] = useState<Open | null>(null);
  const [start, setStart] = useState<{ kind: "note" | "list"; at: number } | null>(null);
  const [dropOn, setDropOn] = useState<string | null>(null);
  const dragged = useRef<Dragged | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const searchWords = view?.kind === "search" ? view.q : "";

  function load(): Promise<void> {
    return listNotes(searchWords || undefined).then(
      (found) => {
        setNotes(found.notes);
        setLabels(found.labels);
        setFolders(found.folders ?? []);
        setTop(found.top);
        setError("");
      },
      (problem) => setError(problemText(problem)),
    );
  }
  useEffect(() => void load(), [searchWords]);
  // Notes are files in Drive, so a change there, in another tab, or on
  // another device can change them.
  useLive("drive.items", () => void load());
  useEffect(() => setSidebarOpen(false), [path]);

  /** Shows a change to one note at once, before the list loads again. */
  function replace(note: Note) {
    setNotes((current) => current && current.map((each) => (each.id === note.id ? note : each)));
  }

  async function act(change: () => Promise<unknown>, done?: Notice) {
    try {
      await change();
      if (done) setNotice(done);
    } catch (problem) {
      setNotice({ text: problemText(problem) });
    }
    void load();
  }

  const trash = (note: Note) =>
    act(() => trashNote(note.id), { text: t("notes.trashed"), undo: () => restoreNote(note.id) });
  const archive = (note: Note) =>
    act(() => changeNote(note.id, { archived: !note.archived }), {
      text: t(note.archived ? "notes.unarchived" : "notes.archived"),
      undo: () => changeNote(note.id, { archived: note.archived }),
    });
  const pin = (note: Note) => act(() => changeNote(note.id, { pinned: !note.pinned }).then(replace));
  // The card has only the start of the text, so the note is opened first,
  // and the whole of it is saved.
  const toggle = (note: Note, index: number) =>
    act(async () => {
      const full = await openNote(note.id);
      replace(await changeNote(note.id, { base: full.hash, body: toggleTask(full.body, index) }));
    });
  const copy = (note: Note) =>
    act(async () => {
      const full = await openNote(note.id);
      const made = await createNote({
        title: full.titled ? full.title : "",
        body: full.body,
        color: full.color,
        tags: full.tags,
        folder: full.folder,
      });
      setNotice({ text: t("notes.copied", { name: noteName(full) }), undo: () => trashNote(made.id) });
    });

  /** Moves notes or folders, asking first if that shares them. */
  const move = (things: Movable[], into: string) =>
    act(async () => {
      if (!top) return;
      const moved = await moveInto(things, { id: into, name: placeName(folders, into, top) });
      if (moved) setNotice(moved);
    });

  /** The folder a new folder or note goes in from here. */
  const hereFolder = view?.kind === "folder" ? view.id : top;

  function newNote(kind: "note" | "list", folder: string | null = null) {
    const into = folder && folder !== top ? folderPath(folder) : null;
    // A label or folder page saves the note there, so only the archive,
    // trash, and search go to Notes first.
    if (into) navigate(into);
    else if (view?.kind !== "notes" && view?.kind !== "label" && view?.kind !== "folder") navigate("/notes/");
    setStart({ kind, at: Date.now() });
  }

  function openMenu(event: MouseEvent, holder: Element, on: string, label: string, entries: MenuEntry[]) {
    if (entries.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    setMenu({ label, entries, on, ...menuAt(event, holder) });
  }

  // The menus.

  function newEntries(folder: string | null): MenuEntry[] {
    if (!top) return [];
    return [
      { label: t("notes.newNote"), icon: <NoteIcon />, onSelect: () => newNote("note", folder) },
      { label: t("notes.takeChecklist"), icon: <ChecklistIcon />, onSelect: () => newNote("list", folder) },
      SEPARATOR,
      { label: t("notes.newFolder"), icon: <PlusIcon />, onSelect: () => setOpen({ kind: "newFolder", parent: folder ?? top }) },
    ];
  }

  /** A note's menu. Its colors open at `place`, where the menu was. */
  function noteEntries(note: Note, place: MenuPlace): MenuEntry[] {
    const entries: MenuEntry[] = [
      { label: t("notes.open"), onSelect: () => setEditing(note.id) },
      { label: t(note.pinned ? "notes.unpin" : "notes.pin"), onSelect: () => void pin(note) },
      SEPARATOR,
      { label: t("notes.color"), onSelect: () => setColors({ note, place }) },
      { label: t(note.tags.length > 0 ? "notes.changeLabels" : "notes.addLabel"), onSelect: () => setOpen({ kind: "labels", note }) },
      { label: t("notes.moveToFolder"), onSelect: () => top && setOpen({ kind: "move", things: [movableNote(note, top)] }) },
    ];
    if (note.folder && top) {
      entries.push({ label: t("notes.removeFromFolder"), onSelect: () => void move([movableNote(note, top)], top) });
    }
    entries.push(
      { label: t("notes.makeCopy"), onSelect: () => void copy(note) },
      {
        label: t("notes.showInDrive"),
        onSelect: () =>
          navigate(`${note.folder ? `/drive/folder/${note.folder}` : "/drive/place/notes"}?file=${note.id}`),
      },
      SEPARATOR,
      { label: t(note.archived ? "notes.unarchiveNote" : "notes.archiveNote"), onSelect: () => void archive(note) },
      { label: t("notes.toTrash"), onSelect: () => void trash(note) },
    );
    return entries;
  }

  function folderEntries(folder: NoteFolder): MenuEntry[] {
    if (!top) return [];
    return [
      { label: t("notes.open"), onSelect: () => navigate(folderPath(folder.id)) },
      { label: t("notes.newNote"), onSelect: () => newNote("note", folder.id) },
      { label: t("notes.newFolderInside"), onSelect: () => setOpen({ kind: "newFolder", parent: folder.id }) },
      SEPARATOR,
      { label: t("notes.renameFolder"), onSelect: () => setOpen({ kind: "renameFolder", folder }) },
      { label: t("notes.moveFolder"), onSelect: () => setOpen({ kind: "move", things: [movableFolder(folder, top)] }) },
      { label: t("notes.showInDrive"), onSelect: () => navigate(`/drive/folder/${folder.id}`) },
      SEPARATOR,
      { label: t("notes.deleteFolder"), onSelect: () => setOpen({ kind: "deleteFolder", folder }) },
    ];
  }

  function labelEntries(label: string): MenuEntry[] {
    return [
      { label: t("notes.open"), onSelect: () => navigate(labelPath(label)) },
      {
        label: t("notes.newNote"),
        onSelect: () => {
          navigate(labelPath(label));
          setStart({ kind: "note", at: Date.now() });
        },
      },
      SEPARATOR,
      { label: t("notes.renameLabelMenu"), onSelect: () => setOpen({ kind: "renameLabel", label }) },
      { label: t("notes.deleteLabelMenu"), onSelect: () => setOpen({ kind: "deleteLabel", label }) },
      SEPARATOR,
      { label: t("notes.editLabels"), onSelect: () => setEditingLabels(true) },
    ];
  }

  /** Right-clicking empty space on the page. */
  function pageMenu(event: TargetedMouseEvent<HTMLElement>) {
    const target = event.target as Element;
    if (event.defaultPrevented || target.closest("a, button, input, textarea, [contenteditable], .note-composer, dialog")) return;
    if (view?.kind !== "notes" && view?.kind !== "label" && view?.kind !== "folder") return;
    openMenu(event, target, "page", t("notes.pageActions"), newEntries(view.kind === "folder" ? view.id : null));
  }

  // Dragging notes and folders onto the sidebar's folders.

  /** Whether what's dragged can go into `folder`. */
  function takes(folder: string): boolean {
    const thing = dragged.current;
    if (!thing || !top) return false;
    if (thing.kind === "note") return (thing.note.folder ?? top) !== folder;
    return (thing.folder.parent ?? top) !== folder && !inside(folders, thing.folder.id).has(folder);
  }

  function dropProps(folder: string) {
    return {
      class: dropOn === folder ? "place-row drop-target" : menu?.on === folder ? "place-row menu-open" : "place-row",
      onDragOver: (event: DragEvent) => {
        if (!takes(folder)) return;
        event.preventDefault();
        event.dataTransfer!.dropEffect = "move";
        if (dropOn !== folder) setDropOn(folder);
      },
      onDragLeave: (event: DragEvent) => {
        const into = event.relatedTarget as Node | null;
        if (!into || !(event.currentTarget as Element).contains(into)) setDropOn((on) => (on === folder ? null : on));
      },
      onDrop: (event: DragEvent) => {
        event.preventDefault();
        setDropOn(null);
        const thing = dragged.current;
        const taken = takes(folder);
        dragged.current = null;
        if (!thing || !top || !taken) return;
        void move([thing.kind === "note" ? movableNote(thing.note, top) : movableFolder(thing.folder, top)], folder);
      },
    };
  }

  const drag = (thing: Dragged | null) => {
    dragged.current = thing;
    if (thing) return;
    releaseDrag();
    setDropOn(null);
  };

  const cards = (shown: Note[]) => (
    <div class="note-grid">
      {shown.map((note) => (
        <NoteCard
          key={note.id}
          note={note}
          menuOpen={menu?.on === note.id}
          onOpen={() => setEditing(note.id)}
          onPin={() => void pin(note)}
          onColor={(button) => setColors({ note, place: { under: button } })}
          onLabels={() => setOpen({ kind: "labels", note })}
          onMove={() => top && setOpen({ kind: "move", things: [movableNote(note, top)] })}
          onArchive={() => void archive(note)}
          onTrash={() => void trash(note)}
          onToggle={(index) => void toggle(note, index)}
          onMenu={(event) => {
            const card = event.currentTarget as Element;
            const entries = noteEntries(note, menuAt(event, card).place);
            openMenu(event, card, note.id, t("notes.actionsFor", { name: noteName(note) }), entries);
          }}
          onDrag={(dragging) => drag(dragging && { kind: "note", note: dragging })}
        />
      ))}
    </div>
  );

  let page: ComponentChildren;
  if (!view) {
    page = (
      <main class="page narrow">
        <PageTitle>{t("notFound.title")}</PageTitle>
        <p>{t("notFound.body")}</p>
      </main>
    );
  } else if (view.kind === "trash") {
    page = <TrashPage onNotice={setNotice} />;
  } else {
    const openFolder = view.kind === "folder" ? folders.find((folder) => folder.id === view.id) : undefined;
    const within = view.kind === "folder" ? inside(folders, view.id) : null;
    const title =
      view.kind === "notes"
        ? t("notes.title")
        : view.kind === "archive"
          ? t("notes.archive")
          : view.kind === "label"
            ? view.label
            : view.kind === "folder"
              ? (openFolder?.name ?? t("notes.folders"))
              : t("notes.searchTitle", { words: view.q });
    const shown = (notes ?? []).filter((note) => {
      switch (view.kind) {
        case "notes":
          return !note.archived;
        case "archive":
          return note.archived;
        case "label":
          return !note.archived && note.tags.some((tag) => tag.toLowerCase() === view.label.toLowerCase());
        case "folder":
          return !note.archived && note.folder !== null && within!.has(note.folder);
        case "search":
          return true;
      }
    });
    const pinned = view.kind === "archive" || view.kind === "search" ? [] : shown.filter((note) => note.pinned);
    const others = shown.filter((note) => !pinned.includes(note));
    const empty =
      view.kind === "notes"
        ? "notes.emptyAll"
        : view.kind === "archive"
          ? "notes.emptyArchive"
          : view.kind === "label"
            ? "notes.emptyLabel"
            : view.kind === "folder"
              ? "notes.emptyFolder"
              : "notes.emptySearch";
    page = (
      <main class="page notes-page" onContextMenu={pageMenu}>
        <div class="page-head">
          <PageTitle>{title}</PageTitle>
        </div>
        {(view.kind === "notes" || view.kind === "label" || view.kind === "folder") && (
          <Composer
            label={view.kind === "label" ? view.label : null}
            folder={view.kind === "folder" ? view.id : null}
            start={start}
            onStarted={() => setStart(null)}
            onCreated={(note) => {
              setNotes((current) => [note, ...(current ?? [])]);
              void load();
            }}
          />
        )}
        {error ? (
          <p class="error" role="alert">
            {error}
          </p>
        ) : notes === null ? (
          <p class="loading">{t("shell.loading")}</p>
        ) : shown.length === 0 ? (
          <p class="notes-empty">{t(empty)}</p>
        ) : (
          <>
            {pinned.length > 0 && (
              <>
                <h2 class="notes-section">{t("notes.pinned")}</h2>
                {cards(pinned)}
                {others.length > 0 && <h2 class="notes-section">{t("notes.others")}</h2>}
              </>
            )}
            {cards(others)}
          </>
        )}
      </main>
    );
  }

  const rowClass = (on: string) => (menu?.on === on ? "place-row menu-open" : "place-row");

  let dialog: ComponentChildren = null;
  const close = () => setOpen(null);
  if (open?.kind === "move" && top) {
    dialog = (
      <FolderPicker
        things={open.things}
        folders={folders}
        top={top}
        onMoved={(moved) => {
          close();
          setNotice(moved);
          void load();
        }}
        onNewFolder={async (parent, name) => {
          const made = await makeFolder(parent, name);
          await load();
          return made.id;
        }}
        onClose={close}
      />
    );
  } else if (open?.kind === "labels") {
    const note = open.note;
    dialog = (
      <LabelPicker
        labels={labels}
        chosen={note.tags}
        onChoose={(tags) => void act(() => changeNote(note.id, { tags }).then(replace))}
        onClose={close}
      />
    );
  } else if (open?.kind === "newFolder" && top) {
    const parent = open.parent;
    dialog = (
      <NameDialog
        title={t("notes.newFolderTitle", { folder: placeName(folders, parent, top) })}
        submit={t("notes.create")}
        onSubmit={async (name) => {
          await makeFolder(parent, name);
          close();
          void load();
        }}
        onClose={close}
      />
    );
  } else if (open?.kind === "renameFolder") {
    const folder = open.folder;
    dialog = (
      <NameDialog
        title={t("notes.renameFolderTitle", { name: folder.name })}
        submit={t("notes.rename")}
        initial={folder.name}
        onSubmit={async (name) => {
          await renameFolder(folder.id, name);
          close();
          setNotice({ text: t("notes.renamedFolder", { name }), undo: () => renameFolder(folder.id, folder.name) });
          void load();
        }}
        onClose={close}
      />
    );
  } else if (open?.kind === "deleteFolder") {
    const folder = open.folder;
    const count = (notes ?? []).filter((note) => note.folder !== null && inside(folders, folder.id).has(note.folder)).length;
    dialog = (
      <ConfirmDialog
        title={t("notes.deleteFolderTitle", { name: folder.name })}
        body={count === 0 ? t("notes.deleteEmptyFolderBody") : t("notes.deleteFolderBody", { count })}
        confirm={t("notes.deleteFolder")}
        onConfirm={async () => {
          await trashFolder(folder.id);
          close();
          if (view?.kind === "folder" && inside(folders, folder.id).has(view.id)) navigate("/notes/");
          setNotice({ text: t("notes.deletedFolder", { name: folder.name }), undo: () => restoreFolder(folder.id) });
          void load();
        }}
        onClose={close}
      />
    );
  } else if (open?.kind === "renameLabel") {
    const label = open.label;
    dialog = (
      <NameDialog
        title={t("notes.renameLabelTitle", { label })}
        submit={t("notes.rename")}
        initial={label}
        onSubmit={async (name) => {
          setLabels((await renameLabel(label, name)).labels);
          close();
          if (view?.kind === "label" && view.label.toLowerCase() === label.toLowerCase()) navigate(labelPath(name));
          void load();
        }}
        onClose={close}
      />
    );
  } else if (open?.kind === "deleteLabel") {
    const label = open.label;
    dialog = (
      <ConfirmDialog
        title={t("notes.deleteLabelTitle", { label })}
        body={t("notes.deleteLabelBody")}
        confirm={t("notes.deleteLabel", { label })}
        onConfirm={async () => {
          setLabels((await removeLabel(label)).labels);
          close();
          if (view?.kind === "label" && view.label.toLowerCase() === label.toLowerCase()) navigate("/notes/");
          void load();
        }}
        onClose={close}
      />
    );
  } else if (open?.kind === "emptyTrash") {
    dialog = (
      <ConfirmDialog
        title={t("notes.emptyTrashTitle")}
        body={t("notes.emptyTrashBody")}
        confirm={t("notes.emptyTrashButton")}
        onConfirm={async () => {
          await emptyTrash();
          close();
          setNotice({ text: t("notes.trashEmptied") });
        }}
        onClose={close}
      />
    );
  }

  return (
    <div class={sidebarOpen ? "frame notes-frame sidebar-open" : "frame notes-frame"}>
      <TopBar
        session={session}
        onSignOut={onSignOut}
        module={t("notes.title")}
        home="/notes/"
        menuOpen={sidebarOpen}
        onMenu={() => setSidebarOpen(!sidebarOpen)}
      >
        <NotesSearch searched={searchWords} />
      </TopBar>
      <nav id="sidebar" class="sidebar" aria-label={t("notes.places")}>
        <ul class="places">
          <Place
            href="/notes/"
            current={view?.kind === "notes"}
            icon={<NoteIcon />}
            row={top ? dropProps(top) : { class: rowClass("notes") }}
            onMenu={(event) => openMenu(event, event.currentTarget, top ?? "notes", t("notes.notes"), newEntries(null))}
          >
            {t("notes.notes")}
          </Place>
          {labels.map((label) => (
            <Place
              key={label}
              href={labelPath(label)}
              current={view?.kind === "label" && view.label.toLowerCase() === label.toLowerCase()}
              icon={<LabelIcon />}
              row={{ class: rowClass(`label:${label}`) }}
              onMenu={(event) =>
                openMenu(event, event.currentTarget, `label:${label}`, t("notes.actionsFor", { name: label }), labelEntries(label))
              }
            >
              {label}
            </Place>
          ))}
          <li>
            <div class="place-row">
              <button type="button" class="place" onClick={() => setEditingLabels(true)}>
                <EditIcon />
                {t("notes.editLabels")}
              </button>
            </div>
          </li>
          <Place href="/notes/archive" current={view?.kind === "archive"} icon={<ArchiveIcon />}>
            {t("notes.archive")}
          </Place>
          <Place
            href="/notes/trash"
            current={view?.kind === "trash"}
            icon={<TrashIcon />}
            row={{ class: rowClass("trash") }}
            onMenu={(event) =>
              openMenu(event, event.currentTarget, "trash", t("notes.trash"), [
                { label: t("notes.open"), onSelect: () => navigate("/notes/trash") },
                { label: t("notes.emptyTrashButton"), onSelect: () => setOpen({ kind: "emptyTrash" }) },
              ])
            }
          >
            {t("notes.trash")}
          </Place>
          {top && (
            <li>
              <div
                class="places-heading notes-folders-heading"
                onContextMenu={(event) =>
                  openMenu(event, event.currentTarget, "folders", t("notes.folders"), [
                    { label: t("notes.newFolder"), onSelect: () => setOpen({ kind: "newFolder", parent: top }) },
                  ])
                }
              >
                <span id="notes-folders">{t("notes.folders")}</span>
                <button
                  type="button"
                  class="icon-button"
                  title={t("notes.newFolder")}
                  aria-label={t("notes.newFolder")}
                  onClick={() => setOpen({ kind: "newFolder", parent: hereFolder ?? top })}
                >
                  <PlusIcon />
                </button>
              </div>
              {folders.length > 0 && (
                <ul class="tree" aria-labelledby="notes-folders">
                  {treeOrder(folders).map(({ folder, depth }) => (
                    <li key={folder.id}>
                      <div
                        {...dropProps(folder.id)}
                        onContextMenu={(event) =>
                          openMenu(
                            event,
                            event.currentTarget,
                            folder.id,
                            t("notes.actionsFor", { name: folder.name }),
                            folderEntries(folder),
                          )
                        }
                      >
                        <a
                          class="place"
                          style={{ paddingLeft: `${36 + depth * 20}px`, gap: "16px" }}
                          href={folderPath(folder.id)}
                          onClick={followLink}
                          draggable
                          onDragStart={(event) => {
                            event.dataTransfer!.effectAllowed = "move";
                            holdDrag(event, folder.name);
                            drag({ kind: "folder", folder });
                          }}
                          onDragEnd={() => drag(null)}
                          aria-current={view?.kind === "folder" && view.id === folder.id ? "page" : undefined}
                        >
                          <ItemIcon item={{ kind: "folder", name: folder.name }} />
                          <span class="place-name">{folder.name}</span>
                        </a>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          )}
        </ul>
        <p class="hint notes-where">{t("notes.inFolder")}</p>
      </nav>
      <div class="sidebar-scrim" aria-hidden="true" onClick={() => setSidebarOpen(false)} />
      <div class="frame-main">{page}</div>
      {editing && (
        <NoteEditor
          key={editing}
          id={editing}
          labels={labels}
          onChanged={replace}
          onTrash={(note) => {
            setEditing(null);
            void trash(note);
          }}
          onMove={(note) => {
            setEditing(null);
            if (top) setOpen({ kind: "move", things: [movableNote(note, top)] });
            void load();
          }}
          onClose={() => {
            setEditing(null);
            void load();
          }}
        />
      )}
      {colors && (
        <ColorMenu
          place={colors.place}
          chosen={colors.note.color}
          onChoose={(color) => {
            const note = colors.note;
            setColors(null);
            void act(() => changeNote(note.id, { color: color ?? "" }).then(replace));
          }}
          onClose={() => setColors(null)}
        />
      )}
      {menu && (
        <Menu label={menu.label} entries={menu.entries} place={menu.place} byKeyboard={menu.byKeyboard} onClose={() => setMenu(null)} />
      )}
      {dialog}
      {editingLabels && (
        <EditLabels
          labels={labels}
          onLabels={setLabels}
          onClose={() => {
            setEditingLabels(false);
            void load();
          }}
        />
      )}
      <div class="notice-area" role="status">
        {notice && <NoticeView notice={notice} onClose={() => setNotice(null)} onUndone={() => void load()} />}
      </div>
    </div>
  );
}

function Place({
  href,
  current,
  icon,
  row = { class: "place-row" },
  onMenu,
  children,
}: {
  href: string;
  current: boolean;
  icon: ComponentChildren;
  /** The row's class, and what it does when something's dropped on it. */
  row?: HTMLAttributes<HTMLDivElement>;
  onMenu?: (event: TargetedMouseEvent<HTMLElement>) => void;
  children: ComponentChildren;
}) {
  return (
    <li>
      <div {...row} onContextMenu={onMenu}>
        <a class="place" href={href} onClick={followLink} aria-current={current ? "page" : undefined}>
          {icon}
          <span class="place-name">{children}</span>
        </a>
      </div>
    </li>
  );
}


/** The search box in Notes' top bar, which looks through titles, labels,
 * and text. */
function NotesSearch({ searched }: { searched: string }) {
  const [words, setWords] = useState(searched);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => setWords(searched), [searched]);
  return (
    <form
      class="search"
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        const q = words.trim();
        navigate(q ? `/notes/search?q=${encodeURIComponent(q)}` : "/notes/");
      }}
    >
      <SearchIcon />
      <input
        ref={input}
        type="search"
        aria-label={t("notes.searchLabel")}
        placeholder={t("notes.searchLabel")}
        autocomplete="off"
        value={words}
        onInput={(event) => setWords(event.currentTarget.value)}
      />
      {words && (
        <button
          type="button"
          class="icon-button search-clear"
          title={t("notes.searchClear")}
          aria-label={t("notes.searchClear")}
          onClick={() => {
            setWords("");
            input.current?.focus();
          }}
        >
          <CloseIcon />
        </button>
      )}
    </form>
  );
}

function NoticeView({ notice, onClose, onUndone }: { notice: Notice; onClose: () => void; onUndone: () => void }) {
  // Notices go after a while, as Drive's do.
  useEffect(() => {
    const timer = window.setTimeout(onClose, 8000);
    return () => window.clearTimeout(timer);
  }, [notice]);
  return (
    <div class="notice">
      <span>{notice.text}</span>
      {notice.undo && (
        <button
          type="button"
          class="link notice-undo"
          onClick={() => {
            const undo = notice.undo!;
            onClose();
            void undo().then(onUndone, onUndone);
          }}
        >
          {t("notes.undo")}
        </button>
      )}
      <button type="button" class="icon-button" aria-label={t("notes.close")} onClick={onClose}>
        <CloseIcon />
      </button>
    </div>
  );
}

/** Notes in the trash, which is Drive's, to restore or delete for good. */
function TrashPage({ onNotice }: { onNotice: (notice: Notice) => void }) {
  const [notes, setNotes] = useState<TrashedNote[] | null>(null);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState<{ note: TrashedNote } | "all" | null>(null);
  const [menu, setMenu] = useState<{ note: TrashedNote; place: MenuPlace; byKeyboard: boolean } | null>(null);
  const restore = (note: TrashedNote) =>
    void restoreNote(note.id).then(load, (problem) => onNotice({ text: problemText(problem) }));

  function load() {
    listTrash().then(
      (found) => setNotes(found.notes),
      (problem) => setError(problemText(problem)),
    );
  }
  useEffect(load, []);
  useLive("drive.items", load);

  return (
    <main class="page notes-page">
      <div class="page-head">
        <PageTitle>{t("notes.trash")}</PageTitle>
        {notes && notes.length > 0 && (
          <button type="button" class="secondary" onClick={() => setConfirm("all")}>
            {t("notes.emptyTrashButton")}
          </button>
        )}
      </div>
      <p class="hint">{t("notes.trashExplain")}</p>
      {error ? (
        <p class="error" role="alert">
          {error}
        </p>
      ) : notes === null ? (
        <p class="loading">{t("shell.loading")}</p>
      ) : notes.length === 0 ? (
        <p class="notes-empty">{t("notes.emptyTrash")}</p>
      ) : (
        <div class="note-grid">
          {notes.map((note) => (
            <article
              class={["note-card trashed", note.color && `note-${note.color}`, menu?.note.id === note.id && "menu-open"]
                .filter(Boolean)
                .join(" ")}
              key={note.id}
              onContextMenu={(event) => {
                if ((event.target as Element).closest("button")) return;
                event.preventDefault();
                setMenu({ note, ...menuAt(event, event.currentTarget) });
              }}
            >
              {note.titled && <h3 class="note-title">{note.title}</h3>}
              <NoteBody body={note.body} />
              <div class="note-trash-actions">
                <button type="button" class="link" onClick={() => restore(note)}>
                  {t("notes.restore")}
                </button>
                <button type="button" class="link" onClick={() => setConfirm({ note })}>
                  {t("notes.deleteForever")}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
      {menu && (
        <Menu
          label={t("notes.actionsFor", { name: noteName(menu.note) })}
          entries={[
            { label: t("notes.restore"), onSelect: () => restore(menu.note) },
            { label: t("notes.deleteForever"), onSelect: () => setConfirm({ note: menu.note }) },
          ]}
          place={menu.place}
          byKeyboard={menu.byKeyboard}
          onClose={() => setMenu(null)}
        />
      )}
      {confirm && (
        <ConfirmDialog
          title={t(confirm === "all" ? "notes.emptyTrashTitle" : "notes.deleteForeverTitle")}
          body={t(confirm === "all" ? "notes.emptyTrashBody" : "notes.deleteForeverBody")}
          confirm={t(confirm === "all" ? "notes.emptyTrashButton" : "notes.deleteForever")}
          onConfirm={async () => {
            if (confirm === "all") await emptyTrash();
            else await deleteForever(confirm.note.id);
            setConfirm(null);
            load();
          }}
          onClose={() => setConfirm(null)}
        />
      )}
    </main>
  );
}

/** Makes, renames, and deletes labels. */
function EditLabels({
  labels,
  onLabels,
  onClose,
}: {
  labels: readonly string[];
  onLabels: (labels: string[]) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);

  async function run(change: () => Promise<{ labels: string[] }>) {
    setError("");
    try {
      onLabels((await change()).labels);
    } catch (problem) {
      setError(problemText(problem));
    }
  }

  return (
    <Dialog title={t("notes.labelsTitle")} class="edit-labels" onClose={onClose}>
      <form
        class="label-new"
        onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim()) return;
          void run(() => addLabel(name)).then(() => setName(""));
        }}
      >
        <input
          aria-label={t("notes.newLabel")}
          placeholder={t("notes.newLabel")}
          maxLength={50}
          value={name}
          onInput={(event) => setName(event.currentTarget.value)}
        />
        <button type="submit" class="secondary">
          {t("notes.createLabel")}
        </button>
      </form>
      <ul class="label-list">
        {labels.map((label) => (
          <LabelRow
            key={label}
            label={label}
            onRename={(to) => void run(() => renameLabel(label, to))}
            onDelete={() => setDeleting(label)}
          />
        ))}
      </ul>
      {error && (
        <p class="error" role="alert">
          {error}
        </p>
      )}
      <div class="dialog-buttons">
        <button type="button" onClick={onClose}>
          {t("notes.done")}
        </button>
      </div>
      {deleting && (
        <ConfirmDialog
          title={t("notes.deleteLabelTitle", { label: deleting })}
          body={t("notes.deleteLabelBody")}
          confirm={t("notes.deleteLabel", { label: deleting })}
          onConfirm={async () => {
            onLabels((await removeLabel(deleting)).labels);
            setDeleting(null);
          }}
          onClose={() => setDeleting(null)}
        />
      )}
    </Dialog>
  );
}

function LabelRow({ label, onRename, onDelete }: { label: string; onRename: (to: string) => void; onDelete: () => void }) {
  const [name, setName] = useState(label);
  const rename = () => {
    const to = name.trim();
    if (to && to !== label) onRename(to);
    else setName(label);
  };
  return (
    <li class="label-row">
      <LabelIcon />
      <input
        aria-label={t("notes.renameLabel", { label })}
        maxLength={50}
        value={name}
        onInput={(event) => setName(event.currentTarget.value)}
        onBlur={rename}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            rename();
          }
        }}
      />
      <button type="button" class="icon-button" title={t("notes.deleteLabel", { label })} aria-label={t("notes.deleteLabel", { label })} onClick={onDelete}>
        <TrashIcon />
      </button>
    </li>
  );
}
