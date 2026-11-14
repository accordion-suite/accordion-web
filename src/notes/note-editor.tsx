// Writing notes: the box at the top of the list that takes a new note, and
// the dialog that edits one. Both edit plain text, or a checklist with a
// checkbox on each item. The dialog saves a second after typing stops, and
// at once for a color, a pin, labels, or archiving (decision 31).

import { useEffect, useRef, useState } from "preact/hooks";

import { ApiError } from "../api.ts";
import { CloseIcon } from "../drive/icons.tsx";
import { formatMoment, t } from "../i18n.ts";
import { Dialog, problemText } from "../shell/dialog.tsx";
import { Menu, type MenuPlace } from "../shell/menu.tsx";
import { type ChecklistItem, fromChecklist, isChecklist, readChecklist, toChecklist, writeChecklist } from "./checklist.ts";
import { ArchiveIcon, ChecklistIcon, LabelIcon, NoColorIcon, PaletteIcon, PinIcon } from "./icons.tsx";
import { TrashIcon } from "../drive/icons.tsx";
import { changeNote, createNote, NOTE_COLORS, type Note, type NoteChange, type NoteColor, openNote } from "./notes-api.ts";

/** How long typing has to stop before the note saves. */
const SAVE_AFTER_MS = 1000;

/** What's being written: a title, and plain text or a checklist. */
interface Draft {
  title: string;
  text: string;
  /** The checklist's items, when it shows checkboxes. */
  items: ChecklistItem[] | null;
}

function draftOf(note: Pick<Note, "title" | "titled" | "body">): Draft {
  const checklist = isChecklist(note.body);
  return {
    title: note.titled ? note.title : "",
    text: checklist ? "" : note.body,
    items: checklist ? readChecklist(note.body) : null,
  };
}

function bodyOf(draft: Draft): string {
  return draft.items ? writeChecklist(draft.items.filter((item) => item.text.trim() !== "")) : draft.text;
}

/** The menu of colors, for a card or the editor. */
export function ColorMenu({
  place,
  chosen,
  onChoose,
  onClose,
}: {
  place: MenuPlace;
  chosen: NoteColor | null;
  onChoose: (color: NoteColor | null) => void;
  onClose: () => void;
}) {
  return (
    <Menu
      label={t("notes.colorTitle")}
      entries={[
        { label: t("noteColor.none"), checked: chosen === null, icon: <NoColorIcon />, onSelect: () => onChoose(null) },
        ...NOTE_COLORS.map((color) => ({
          label: t(`noteColor.${color}`),
          checked: chosen === color,
          icon: <span class={`note-swatch note-${color}`} />,
          onSelect: () => onChoose(color),
        })),
      ]}
      place={place}
      byKeyboard={false}
      onClose={onClose}
    />
  );
}

/** The fields for writing a note, shared by the box and the dialog. */
function NoteFields({
  draft,
  onDraft,
  autofocusBody,
}: {
  draft: Draft;
  onDraft: (draft: Draft) => void;
  autofocusBody?: boolean;
}) {
  const body = useRef<HTMLTextAreaElement>(null);
  // Grows with the text, so the note reads as one piece.
  useEffect(() => {
    const area = body.current;
    if (!area) return;
    area.style.height = "auto";
    area.style.height = `${area.scrollHeight}px`;
  }, [draft.text]);
  return (
    <>
      <input
        class="note-title-field"
        aria-label={t("notes.titlePlaceholder")}
        placeholder={t("notes.titlePlaceholder")}
        maxLength={100}
        value={draft.title}
        onInput={(event) => onDraft({ ...draft, title: event.currentTarget.value })}
      />
      {draft.items ? (
        <ChecklistEditor items={draft.items} onItems={(items) => onDraft({ ...draft, items })} autofocus={autofocusBody} />
      ) : (
        <textarea
          ref={body}
          class="note-body-field"
          aria-label={t("notes.bodyPlaceholder")}
          placeholder={t("notes.bodyPlaceholder")}
          rows={3}
          autofocus={autofocusBody}
          value={draft.text}
          onInput={(event) => onDraft({ ...draft, text: event.currentTarget.value })}
        />
      )}
    </>
  );
}

/** A checklist's items, each with a checkbox. Enter adds an item below,
 * and Backspace in an empty item removes it. Checked items go below the
 * others. */
function ChecklistEditor({
  items,
  onItems,
  autofocus,
}: {
  items: ChecklistItem[];
  onItems: (items: ChecklistItem[]) => void;
  autofocus?: boolean;
}) {
  const list = useRef<HTMLDivElement>(null);
  const [focus, setFocus] = useState<number | null>(autofocus ? Math.max(0, items.length - 1) : null);
  useEffect(() => {
    if (focus === null) return;
    list.current?.querySelector<HTMLInputElement>(`input[data-item="${focus}"]`)?.focus();
    setFocus(null);
  }, [focus]);

  const set = (index: number, item: ChecklistItem) => onItems(items.map((each, at) => (at === index ? item : each)));
  const remove = (index: number) => onItems(items.filter((_, at) => at !== index));
  const row = (item: ChecklistItem, index: number) => (
    <div class={item.checked ? "checklist-row checked" : "checklist-row"} key={index}>
      <input
        type="checkbox"
        checked={item.checked}
        aria-label={item.text || t("notes.listItem")}
        onChange={() => set(index, { ...item, checked: !item.checked })}
      />
      <input
        data-item={index}
        class="checklist-text"
        aria-label={t("notes.listItem")}
        value={item.text}
        onInput={(event) => set(index, { ...item, text: event.currentTarget.value })}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            const next = [...items];
            next.splice(index + 1, 0, { checked: false, text: "" });
            onItems(next);
            setFocus(index + 1);
          } else if (event.key === "Backspace" && item.text === "" && items.length > 1) {
            event.preventDefault();
            remove(index);
            setFocus(Math.max(0, index - 1));
          }
        }}
      />
      <button type="button" class="icon-button" title={t("notes.removeItem")} aria-label={t("notes.removeItem")} onClick={() => remove(index)}>
        <CloseIcon />
      </button>
    </div>
  );
  const open = items.map((item, index) => ({ item, index })).filter(({ item }) => !item.checked);
  const done = items.map((item, index) => ({ item, index })).filter(({ item }) => item.checked);
  return (
    <div class="checklist-editor" ref={list}>
      {open.map(({ item, index }) => row(item, index))}
      <button
        type="button"
        class="link checklist-add"
        onClick={() => {
          onItems([...items, { checked: false, text: "" }]);
          setFocus(items.length);
        }}
      >
        + {t("notes.addItem")}
      </button>
      {done.length > 0 && (
        <>
          <p class="checklist-done">{t("notes.checked", { count: done.length })}</p>
          {done.map(({ item, index }) => row(item, index))}
        </>
      )}
    </div>
  );
}

/** The box at the top of the list, which takes a new note when it closes. */
export function Composer({ label, onCreated }: { label: string | null; onCreated: (note: Note) => void }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [color, setColor] = useState<NoteColor | null>(null);
  const [pinned, setPinned] = useState(false);
  const [colors, setColors] = useState<MenuPlace | null>(null);
  const [error, setError] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const saving = useRef(false);
  /** The newest of everything, for a close that a click outside starts
   * before the page has drawn the last keystroke. */
  const latest = useRef({ draft, color, pinned, colors });
  latest.current = { draft, color, pinned, colors };

  async function close() {
    const { draft, color, pinned } = latest.current;
    if (!draft || saving.current) return;
    const body = bodyOf(draft);
    if (!draft.title.trim() && !body.trim()) {
      reset();
      return;
    }
    saving.current = true;
    try {
      const note = await createNote({ title: draft.title, body, color, pinned, tags: label ? [label] : [] });
      reset();
      onCreated(note);
    } catch (problem) {
      setError(problemText(problem));
    } finally {
      saving.current = false;
    }
  }

  function reset() {
    setDraft(null);
    setColor(null);
    setPinned(false);
    setError("");
  }

  // Selecting outside the box closes it, as in Keep.
  const open = draft !== null;
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (latest.current.colors) return;
      if (box.current && !box.current.contains(event.target as Node)) void close();
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  if (!draft) {
    return (
      <div class="note-composer collapsed">
        <button type="button" class="note-composer-open" onClick={() => setDraft({ title: "", text: "", items: null })}>
          {t("notes.take")}
        </button>
        <button
          type="button"
          class="icon-button"
          title={t("notes.takeChecklist")}
          aria-label={t("notes.takeChecklist")}
          onClick={() => setDraft({ title: "", text: "", items: [{ checked: false, text: "" }] })}
        >
          <ChecklistIcon />
        </button>
      </div>
    );
  }
  return (
    <div
      ref={box}
      class={color ? `note-composer note-${color}` : "note-composer"}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          void close();
        }
      }}
    >
      <NoteFields draft={draft} onDraft={setDraft} autofocusBody />
      {error && (
        <p class="error" role="alert">
          {error}
        </p>
      )}
      <div class="note-toolbar">
        <button
          type="button"
          class="icon-button"
          title={t(pinned ? "notes.unpin" : "notes.pin")}
          aria-label={t(pinned ? "notes.unpin" : "notes.pin")}
          aria-pressed={pinned}
          onClick={() => setPinned(!pinned)}
        >
          <PinIcon filled={pinned} />
        </button>
        <button
          type="button"
          class="icon-button"
          title={t("notes.color")}
          aria-label={t("notes.color")}
          aria-haspopup="menu"
          onClick={(event) => setColors({ under: event.currentTarget })}
        >
          <PaletteIcon />
        </button>
        <CheckboxToggle draft={draft} onDraft={setDraft} />
        <span class="spacer" />
        <button type="button" class="secondary" onClick={() => void close()}>
          {t("notes.close")}
        </button>
      </div>
      {colors && (
        <ColorMenu
          place={colors}
          chosen={color}
          onChoose={(chosen) => {
            setColor(chosen);
            setColors(null);
          }}
          onClose={() => setColors(null)}
        />
      )}
    </div>
  );
}

/** Switches a note between plain text and a checklist. */
function CheckboxToggle({ draft, onDraft }: { draft: Draft; onDraft: (draft: Draft) => void }) {
  const label = t(draft.items ? "notes.hideCheckboxes" : "notes.showCheckboxes");
  return (
    <button
      type="button"
      class="icon-button"
      title={label}
      aria-label={label}
      aria-pressed={draft.items !== null}
      onClick={() =>
        onDraft(
          draft.items
            ? { ...draft, text: fromChecklist(draft.items), items: null }
            : { ...draft, text: "", items: draft.text.trim() ? toChecklist(draft.text) : [{ checked: false, text: "" }] },
        )
      }
    >
      <ChecklistIcon />
    </button>
  );
}

/** A note open for editing. */
export function NoteEditor({
  id,
  labels,
  onChanged,
  onTrash,
  onClose,
}: {
  id: string;
  labels: readonly string[];
  /** After each save, so the list behind shows it. */
  onChanged: (note: Note) => void;
  onTrash: (note: Note) => void;
  onClose: () => void;
}) {
  const [note, setNote] = useState<Note | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [status, setStatus] = useState<"" | "saving" | "saved">("");
  const [error, setError] = useState("");
  const [colors, setColors] = useState<MenuPlace | null>(null);
  const [picking, setPicking] = useState(false);
  /** The newest note from the server, whose hash the next save sends. */
  const latest = useRef<Note | null>(null);
  /** Saves run one after another, so each sends the hash of the one
   * before. */
  const queue = useRef<Promise<void>>(Promise.resolve());
  const timer = useRef<number | undefined>(undefined);
  /** The text that's saved, so an unchanged draft doesn't save. */
  const saved = useRef<{ title: string; body: string } | null>(null);

  useEffect(() => {
    openNote(id).then(
      (opened) => {
        latest.current = opened;
        setNote(opened);
        const first = draftOf(opened);
        setDraft(first);
        saved.current = { title: first.title, body: opened.body };
      },
      (problem) => setError(problemText(problem)),
    );
    return () => window.clearTimeout(timer.current);
  }, [id]);

  function run(change: () => NoteChange | null) {
    queue.current = queue.current.then(async () => {
      const current = latest.current;
      const wanted = change();
      if (!current || !wanted) return;
      setStatus("saving");
      try {
        const next = await changeNote(current.id, { ...wanted, base: wanted.body === undefined ? undefined : current.hash });
        latest.current = next;
        setNote(next);
        setStatus("saved");
        onChanged(next);
      } catch (problem) {
        setStatus("");
        if (problem instanceof ApiError && problem.status === 412) {
          // Someone else saved first. Their version shows, and the reader
          // is told their last change didn't save.
          const fresh = await openNote(current.id);
          latest.current = fresh;
          setNote(fresh);
          const reloaded = draftOf(fresh);
          setDraft(reloaded);
          saved.current = { title: reloaded.title, body: fresh.body };
          setError(t("notes.changedElsewhere"));
        } else {
          setError(problemText(problem));
        }
      }
    });
    return queue.current;
  }

  /** Saves the title and text, if they changed. */
  function saveText(current: Draft) {
    window.clearTimeout(timer.current);
    return run(() => {
      const body = bodyOf(current);
      const before = saved.current;
      if (before && before.title === current.title && before.body === body) return null;
      saved.current = { title: current.title, body };
      return { title: current.title, body };
    });
  }

  function edit(next: Draft) {
    setDraft(next);
    setError("");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void saveText(next), SAVE_AFTER_MS);
  }

  async function close() {
    if (draft) await saveText(draft);
    onClose();
  }

  const shown = note && draft;
  return (
    <Dialog title={t("notes.title")} class={note?.color ? `note-editor note-${note.color}` : "note-editor"} onClose={() => void close()}>
      {!shown ? (
        error ? (
          <p class="error" role="alert">
            {error}
          </p>
        ) : (
          <p class="loading">{t("shell.loading")}</p>
        )
      ) : (
        <>
          <button
            type="button"
            class="icon-button note-pin"
            title={t(note.pinned ? "notes.unpin" : "notes.pin")}
            aria-label={t(note.pinned ? "notes.unpin" : "notes.pin")}
            aria-pressed={note.pinned}
            onClick={() => void run(() => ({ pinned: !latest.current?.pinned }))}
          >
            <PinIcon filled={note.pinned} />
          </button>
          <NoteFields draft={draft} onDraft={edit} />
          {note.tags.length > 0 && (
            <ul class="note-tags" aria-label={t("notes.labels")}>
              {note.tags.map((tag) => (
                <li key={tag}>{tag}</li>
              ))}
            </ul>
          )}
          {error && (
            <p class="error" role="alert">
              {error}
            </p>
          )}
          <p class="note-edited hint" role="status">
            {status === "saving" ? t("notes.saving") : t("notes.edited", { when: formatMoment(note.modified_at) })}
          </p>
          <div class="note-toolbar">
            <button
              type="button"
              class="icon-button"
              title={t("notes.color")}
              aria-label={t("notes.color")}
              aria-haspopup="menu"
              onClick={(event) => setColors({ under: event.currentTarget })}
            >
              <PaletteIcon />
            </button>
            <button type="button" class="icon-button" title={t("notes.addLabel")} aria-label={t("notes.addLabel")} onClick={() => setPicking(true)}>
              <LabelIcon />
            </button>
            <CheckboxToggle draft={draft} onDraft={edit} />
            <button
              type="button"
              class="icon-button"
              title={t(note.archived ? "notes.unarchiveNote" : "notes.archiveNote")}
              aria-label={t(note.archived ? "notes.unarchiveNote" : "notes.archiveNote")}
              onClick={() => void run(() => ({ archived: !latest.current?.archived })).then(() => void close())}
            >
              <ArchiveIcon />
            </button>
            <button
              type="button"
              class="icon-button"
              title={t("notes.toTrash")}
              aria-label={t("notes.toTrash")}
              onClick={() => {
                window.clearTimeout(timer.current);
                void queue.current.then(() => latest.current && onTrash(latest.current));
              }}
            >
              <TrashIcon />
            </button>
            <span class="spacer" />
            <button type="button" class="secondary" onClick={() => void close()}>
              {t("notes.close")}
            </button>
          </div>
          {colors && (
            <ColorMenu
              place={colors}
              chosen={note.color}
              onChoose={(color) => {
                setColors(null);
                void run(() => ({ color: color ?? "" }));
              }}
              onClose={() => setColors(null)}
            />
          )}
          {picking && (
            <LabelPicker
              labels={labels}
              chosen={note.tags}
              onChoose={(tags) => void run(() => ({ tags }))}
              onClose={() => setPicking(false)}
            />
          )}
        </>
      )}
    </Dialog>
  );
}

/** Chooses a note's labels, and makes new ones. */
export function LabelPicker({
  labels,
  chosen,
  onChoose,
  onClose,
}: {
  labels: readonly string[];
  chosen: readonly string[];
  onChoose: (tags: string[]) => void;
  onClose: () => void;
}) {
  const [tags, setTags] = useState<string[]>([...chosen]);
  const [made, setMade] = useState<string[]>([]);
  const [name, setName] = useState("");
  const all = [...labels, ...made.filter((label) => !labels.some((each) => each.toLowerCase() === label.toLowerCase()))];
  const has = (label: string) => tags.some((tag) => tag.toLowerCase() === label.toLowerCase());

  function toggle(label: string) {
    const next = has(label) ? tags.filter((tag) => tag.toLowerCase() !== label.toLowerCase()) : [...tags, label];
    setTags(next);
    onChoose(next);
  }

  return (
    <Dialog title={t("notes.labelsFor")} class="label-picker" onClose={onClose}>
      <form
        class="label-new"
        onSubmit={(event) => {
          event.preventDefault();
          const label = name.trim().replace(/^#+/, "").trim();
          if (!label) return;
          if (!all.some((each) => each.toLowerCase() === label.toLowerCase())) setMade([...made, label]);
          if (!has(label)) toggle(label);
          setName("");
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
      <fieldset class="choices">
        <legend class="visually-hidden">{t("notes.labels")}</legend>
        {all.map((label) => (
          <label class="choice" key={label}>
            <input type="checkbox" checked={has(label)} onChange={() => toggle(label)} />
            <span>{label}</span>
          </label>
        ))}
      </fieldset>
      <div class="dialog-buttons">
        <button type="button" onClick={onClose}>
          {t("notes.done")}
        </button>
      </div>
    </Dialog>
  );
}
