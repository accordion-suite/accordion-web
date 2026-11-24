// A note as a card in the list, as in Google Keep: its title if someone gave
// it one, its text or checklist, its labels, and the reader's reminder. Its buttons show on hover
// and on keyboard focus. Selecting the card opens the note, right-clicking
// it opens its menu, and it can be dragged onto a folder in the sidebar.

import { MarkdownView } from "../drive/markdown-view.tsx";
import { holdDrag } from "../drive/move.ts";
import { t } from "../i18n.ts";
import { isChecklist, readChecklist } from "./checklist.ts";
import { useListSettings } from "./preferences.ts";
import { ArchiveIcon, LabelIcon, MicIcon, PaletteIcon, PinIcon, ReminderIcon } from "./icons.tsx";
import { MoreIcon, MoveIcon, PeopleIcon, TrashIcon } from "../drive/icons.tsx";
import type { Note } from "./notes-api.ts";
import { decodeTarget, imageTarget, imageUrl, isImageName, isSoundName, splitImages } from "./note-images.ts";
import { ReminderChip } from "./reminder-menu.tsx";

/** How many items a card shows. */
const CARD_ITEMS = 8;

export function NoteCard({
  note,
  onOpen,
  onPin,
  onColor,
  onLabels,
  onMove,
  onArchive,
  onTrash,
  onToggle,
  onShare,
  onReminder,
  onMenu,
  onMore,
  onDrag,
  menuOpen = false,
}: {
  note: Note;
  /** Opens the note's menu, for a right-click or the context menu key. */
  onMenu?: (event: MouseEvent) => void;
  /** Opens the note's menu under `button`, which a card too narrow for all
   * its buttons shows instead of some of them. */
  onMore?: (button: HTMLElement) => void;
  /** Starts or ends a drag of the note, with null at the end. */
  onDrag?: (dragging: Note | null) => void;
  /** Whether its menu is open, which marks the card. */
  menuOpen?: boolean;
  onOpen: () => void;
  onPin: () => void;
  onColor: (button: HTMLElement) => void;
  /** Chooses the note's labels. */
  onLabels: () => void;
  /** Chooses a folder for the note. */
  onMove: () => void;
  onArchive: () => void;
  onTrash: () => void;
  /** Ticks or unticks the `index`th item of a checklist. Not given for a
   * viewer. */
  onToggle?: (index: number) => void;
  /** Shares the note, which only its owner can. */
  onShare?: () => void;
  /** Opens the reader's own reminder menu, under `button`. */
  onReminder?: (button: HTMLElement) => void;
}) {
  const label = note.titled ? note.title : note.title || t("notes.untitled");
  const own = note.access === "owner";
  const shown = splitImages(note.body).lines.map((line) => imageTarget(line) ?? "");
  const cover = shown.find(isImageName);
  const memos = shown.filter(isSoundName).length;
  const ownerName = note.owner?.name ?? t("notes.someone");
  return (
    <article
      class={["note-card", note.color && `note-${note.color}`, menuOpen && "menu-open"].filter(Boolean).join(" ")}
      tabIndex={0}
      aria-label={label}
      onClick={onOpen}
      onContextMenu={(event) => {
        if (!onMenu || (event.target as Element).closest("input")) return;
        event.preventDefault();
        onMenu(event);
      }}
      draggable={!!onDrag}
      onDragStart={(event) => {
        if (!onDrag) return;
        event.dataTransfer!.effectAllowed = "move";
        event.dataTransfer!.setData("text/plain", label);
        holdDrag(event, label);
        onDrag(note);
      }}
      onDragEnd={() => onDrag?.(null)}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          onOpen();
        }
      }}
    >
      {cover && <Cover src={imageUrl(note.id, cover, "small")} />}
      {note.titled && <h3 class="note-title">{note.title}</h3>}
      <NoteBody body={note.body} note={note.id} onToggle={onToggle} />
      {memos > 0 && (
        <p class="note-memo-count hint">
          <MicIcon />
          {t("notes.memos", { count: memos })}
        </p>
      )}
      {note.tags.length > 0 && (
        <ul class="note-tags" aria-label={t("notes.labels")}>
          {note.tags.map((tag) => (
            <li key={tag}>{tag}</li>
          ))}
        </ul>
      )}
      {note.reminder && onReminder && <ReminderChip reminder={note.reminder} onOpen={onReminder} />}
      {(note.owner || note.shared) && (
        <p class="note-sharing">
          {note.owner ? (
            <span class="avatar tiny" title={t("notes.sharedBy", { name: ownerName })} aria-label={t("notes.sharedBy", { name: ownerName })}>
              {[...ownerName.trim()][0]?.toUpperCase() ?? "?"}
            </span>
          ) : (
            <span class="note-shared-mark" title={t("notes.sharedWithOthers")} aria-label={t("notes.sharedWithOthers")}>
              <PeopleIcon />
            </span>
          )}
        </p>
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
        {onReminder && (
          <button
            type="button"
            class="icon-button"
            title={t(note.reminder ? "notes.changeReminder" : "notes.remindMe")}
            aria-label={t(note.reminder ? "notes.changeReminder" : "notes.remindMe")}
            aria-haspopup="menu"
            onClick={(event) => {
              event.stopPropagation();
              onReminder(event.currentTarget);
            }}
          >
            <ReminderIcon />
          </button>
        )}
        {note.access !== "viewer" && (
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
        )}
        <button
          type="button"
          class="icon-button note-action-extra"
          title={t(note.tags.length > 0 ? "notes.changeLabels" : "notes.addLabel")}
          aria-label={t(note.tags.length > 0 ? "notes.changeLabels" : "notes.addLabel")}
          onClick={(event) => {
            event.stopPropagation();
            onLabels();
          }}
        >
          <LabelIcon />
        </button>
        {own && onShare && (
          <button
            type="button"
            class="icon-button note-action-extra"
            title={t("notes.share")}
            aria-label={t("notes.share")}
            onClick={(event) => {
              event.stopPropagation();
              onShare();
            }}
          >
            <PeopleIcon />
          </button>
        )}
        {own && (
          <button
            type="button"
            class="icon-button note-action-extra"
            title={t("notes.moveToFolder")}
            aria-label={t("notes.moveToFolder")}
            onClick={(event) => {
              event.stopPropagation();
              onMove();
            }}
          >
            <MoveIcon />
          </button>
        )}
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
        {own && (
          <button
            type="button"
            class="icon-button note-action-extra"
            title={t("notes.toTrash")}
            aria-label={t("notes.toTrash")}
            onClick={(event) => {
              event.stopPropagation();
              onTrash();
            }}
          >
            <TrashIcon />
          </button>
        )}
        {onMore && (
          <button
            type="button"
            class="icon-button note-action-more"
            title={t("notes.more")}
            aria-label={t("drive.moreActions", { name: label })}
            aria-haspopup="menu"
            onClick={(event) => {
              event.stopPropagation();
              onMore(event.currentTarget);
            }}
          >
            <MoreIcon />
          </button>
        )}
      </div>
    </article>
  );
}

/** A note's first picture, across the top of its card. A picture that
 * can't be shown, such as one moved out of Notes, leaves no gap. */
function Cover({ src }: { src: string }) {
  return (
    <div class="note-cover">
      <img
        src={src}
        alt=""
        loading="lazy"
        onError={(event) => ((event.currentTarget.parentElement as HTMLElement).hidden = true)}
      />
    </div>
  );
}

/** A note's text on its card, below its pictures: a checklist with
 * checkboxes, or Markdown. `note` shows pictures further down the text,
 * and a note in the trash, without it, shows none. */
export function NoteBody({ body: whole, note, onToggle }: { body: string; note?: string; onToggle?: (index: number) => void }) {
  const settings = useListSettings();
  const body = splitImages(whole).rest;
  if (!isChecklist(body)) {
    return body.trim() ? (
      <div class="note-body">
        <MarkdownView breaks source={body} pictures={note ? (target) => imageUrl(note, decodeTarget(target), "small") : undefined} />
      </div>
    ) : null;
  }
  const items = readChecklist(body).map((item, index) => ({ ...item, index }));
  // With checked items at the bottom, the card shows only the others and
  // counts the checked ones. Otherwise every item shows where it is.
  const open = settings.checked_at_bottom ? items.filter((item) => !item.checked) : items;
  const done = settings.checked_at_bottom ? items.length - open.length : 0;
  return (
    <div class="note-body">
      <ul class="note-checklist">
        {open.slice(0, CARD_ITEMS).map((item) => (
          <li key={item.index} class={item.checked ? "checked" : undefined} style={{ "--depth": String(item.depth ?? 0) }}>
            <input
              type="checkbox"
              aria-label={item.text}
              checked={item.checked}
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
