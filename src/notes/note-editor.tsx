// Writing notes: the box at the top of the list that takes a new note, and
// the dialog that edits one. Both edit plain text, or a checklist with a
// checkbox on each item. The dialog saves a second after typing stops, and
// at once for a color, a pin, labels, or archiving (decision 31).

import type { TargetedKeyboardEvent } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";

import { ApiError } from "../api.ts";
import { CloseIcon, MoveIcon, PeopleIcon } from "../drive/icons.tsx";
import { formatMoment, t } from "../i18n.ts";
import { useLive } from "../shell/live.ts";
import { Dialog, problemText } from "../shell/dialog.tsx";
import { Menu, type MenuPlace } from "../shell/menu.tsx";
import { type ChecklistItem, fromChecklist, isChecklist, readChecklist, taskTexts, toChecklist, writeChecklist } from "./checklist.ts";
import { type LiveStatus, LiveNote, type Visitor } from "./live.ts";
import { shiftCaret } from "./text-change.ts";
import { useListSettings } from "./preferences.ts";
import { ArchiveIcon, ChecklistIcon, LabelIcon, NoColorIcon, PaletteIcon, PinIcon, ReminderIcon } from "./icons.tsx";
import { TrashIcon } from "../drive/icons.tsx";
import { changeNote, createNote, NOTE_COLORS, type Note, type NoteChange, type NoteColor, openNote } from "./notes-api.ts";
import { applyReminder, type ReminderAction, ReminderChip, ReminderDialog, ReminderMenu } from "./reminder-menu.tsx";

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

/** Someone else's caret in one field: an offset in the text box, or in
 * a list item's text. */
export interface FieldCaret {
  key: number;
  name: string;
  color: string;
  at: number;
  /** The list item it's in, in a list. */
  item?: number;
}

/** The reader's own caret: in the text box, or in a list item's text. */
export type OwnCaret = { start: number; end: number; item?: number };

/** Where the caret for `index` would be in `field`, in pixels from the
 * field's top left, measured with a copy of the field's text laid out the
 * same way. */
function caretPoint(field: HTMLTextAreaElement | HTMLInputElement, index: number) {
  const style = getComputedStyle(field);
  const mirror = document.createElement("div");
  for (const name of [
    "boxSizing", "width", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
    "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth", "borderStyle",
    "fontFamily", "fontSize", "fontWeight", "fontStyle", "letterSpacing", "lineHeight",
    "textTransform", "wordSpacing", "tabSize", "textIndent",
  ] as const) {
    mirror.style[name] = style[name];
  }
  Object.assign(mirror.style, {
    position: "absolute",
    visibility: "hidden",
    top: "0",
    left: "-9999px",
    whiteSpace: field instanceof HTMLTextAreaElement ? "pre-wrap" : "pre",
    overflowWrap: "break-word",
  });
  mirror.textContent = field.value.slice(0, index);
  const marker = document.createElement("span");
  marker.textContent = "\u200b";
  mirror.appendChild(marker);
  document.body.appendChild(mirror);
  const point = {
    left: field.offsetLeft + marker.offsetLeft - field.scrollLeft,
    top: field.offsetTop + marker.offsetTop - field.scrollTop,
    height: marker.offsetHeight,
  };
  mirror.remove();
  return point;
}

/** Others' carets over a text field, each in their color, with their
 * name. */
function Carets({
  field,
  carets,
  text,
}: {
  field: { current: HTMLTextAreaElement | HTMLInputElement | null };
  carets: readonly FieldCaret[];
  text: string;
}) {
  const [points, setPoints] = useState<(FieldCaret & { left: number; top: number; height: number })[]>([]);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const resized = () => setWidth(window.innerWidth);
    window.addEventListener("resize", resized);
    return () => window.removeEventListener("resize", resized);
  }, []);
  const key = carets.map((caret) => `${caret.key}:${caret.at}`).join(",");
  useLayoutEffect(() => {
    const element = field.current;
    if (!element || carets.length === 0) {
      setPoints([]);
      return;
    }
    setPoints(carets.map((caret) => ({ ...caret, ...caretPoint(element, Math.min(caret.at, element.value.length)) })));
  }, [key, text, width]);
  return (
    <>
      {points.map((point) => (
        <span
          key={point.key}
          class="remote-caret"
          aria-hidden="true"
          style={{ left: `${point.left}px`, top: `${point.top}px`, height: `${point.height}px`, "--caret": point.color }}
        >
          {/* Keyed by where it is, so the name shows again each time the
              caret moves, then fades so it doesn't cover the text. */}
          <span key={point.at} class="remote-caret-name">
            {point.name}
          </span>
        </span>
      ))}
    </>
  );
}

/** The fields for writing a note, shared by the box and the dialog. */
function NoteFields({
  draft,
  onDraft,
  autofocusBody,
  readOnly = false,
  carets = [],
  onCaret,
}: {
  draft: Draft;
  onDraft: (draft: Draft) => void;
  autofocusBody?: boolean;
  /** For someone who can see a shared note but not change it. */
  readOnly?: boolean;
  /** Others' carets, in a shared note. */
  carets?: readonly FieldCaret[];
  /** Where the reader's caret is, as it moves, in a shared note. */
  onCaret?: (caret: OwnCaret | null) => void;
}) {
  const body = useRef<HTMLTextAreaElement>(null);
  /** What the text was, and where the caret, as the reader last left it,
   * so a change from someone else keeps the caret with its words. */
  const shown = useRef({ text: draft.text, start: 0, end: 0 });
  const remember = () => {
    const area = body.current;
    if (!area) return;
    shown.current = { text: area.value, start: area.selectionStart, end: area.selectionEnd };
    if (document.activeElement === area) onCaret?.({ start: area.selectionStart, end: area.selectionEnd });
  };
  useLayoutEffect(() => {
    const area = body.current;
    const before = shown.current;
    if (area && document.activeElement === area && before.text !== draft.text) {
      area.setSelectionRange(
        shiftCaret(before.text, draft.text, before.start),
        shiftCaret(before.text, draft.text, before.end),
      );
    }
    remember();
  }, [draft.text]);
  // Browsers honor the autofocus attribute only once a page, so the box
  // takes focus itself each time it opens, as a list's first item does.
  useEffect(() => {
    if (autofocusBody) body.current?.focus();
  }, []);
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
        readOnly={readOnly}
        value={draft.title}
        onInput={(event) => onDraft({ ...draft, title: event.currentTarget.value })}
      />
      {draft.items ? (
        <ChecklistEditor
          items={draft.items}
          onItems={(items) => onDraft({ ...draft, items })}
          autofocus={autofocusBody}
          readOnly={readOnly}
          carets={carets}
          onCaret={onCaret}
        />
      ) : (
        <div class="caret-host">
        <textarea
          ref={body}
          class="note-body-field"
          aria-label={t("notes.bodyPlaceholder")}
          placeholder={readOnly ? "" : t("notes.bodyPlaceholder")}
          rows={3}
          readOnly={readOnly}
          value={draft.text}
          onSelect={remember}
          onKeyUp={remember}
          onPointerUp={remember}
          onFocus={remember}
          onInput={(event) => {
            remember();
            onDraft({ ...draft, text: event.currentTarget.value });
          }}
        />
        <Carets field={body} carets={carets} text={draft.text} />
        </div>
      )}
    </>
  );
}

/** A list item's text, with others' carets over it. */
function ItemText({
  index,
  text,
  readOnly,
  carets,
  onCaret,
  onInput,
  onKeyDown,
}: {
  index: number;
  text: string;
  readOnly: boolean;
  carets: readonly FieldCaret[];
  onCaret?: (caret: OwnCaret | null) => void;
  onInput: (text: string) => void;
  onKeyDown: (event: TargetedKeyboardEvent<HTMLInputElement>) => void;
}) {
  const field = useRef<HTMLInputElement>(null);
  /** The text and caret as the reader left them, so someone else's change
   * to this item keeps the caret with its words. */
  const shown = useRef({ text, start: 0, end: 0 });
  const report = () => {
    const input = field.current;
    if (!input) return;
    const start = input.selectionStart ?? 0;
    const end = input.selectionEnd ?? 0;
    shown.current = { text: input.value, start, end };
    if (document.activeElement === input) onCaret?.({ item: index, start, end });
  };
  useLayoutEffect(() => {
    const input = field.current;
    const before = shown.current;
    if (input && document.activeElement === input && before.text !== text) {
      input.setSelectionRange(shiftCaret(before.text, text, before.start), shiftCaret(before.text, text, before.end));
    }
    report();
  }, [text]);
  return (
    <span class="caret-host checklist-text-host">
      <input
        ref={field}
        data-item={index}
        class="checklist-text"
        aria-label={t("notes.listItem")}
        readOnly={readOnly}
        value={text}
        onInput={(event) => {
          onInput(event.currentTarget.value);
          report();
        }}
        onKeyDown={onKeyDown}
        onKeyUp={report}
        onSelect={report}
        onFocus={report}
        onPointerUp={report}
      />
      <Carets field={field} carets={carets} text={text} />
    </span>
  );
}

/** A checklist's items, each with a checkbox. Enter adds an item below,
 * and Backspace in an empty item removes it. The reader's settings say
 * whether the add button puts items at the top or the bottom, and whether
 * checked items go below the others. */
function ChecklistEditor({
  items,
  onItems,
  autofocus,
  readOnly = false,
  carets = [],
  onCaret,
}: {
  items: ChecklistItem[];
  onItems: (items: ChecklistItem[]) => void;
  autofocus?: boolean;
  readOnly?: boolean;
  /** Others' carets, each in an item. */
  carets?: readonly FieldCaret[];
  /** Where the reader's caret is, in which item, in a shared list. */
  onCaret?: (caret: OwnCaret | null) => void;
}) {
  const settings = useListSettings();
  const atTop = settings.new_items === "top";
  const list = useRef<HTMLDivElement>(null);
  const [focus, setFocus] = useState<number | null>(autofocus ? (atTop ? 0 : Math.max(0, items.length - 1)) : null);
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
        disabled={readOnly}
        aria-label={item.text || t("notes.listItem")}
        onChange={() => set(index, { ...item, checked: !item.checked })}
      />
      <ItemText
        index={index}
        text={item.text}
        readOnly={readOnly}
        carets={carets.filter((caret) => caret.item === index)}
        onCaret={onCaret}
        onInput={(text) => set(index, { ...item, text })}
        onKeyDown={(event) => {
          if (readOnly) return;
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
      {!readOnly && (
        <button type="button" class="icon-button" title={t("notes.removeItem")} aria-label={t("notes.removeItem")} onClick={() => remove(index)}>
          <CloseIcon />
        </button>
      )}
    </div>
  );
  const all = items.map((item, index) => ({ item, index }));
  const open = settings.checked_at_bottom ? all.filter(({ item }) => !item.checked) : all;
  const done = settings.checked_at_bottom ? all.filter(({ item }) => item.checked) : [];
  const add = (
    <button
      type="button"
      class="link checklist-add"
      onClick={() => {
        const blank = { checked: false, text: "" };
        onItems(atTop ? [blank, ...items] : [...items, blank]);
        setFocus(atTop ? 0 : items.length);
      }}
    >
      + {t("notes.addItem")}
    </button>
  );
  return (
    <div class="checklist-editor" ref={list}>
      {atTop && !readOnly && add}
      {open.map(({ item, index }) => row(item, index))}
      {!atTop && !readOnly && add}
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
export function Composer({
  label,
  labels,
  folder = null,
  start = null,
  onStarted,
  onCreated,
}: {
  label: string | null;
  /** Every label, to choose from. */
  labels: readonly string[];
  /** The folder a note taken here goes in, when a folder is open. */
  folder?: string | null;
  /** Opens the box from elsewhere, such as the page's menu: a new `at`
   * opens it for a note or a list. */
  start?: { kind: "note" | "list"; at: number } | null;
  /** Called once `start` has opened the box, so it doesn't again. */
  onStarted?: () => void;
  onCreated: (note: Note) => void;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  useEffect(() => {
    if (!start) return;
    onStarted?.();
    if (latest.current.draft) return;
    setDraft({ title: "", text: "", items: start.kind === "list" ? [{ checked: false, text: "" }] : null });
    box.current?.scrollIntoView?.({ block: "nearest" });
  }, [start?.at]);
  const [color, setColor] = useState<NoteColor | null>(null);
  const [pinned, setPinned] = useState(false);
  const [colors, setColors] = useState<MenuPlace | null>(null);
  /** The labels chosen, or null for the open label's, if any. */
  const [tags, setTags] = useState<string[] | null>(null);
  const [picking, setPicking] = useState(false);
  const chosenTags = tags ?? (label ? [label] : []);
  const [error, setError] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const saving = useRef(false);
  /** The newest of everything, for a close that a click outside starts
   * before the page has drawn the last keystroke. */
  const latest = useRef({ draft, color, pinned, colors, chosenTags, picking });
  latest.current = { draft, color, pinned, colors, chosenTags, picking };

  async function close() {
    const { draft, color, pinned, chosenTags } = latest.current;
    if (!draft || saving.current) return;
    const body = bodyOf(draft);
    if (!draft.title.trim() && !body.trim()) {
      reset();
      return;
    }
    saving.current = true;
    try {
      const note = await createNote({ title: draft.title, body, color, pinned, tags: chosenTags, folder });
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
    setTags(null);
    setError("");
  }

  // Selecting outside the box closes it, as in Keep.
  const open = draft !== null;
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      // The colors and the label picker are outside the box.
      if (latest.current.colors || latest.current.picking) return;
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
        // Escape in the label picker closes only the picker.
        if (event.key === "Escape" && !(event.target as Element).closest("dialog")) {
          event.preventDefault();
          void close();
        }
      }}
    >
      <NoteFields draft={draft} onDraft={setDraft} autofocusBody />
      {chosenTags.length > 0 && (
        <ul class="note-tags" aria-label={t("notes.labels")}>
          {chosenTags.map((tag) => (
            <li key={tag}>{tag}</li>
          ))}
        </ul>
      )}
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
        <button
          type="button"
          class="icon-button"
          title={t(chosenTags.length > 0 ? "notes.changeLabels" : "notes.addLabel")}
          aria-label={t(chosenTags.length > 0 ? "notes.changeLabels" : "notes.addLabel")}
          onClick={() => setPicking(true)}
        >
          <LabelIcon />
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
      {picking && (
        <LabelPicker labels={labels} chosen={chosenTags} onChoose={setTags} onClose={() => setPicking(false)} />
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

/** A shared note's body as the draft shows it. Once someone shows or hides
 * checkboxes, `checkboxes` says which for everyone. Until then the draft
 * keeps its kind, so plain text stays plain as someone types "- [ ]" into
 * it. A list shows as text when its text no longer reads as one. */
function liveDraft(previous: Draft, body: string, checkboxes: boolean | undefined): Draft {
  if (checkboxes ?? previous.items !== null) {
    if (body.trim() === "") return { ...previous, text: "", items: [{ checked: false, text: "" }] };
    if (isChecklist(body)) return { ...previous, text: "", items: readChecklist(body) };
  }
  return { ...previous, text: body, items: null };
}

/** A shared note's body for a draft. Empty items stay, so a new item
 * someone is about to type into reaches everyone else. */
function liveBody(draft: Draft): string {
  return draft.items ? writeChecklist(draft.items) : draft.text;
}

/** A note open for editing. A shared note is edited together with
 * everyone else who has it open, live. */
export function NoteEditor({
  id,
  me,
  labels,
  onChanged,
  onTrash,
  onMove,
  onShare,
  onClose,
}: {
  id: string;
  /** The reader's name, which others editing a shared note see. */
  me: string;
  labels: readonly string[];
  /** Chooses a folder for the note. */
  onMove: (note: Note) => void;
  /** Shares the note with people. */
  onShare: (note: Note) => void;
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
  const [reminding, setReminding] = useState<MenuPlace | null>(null);
  const [pickingTime, setPickingTime] = useState(false);
  /** The newest note from the server, whose hash the next save sends. */
  const latest = useRef<Note | null>(null);
  /** Saves run one after another, so each sends the hash of the one
   * before. */
  const queue = useRef<Promise<void>>(Promise.resolve());
  const timer = useRef<number | undefined>(undefined);
  /** The text that's saved, so an unchanged draft doesn't save. */
  const saved = useRef<{ title: string; body: string } | null>(null);
  /** A shared note's live document, while it's open. */
  const live = useRef<LiveNote | null>(null);
  const [liveStatus, setLiveStatus] = useState<LiveStatus | null>(null);
  const [visitors, setVisitors] = useState<Visitor[]>([]);
  /** Whether the body of a shared note changed while it was open, so an
   * untitled one is named after its new first words when it closes. */
  const bodyChanged = useRef(false);

  useEffect(() => {
    openNote(id).then(
      (opened) => {
        latest.current = opened;
        setNote(opened);
        const first = draftOf(opened);
        setDraft(first);
        saved.current = { title: first.title, body: opened.body };
        if (opened.shared) startLive(opened);
      },
      (problem) => setError(problemText(problem)),
    );
    return () => {
      window.clearTimeout(timer.current);
      live.current?.close();
      live.current = null;
    };
  }, [id]);

  // Someone else changing a shared note's color or title, or what the
  // reader may do with it, shows here as it happens. Its text comes
  // through the live document.
  useLive("drive.activity", (ids) => {
    if (live.current && (ids === null || ids.includes(id))) void refresh();
  });

  async function refresh() {
    let fresh: Note;
    try {
      fresh = await openNote(id);
    } catch {
      return;
    }
    const current = latest.current;
    if (!current) return;
    // The text and its hash stay the live document's.
    const next = { ...fresh, body: current.body, hash: current.hash };
    latest.current = next;
    setNote(next);
    const title = fresh.titled ? fresh.title : "";
    setDraft((draft) => {
      // A title the reader is changing stays theirs.
      if (!draft || draft.title !== saved.current?.title || draft.title === title) return draft;
      if (saved.current) saved.current = { ...saved.current, title };
      return { ...draft, title };
    });
  }

  function startLive(opened: Note) {
    // Whether the note's first text has arrived, after which a choice of
    // checkboxes is someone making it.
    let loaded = false;
    const note = new LiveNote(opened.id, { name: me }, (status) => {
      if (status === "live") loaded = true;
      setLiveStatus(status);
    });
    live.current = note;
    // The reader's own typing is in the draft already, so only others'
    // changes, to the text or to whether it shows checkboxes, change it.
    // The choice of checkboxes is kept with the document between sessions,
    // but the file may have changed since, so it counts only once someone
    // makes it while the reader has the note open.
    let chosen = false;
    const follow = (transaction: { local: boolean }) => {
      if (transaction.local) return;
      const body = note.body.toString();
      const checkboxes = chosen ? note.checkboxes() : undefined;
      setDraft((previous) => (previous ? liveDraft(previous, body, checkboxes) : previous));
    };
    note.body.observe((_event, transaction) => follow(transaction));
    note.view.observe((_event, transaction) => {
      if (loaded) chosen = true;
      follow(transaction);
    });
    note.awareness.on("change", () => setVisitors(note.visitors()));
  }

  /** Changes the reader's own reminder. It isn't part of the note's text,
   * so it doesn't wait for saving. From the dialog, a failure shows there. */
  async function remind(action: ReminderAction, fromDialog = false) {
    try {
      const { reminder } = await applyReminder(id, action);
      if (latest.current) {
        latest.current = { ...latest.current, reminder };
        onChanged(latest.current);
      }
      setNote((current) => current && { ...current, reminder });
      setError("");
    } catch (problem) {
      if (fromDialog) throw problem;
      setError(problemText(problem));
    }
  }

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

  /** Saves the title and text, if they changed. A shared note's text goes
   * through its live document instead, so only its title saves here. */
  function saveText(current: Draft) {
    window.clearTimeout(timer.current);
    return run(() => {
      const body = live.current ? (saved.current?.body ?? "") : bodyOf(current);
      const before = saved.current;
      if (before && before.title === current.title && before.body === body) return null;
      saved.current = { title: current.title, body };
      return live.current ? { title: current.title } : { title: current.title, body };
    });
  }

  function edit(next: Draft) {
    setDraft(next);
    setError("");
    window.clearTimeout(timer.current);
    if (live.current) {
      const body = liveBody(next);
      // Showing or hiding checkboxes switches everyone.
      const switched = draft !== null && (draft.items !== null) !== (next.items !== null);
      if (body !== live.current.body.toString() || switched) {
        live.current.setBody(body, switched ? next.items !== null : undefined);
        bodyChanged.current = true;
      }
      // Only a new title waits to save.
      if (next.title === saved.current?.title) return;
    }
    timer.current = window.setTimeout(() => void saveText(next), SAVE_AFTER_MS);
  }

  async function close() {
    if (draft) await saveText(draft);
    if (live.current) {
      live.current.close();
      live.current = null;
      // A note without a title follows its first words, which are now the
      // server's to read, so it's asked to name it again.
      if (bodyChanged.current && latest.current && !latest.current.titled && latest.current.access !== "viewer") {
        await run(() => ({ title: "" }));
      }
    }
    onClose();
  }

  /** Sends where the reader's caret is, as an offset in the body. */
  function sendCaret(caret: OwnCaret | null) {
    const note = live.current;
    if (!note) return;
    if (!caret || caret.item === undefined) {
      note.setCaret(caret);
      return;
    }
    const text = taskTexts(note.body.toString())[caret.item];
    if (text) note.setCaret({ start: text.start + caret.start, end: text.start + caret.end });
  }

  /** Others' carets, in the text box or in the list's items. */
  const carets: FieldCaret[] = [];
  if (live.current && draft && visitors.length > 0) {
    const texts = draft.items ? taskTexts(live.current.body.toString()) : null;
    for (const caret of live.current.carets()) {
      const shown = { key: caret.client, name: caret.name, color: caret.color };
      if (!texts) {
        carets.push({ ...shown, at: caret.at });
        continue;
      }
      const item = texts.findIndex((text) => caret.at >= text.start && caret.at <= text.end);
      if (item >= 0) carets.push({ ...shown, item, at: caret.at - texts[item]!.start });
    }
  }

  const readOnly = note?.access === "viewer";
  const own = note?.access === "owner";
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
          {liveStatus === "connecting" ? (
            <p class="loading">{t("shell.loading")}</p>
          ) : (
            <NoteFields
              draft={draft}
              onDraft={edit}
              readOnly={readOnly || liveStatus === "gone" || liveStatus === "signedOut"}
              carets={carets}
              onCaret={live.current ? sendCaret : undefined}
            />
          )}
          {note.tags.length > 0 && (
            <ul class="note-tags" aria-label={t("notes.labels")}>
              {note.tags.map((tag) => (
                <li key={tag}>{tag}</li>
              ))}
            </ul>
          )}
          {note.reminder && <ReminderChip reminder={note.reminder} onOpen={(button) => setReminding({ under: button })} />}
          {error && (
            <p class="error" role="alert">
              {error}
            </p>
          )}
          {liveStatus === "gone" && (
            <p class="error" role="alert">
              {t("notes.liveGone")}
            </p>
          )}
          {liveStatus === "signedOut" && (
            <p class="error" role="alert">
              {t("notes.liveSignedOut")}
            </p>
          )}
          <p class="note-edited hint" role="status">
            {liveStatus === "reconnecting"
              ? t("notes.liveReconnecting")
              : status === "saving"
                ? t("notes.saving")
                : note.owner
                  ? t(readOnly ? "notes.sharedByViewOnly" : "notes.sharedBy", { name: note.owner.name ?? t("notes.someone") })
                  : t("notes.edited", { when: formatMoment(note.modified_at) })}
          </p>
          {visitors.length > 0 && (
            <p class="note-visitors hint">
              {t("notes.alsoHere", { names: visitors.map((visitor) => visitor.name).join(", ") })}
            </p>
          )}
          <div class="note-toolbar">
            <button
              type="button"
              class="icon-button"
              title={t(note.reminder ? "notes.changeReminder" : "notes.remindMe")}
              aria-label={t(note.reminder ? "notes.changeReminder" : "notes.remindMe")}
              aria-haspopup="menu"
              onClick={(event) => setReminding({ under: event.currentTarget })}
            >
              <ReminderIcon />
            </button>
            {!readOnly && (
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
            )}
            <button type="button" class="icon-button" title={t("notes.addLabel")} aria-label={t("notes.addLabel")} onClick={() => setPicking(true)}>
              <LabelIcon />
            </button>
            {own && (
              <button
                type="button"
                class="icon-button"
                title={t("notes.share")}
                aria-label={t("notes.share")}
                onClick={() => {
                  window.clearTimeout(timer.current);
                  void saveText(draft).then(() => latest.current && onShare(latest.current));
                }}
              >
                <PeopleIcon />
              </button>
            )}
            {own && (
              <button
                type="button"
                class="icon-button"
                title={t("notes.moveToFolder")}
                aria-label={t("notes.moveToFolder")}
                onClick={() => {
                  window.clearTimeout(timer.current);
                  void saveText(draft).then(() => latest.current && onMove(latest.current));
                }}
              >
                <MoveIcon />
              </button>
            )}
            {!readOnly && <CheckboxToggle draft={draft} onDraft={edit} />}
            <button
              type="button"
              class="icon-button"
              title={t(note.archived ? "notes.unarchiveNote" : "notes.archiveNote")}
              aria-label={t(note.archived ? "notes.unarchiveNote" : "notes.archiveNote")}
              onClick={() => void run(() => ({ archived: !latest.current?.archived })).then(() => void close())}
            >
              <ArchiveIcon />
            </button>
            {own && (
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
            )}
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
          {reminding && (
            <ReminderMenu
              note={note}
              place={reminding}
              onAction={(action) => void remind(action)}
              onPick={() => setPickingTime(true)}
              onClose={() => setReminding(null)}
            />
          )}
          {pickingTime && (
            <ReminderDialog
              reminder={note.reminder}
              onSave={async (local, repeat) => {
                await remind({ kind: "set", local, repeat }, true);
                setPickingTime(false);
              }}
              onClose={() => setPickingTime(false)}
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
