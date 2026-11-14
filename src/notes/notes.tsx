// Notes, as in Google Keep (decision 31): a box to take a note, then the
// notes as cards, pinned ones first. The sidebar has the notes, each label,
// the archive, and the trash. The app loads this module only when Notes
// opens, so Drive's first load stays small.

import "./messages.ts";

import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

import type { Session } from "../api.ts";
import { CloseIcon, SearchIcon, TrashIcon } from "../drive/icons.tsx";
import { t } from "../i18n.ts";
import { ConfirmDialog, Dialog, problemText } from "../shell/dialog.tsx";
import { useLive } from "../shell/live.ts";
import type { MenuPlace } from "../shell/menu.tsx";
import { PageTitle } from "../shell/page.tsx";
import { followLink, navigate, usePath, useQuery } from "../shell/router.ts";
import { TopBar } from "../shell/top-bar.tsx";
import { toggleTask } from "./checklist.ts";
import { ArchiveIcon, EditIcon, LabelIcon, NoteIcon } from "./icons.tsx";
import { NoteBody, NoteCard } from "./note-card.tsx";
import { ColorMenu, Composer, NoteEditor } from "./note-editor.tsx";
import {
  addLabel,
  changeNote,
  deleteForever,
  emptyTrash,
  listNotes,
  listTrash,
  type Note,
  openNote,
  removeLabel,
  renameLabel,
  restoreNote,
  trashNote,
  type TrashedNote,
} from "./notes-api.ts";

type View =
  | { kind: "notes" }
  | { kind: "archive" }
  | { kind: "trash" }
  | { kind: "label"; label: string }
  | { kind: "search"; q: string };

function viewOf(path: string, q: string | null): View | null {
  const trimmed = path.replace(/\/$/, "");
  if (trimmed === "/notes") return { kind: "notes" };
  if (trimmed === "/notes/archive") return { kind: "archive" };
  if (trimmed === "/notes/trash") return { kind: "trash" };
  if (trimmed === "/notes/search") return { kind: "search", q: q ?? "" };
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

interface Notice {
  text: string;
  undo?: () => Promise<unknown>;
}

export function Notes({ session, onSignOut }: { session: Session; onSignOut: () => void }) {
  const path = usePath();
  const q = useQuery("q");
  const view = viewOf(path, q);
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [labels, setLabels] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editingLabels, setEditingLabels] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [colors, setColors] = useState<{ note: Note; place: MenuPlace } | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const searchWords = view?.kind === "search" ? view.q : "";

  function load() {
    listNotes(searchWords || undefined).then(
      (found) => {
        setNotes(found.notes);
        setLabels(found.labels);
        setError("");
      },
      (problem) => setError(problemText(problem)),
    );
  }
  useEffect(load, [searchWords]);
  // Notes are files in Drive, so a change there, in another tab, or on
  // another device can change them.
  useLive("drive.items", load);
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
    load();
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

  const cards = (shown: Note[]) => (
    <div class="note-grid">
      {shown.map((note) => (
        <NoteCard
          key={note.id}
          note={note}
          onOpen={() => setEditing(note.id)}
          onPin={() => void pin(note)}
          onColor={(button) => setColors({ note, place: { under: button } })}
          onArchive={() => void archive(note)}
          onTrash={() => void trash(note)}
          onToggle={(index) => void toggle(note, index)}
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
    const title =
      view.kind === "notes"
        ? t("notes.title")
        : view.kind === "archive"
          ? t("notes.archive")
          : view.kind === "label"
            ? view.label
            : t("notes.searchTitle", { words: view.q });
    const shown = (notes ?? []).filter((note) => {
      switch (view.kind) {
        case "notes":
          return !note.archived;
        case "archive":
          return note.archived;
        case "label":
          return !note.archived && note.tags.some((tag) => tag.toLowerCase() === view.label.toLowerCase());
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
            : "notes.emptySearch";
    page = (
      <main class="page notes-page">
        <div class="page-head">
          <PageTitle>{title}</PageTitle>
        </div>
        {(view.kind === "notes" || view.kind === "label") && (
          <Composer
            label={view.kind === "label" ? view.label : null}
            onCreated={(note) => {
              setNotes((current) => [note, ...(current ?? [])]);
              load();
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
          <Place href="/notes/" current={view?.kind === "notes"} icon={<NoteIcon />}>
            {t("notes.notes")}
          </Place>
          {labels.map((label) => (
            <Place
              key={label}
              href={labelPath(label)}
              current={view?.kind === "label" && view.label.toLowerCase() === label.toLowerCase()}
              icon={<LabelIcon />}
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
          <Place href="/notes/trash" current={view?.kind === "trash"} icon={<TrashIcon />}>
            {t("notes.trash")}
          </Place>
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
          onClose={() => {
            setEditing(null);
            load();
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
      {editingLabels && (
        <EditLabels
          labels={labels}
          onLabels={setLabels}
          onClose={() => {
            setEditingLabels(false);
            load();
          }}
        />
      )}
      <div class="notice-area" role="status">
        {notice && <NoticeView notice={notice} onClose={() => setNotice(null)} onUndone={load} />}
      </div>
    </div>
  );
}

function Place({ href, current, icon, children }: { href: string; current: boolean; icon: ComponentChildren; children: ComponentChildren }) {
  return (
    <li>
      <div class="place-row">
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
            <article class={note.color ? `note-card trashed note-${note.color}` : "note-card trashed"} key={note.id}>
              {note.titled && <h3 class="note-title">{note.title}</h3>}
              <NoteBody body={note.body} />
              <div class="note-trash-actions">
                <button
                  type="button"
                  class="link"
                  onClick={() =>
                    void restoreNote(note.id).then(load, (problem) => onNotice({ text: problemText(problem) }))
                  }
                >
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
