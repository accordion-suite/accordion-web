// A note as a card in the list, as in Google Keep: its title if someone gave
// it one, its text or checklist, and its labels. Its buttons show on hover
// and on keyboard focus. Selecting the card opens the note.

import { MarkdownView } from "../drive/markdown-view.tsx";
import { t } from "../i18n.ts";
import { isChecklist, readChecklist } from "./checklist.ts";
import { ArchiveIcon, PaletteIcon, PinIcon } from "./icons.tsx";
import { TrashIcon } from "../drive/icons.tsx";
import type { Note } from "./notes-api.ts";

/** How many unchecked items a card shows. */
const CARD_ITEMS = 8;

export function NoteCard({
  note,
  onOpen,
  onPin,
  onColor,
  onArchive,
  onTrash,
  onToggle,
}: {
  note: Note;
  onOpen: () => void;
  onPin: () => void;
  onColor: (button: HTMLElement) => void;
  onArchive: () => void;
  onTrash: () => void;
  /** Ticks or unticks the `index`th item of a checklist. */
  onToggle: (index: number) => void;
}) {
  const label = note.titled ? note.title : note.title || t("notes.untitled");
  return (
    <article
      class={note.color ? `note-card note-${note.color}` : "note-card"}
      tabIndex={0}
      aria-label={label}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          onOpen();
        }
      }}
    >
      {note.titled && <h3 class="note-title">{note.title}</h3>}
      <NoteBody body={note.body} onToggle={onToggle} />
      {note.tags.length > 0 && (
        <ul class="note-tags" aria-label={t("notes.labels")}>
          {note.tags.map((tag) => (
            <li key={tag}>{tag}</li>
          ))}
        </ul>
      )}
      <button
        type="button"
        class="icon-button note-pin"
        title={t(note.pinned ? "notes.unpin" : "notes.pin")}
        aria-label={t(note.pinned ? "notes.unpin" : "notes.pin")}
        aria-pressed={note.pinned}
        onClick={(event) => {
          event.stopPropagation();
          onPin();
        }}
      >
        <PinIcon filled={note.pinned} />
      </button>
      <div class="note-actions">
        <button
          type="button"
          class="icon-button"
          title={t("notes.color")}
          aria-label={t("notes.color")}
          aria-haspopup="menu"
          onClick={(event) => {
            event.stopPropagation();
            onColor(event.currentTarget);
          }}
        >
          <PaletteIcon />
        </button>
        <button
          type="button"
          class="icon-button"
          title={t(note.archived ? "notes.unarchiveNote" : "notes.archiveNote")}
          aria-label={t(note.archived ? "notes.unarchiveNote" : "notes.archiveNote")}
          onClick={(event) => {
            event.stopPropagation();
            onArchive();
          }}
        >
          <ArchiveIcon />
        </button>
        <button
          type="button"
          class="icon-button"
          title={t("notes.toTrash")}
          aria-label={t("notes.toTrash")}
          onClick={(event) => {
            event.stopPropagation();
            onTrash();
          }}
        >
          <TrashIcon />
        </button>
      </div>
    </article>
  );
}

/** A note's text on its card: a checklist with checkboxes, or Markdown. */
export function NoteBody({ body, onToggle }: { body: string; onToggle?: (index: number) => void }) {
  if (!isChecklist(body)) {
    return body.trim() ? (
      <div class="note-body">
        <MarkdownView source={body} />
      </div>
    ) : null;
  }
  const items = readChecklist(body).map((item, index) => ({ ...item, index }));
  const open = items.filter((item) => !item.checked);
  const done = items.length - open.length;
  return (
    <div class="note-body">
      <ul class="note-checklist">
        {open.slice(0, CARD_ITEMS).map((item) => (
          <li key={item.index}>
            <input
              type="checkbox"
              aria-label={item.text}
              checked={false}
              disabled={!onToggle}
              onClick={(event) => event.stopPropagation()}
              onChange={() => onToggle?.(item.index)}
            />
            <span>{item.text}</span>
          </li>
        ))}
      </ul>
      {(open.length > CARD_ITEMS || done > 0) && (
        <p class="note-more">
          {open.length > CARD_ITEMS && <span>…</span>}
          {done > 0 && <span>{t("notes.checked", { count: done })}</span>}
        </p>
      )}
    </div>
  );
}
