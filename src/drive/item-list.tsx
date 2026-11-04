// A list of files and folders, as rows or as a grid, and what can be done to
// them: opening, downloading, sharing, renaming, copying, moving, starring,
// and moving to the trash. Each item's menus offer only what the reader may
// do with it, so a viewer of someone else's folder sees no Rename. Those are
// in each item's ⋮ menu and its right-click menu, and on keys for what's
// selected, or by dragging onto a folder.
//
// As in Google Drive, a click selects an item and a double-click opens it,
// with Ctrl, Cmd, and Shift for more than one, and a box drawn across empty
// space (selection.ts). On a touch screen, a tap opens, and a long press
// starts selecting. Files open in the viewer, over the list, with the list's
// other files a step away. Downloading is in the menus and the viewer, never
// a side effect of opening.
//
// Every page with items uses this, so they all work the same. A list that
// reaches across folders, such as search results, says where each item is.

import type { ComponentChildren, TargetedMouseEvent } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";

import { ApiError, api } from "../api.ts";
import { formatDate, formatSize, t } from "../i18n.ts";
import { Menu, type MenuEntry, type MenuPlace, SEPARATOR } from "../shell/menu.tsx";
import { followLink, navigate, useQuery } from "../shell/router.ts";
import { ConfirmDialog } from "../shell/dialog.tsx";
import { ColorDialog, MoveDialog, NameDialog, ShareDialog, VersionsDialog } from "./dialogs.tsx";
import {
  CloseIcon,
  DownloadIcon,
  GridIcon,
  InfoIcon,
  ItemIcon,
  ListIcon,
  MoreIcon,
  MoveIcon,
  PeopleIcon,
  RenameIcon,
  SortIcon,
  StarIcon,
  TrashIcon,
} from "./icons.tsx";
import { type Found, type Hit, type Item, type SharedOut, canEdit } from "./item.ts";
import { typing, useDrive } from "./layout.tsx";
import { freeName } from "./names.ts";
import { useDriveSettings } from "./preferences.ts";
import { dropProps, endDrag, naming, startDrag } from "./move.ts";
import { nextSort, type SortKey, sortItems } from "./sort.ts";
import { clearFilters, FilterBar, useFilters } from "./filter-bar.tsx";
import { matches } from "./filters.ts";
import { neighbor, range, useSelectionBand } from "./selection.ts";
import { announceChange, type SortScope, useDetailsOpen, useSort, useViewMode } from "./store.ts";
import { Viewer } from "./viewer.tsx";

/** A folder's page. My Drive has its own address. */
export function folderPath(item: Pick<Item, "id" | "parent">): string {
  return item.parent === null ? "/drive/my-drive" : `/drive/folder/${item.id}`;
}

/** The folder an item is in, from a list that says where items are.
 * Something shared with the reader on its own is in Shared with me. */
function locationPath(item: Found): string {
  if (item.folders.length > 0) return `/drive/folder/${item.parent}`;
  return item.owner === null ? "/drive/my-drive" : "/drive/shared";
}

/** This page's address with `file` open in the viewer. */
function filePath(file: Item): string {
  const query = new URLSearchParams(location.search);
  query.set("file", file.id);
  return `${location.pathname}?${query}`;
}

/** Marks a history entry that the viewer opened from the list, so closing
 * it can go back rather than add another entry. */
const OPENED_HERE = { viewer: true };

/** Saves a file as it is, or a folder or several items as one ZIP file, as
 * Google Drive does. The server builds the ZIP as it sends it. */
function download(items: readonly Item[]) {
  const link = document.createElement("a");
  const only = items.length === 1 ? items[0]! : null;
  if (only?.kind === "file") {
    link.href = `/api/drive/items/${only.id}/content`;
    link.download = only.name;
  } else {
    link.href = `/api/drive/zip?ids=${items.map((item) => item.id).join(",")}`;
  }
  link.click();
}

function located(item: Item | Found): item is Found {
  return "folders" in item;
}

/** Who an item is shared with, as short as fits a column: the first
 * person's name, and how many more. */
function sharedWithText(item: SharedOut): string {
  const [first, ...more] = item.shared_with;
  const people = !first
    ? ""
    : more.length === 0
      ? first.display_name
      : t("sharedByMe.withMore", { name: first.display_name, count: more.length });
  if (item.links === 0) return people;
  const links = t("sharedByMe.links", { count: item.links });
  return people ? t("sharedByMe.withLinks", { people, links }) : links;
}

/** Everyone an item is shared with, and its links, for the tooltip. */
function sharedWithTitle(item: SharedOut): string {
  const names = item.shared_with.map((share) => share.display_name);
  if (item.links > 0) names.push(t("sharedByMe.links", { count: item.links }));
  return names.join(", ");
}


const ARROWS = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
type Arrow = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight";

/** Whether a key, rather than the pointer, pressed a button. A click from
 * Enter or Space counts no presses. */
function keyed(event: MouseEvent): boolean {
  return event.detail === 0;
}

/** An open menu. `owner` names the button that opened it, if one did. */
interface OpenMenu {
  label: string;
  entries: MenuEntry[];
  place: MenuPlace;
  byKeyboard: boolean;
  owner?: string;
}

type Open =
  | { kind: "rename"; item: Item }
  | { kind: "move"; items: Item[] }
  | { kind: "versions"; item: Item }
  | { kind: "share"; item: Item }
  | { kind: "unshare"; item: Item }
  | { kind: "color"; item: Item };

export function ItemList({
  items: all,
  label,
  location: showLocation = false,
  owners = false,
  shares = false,
  empty,
  sortScope,
  toolbar,
}: {
  items: readonly (Item | Found)[];
  /** Names the list for screen readers, such as the folder's name. */
  label: string;
  /** Whether to show where each item is. */
  location?: boolean;
  /** Whether that's who owns each item instead, for Shared with me. */
  owners?: boolean;
  /** Whether to show who each item is shared with and when, for Shared by
   * me, in place of when it changed. */
  shares?: boolean;
  /** What to say when there are no items at all. */
  empty?: string;
  /** Which sort to remember, when the page isn't a folder or a search,
   * such as the storage page, which starts largest first. */
  sortScope?: SortScope;
  /** Filters in place of the list's own, for the search page, whose server
   * applies them all, so the list shows every item it's given. */
  toolbar?: ComponentChildren;
}) {
  const settings = useDriveSettings();
  const thumbnails = settings?.thumbnails ?? true;
  const clickAction = settings?.click ?? "select";
  const drive = useDrive();
  const filters = useFilters();
  // The same list until the items or the filters change, since effects
  // below run when it does.
  const items = useMemo(
    () => (toolbar ? all : all.filter((item) => matches(item, filters))),
    [all, filters.type, filters.people, filters.modified, filters.source],
  );
  const [mode] = useViewMode();
  const [sort, setSort] = useSort(sortScope ?? (showLocation ? "found" : "folder"));
  const [dropOn, setDropOn] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  /** Where a Shift range starts: the item last chosen on its own. */
  const anchor = useRef<string | null>(null);
  /** What the last press was, since a tap on a touch screen opens. */
  const pointer = useRef("mouse");
  const root = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const [open, setOpen] = useState<Open | null>(null);
  const [, setDetailsOpen] = useDetailsOpen();
  const showing = useQuery("file");
  // The shortcuts need what's shown now, so the list sets them each time.
  const shortcuts = useRef<((event: KeyboardEvent) => void) | null>(null);

  useEffect(() => {
    const keys = (event: KeyboardEvent) => shortcuts.current?.(event);
    document.addEventListener("keydown", keys);
    return () => document.removeEventListener("keydown", keys);
  }, []);

  // Drops what's no longer here, such as a file moved elsewhere.
  useEffect(() => {
    const here = new Set(items.map((item) => item.id));
    setSelected((before) => new Set([...before].filter((id) => here.has(id))));
  }, [items]);

  const chosenItems = items.filter((item) => selected.has(item.id));
  const chosenEditable = chosenItems.every(canEdit);

  // The details panel shows what's selected, as it is after each reload.
  useEffect(() => drive.select(chosenItems), [items, selected]);
  useEffect(() => () => drive.select([]), []);
  // The grid and the viewer's Previous and Next follow the list's sort too.
  const ordered = sortItems(items, sort);
  const shown = ordered.filter((item) => item.kind === "file");
  const folders = ordered.filter((item) => item.kind === "folder");
  const files = shown;
  const shownFile = shown.find((file) => file.id === showing);

  function openItem(item: Item) {
    if (item.kind === "folder") navigate(folderPath(item));
    else navigate(filePath(item), { state: OPENED_HERE });
  }

  /** What a click does when it doesn't select: download a file, if the
   * reader chose that, or open the item. */
  function activate(item: Item) {
    if (clickAction === "download" && item.kind === "file") download([item]);
    else openItem(item);
  }

  function closeFile() {
    if ((history.state as typeof OPENED_HERE | null)?.viewer) {
      history.back();
    } else {
      // Opened from a link or a reload, so there's nothing to go back to.
      const query = new URLSearchParams(location.search);
      query.delete("file");
      const rest = query.toString();
      navigate(rest ? `${location.pathname}?${rest}` : location.pathname, { replace: true });
    }
  }

  function done(message: string, undo?: () => Promise<void>) {
    drive.notify({ message, undo });
    announceChange();
  }

  function failed(failure: unknown) {
    drive.notify({ message: failure instanceof Error ? failure.message : t("error.problem"), problem: true });
    announceChange();
  }

  async function trash(chosen: Item[]) {
    try {
      for (const item of chosen) await api("DELETE", `/api/drive/items/${item.id}`);
      // Someone else's items go to their owner's trash, and only the owner
      // can restore them.
      if (chosen.some((item) => item.access !== "owner")) {
        done(naming(chosen, "drive.trashedSharedOne", "drive.trashedSharedMany"));
        return;
      }
      done(naming(chosen, "drive.trashedOne", "drive.trashedMany"), async () => {
        for (const item of chosen) await api("POST", `/api/drive/items/${item.id}/restore`);
        drive.notify({ message: naming(chosen, "drive.restoredOne", "drive.restoredMany") });
      });
    } catch (failure) {
      failed(failure);
    }
  }

  async function star(chosen: Item[], on: boolean) {
    try {
      for (const item of chosen) await api(on ? "PUT" : "DELETE", `/api/drive/items/${item.id}/star`);
      done(
        on
          ? naming(chosen, "drive.starredOne", "drive.starredMany")
          : naming(chosen, "drive.unstarredOne", "drive.unstarredMany"),
      );
    } catch (failure) {
      failed(failure);
    }
  }

  /** Copies a file into its own folder as "Copy of …", as Google Drive does,
   * with a number if that's taken. A file in a folder the reader can't add
   * to goes to My Drive, where the server picks the number. */
  async function copy(item: Item) {
    const name = t("drive.copyName", { name: item.name });
    const toMyDrive = async () => {
      const made = await api<Item>("POST", `/api/drive/items/${item.id}/copy`, { name });
      done(t("drive.copiedToMyDrive", { name: made.name }));
    };
    try {
      if (!canEdit(item)) return await toMyDrive();
      for (let tries = 0; ; tries++) {
        let siblings: Item[];
        try {
          siblings = await api<Item[]>("GET", `/api/drive/items/${item.parent}/children`);
        } catch (problem) {
          // Shared on its own, so the folder it's in isn't the reader's.
          if (problem instanceof ApiError && problem.status === 404) return await toMyDrive();
          throw problem;
        }
        const free = freeName(name, new Set(siblings.map((child) => child.name)));
        try {
          await api("POST", `/api/drive/items/${item.id}/copy`, { name: free });
          done(t("drive.copied", { name: free }));
          return;
        } catch (problem) {
          // Something took the name since the folder was listed.
          if (!(problem instanceof ApiError) || problem.status !== 409 || tries > 2) throw problem;
        }
      }
    } catch (failure) {
      failed(failure);
    }
  }

  /** What an action on `item` applies to: everything selected, if it's
   * among them, or else just the item. */
  function targets(item: Item): Item[] {
    return selected.has(item.id) && chosenItems.length > 1 ? chosenItems : [item];
  }

  function itemEntries(chosen: Item[]): MenuEntry[] {
    const starring = chosen.some((item) => !item.starred);
    const starEntry: MenuEntry = {
      label: starring ? t("drive.addStar") : t("drive.removeStar"),
      onSelect: () => star(chosen, starring),
    };
    const editable = chosen.every(canEdit);
    if (chosen.length > 1) {
      const entries: MenuEntry[] = [];
      if (editable) {
        entries.push({
          label: t("drive.moveMany", { count: chosen.length }),
          onSelect: () => setOpen({ kind: "move", items: chosen }),
        });
      }
      entries.push({ label: t("viewer.download"), onSelect: () => download(chosen) }, starEntry);
      if (editable) {
        entries.push(SEPARATOR, {
          label: t("drive.trashMany", { count: chosen.length }),
          shortcut: "Delete",
          onSelect: () => trash(chosen),
        });
      }
      return entries;
    }
    const item = chosen[0]!;
    const entries: MenuEntry[] = [];
    if (item.kind === "folder") {
      entries.push(
        { label: t("drive.open"), onSelect: () => navigate(folderPath(item)) },
        { label: t("viewer.download"), onSelect: () => download(chosen) },
      );
    } else {
      entries.push(
        { label: t("drive.open"), onSelect: () => navigate(filePath(item), { state: OPENED_HERE }) },
        { label: t("viewer.download"), onSelect: () => download(chosen) },
      );
      // Viewers see only the current version, as in Google Drive.
      if (editable) {
        entries.push({ label: t("drive.manageVersions"), onSelect: () => setOpen({ kind: "versions", item }) });
      }
    }
    entries.push({
      label: t("details.title"),
      onSelect: () => {
        setSelected(new Set([item.id]));
        setDetailsOpen(true);
      },
    });
    entries.push(SEPARATOR);
    // Editors share by link. Only the owner shares with people.
    if (item.access !== "viewer") entries.push({ label: t("share.open"), onSelect: () => setOpen({ kind: "share", item }) });
    if (item.access === "owner" && item.shared) {
      entries.push({ label: t("sharedByMe.stop"), onSelect: () => setOpen({ kind: "unshare", item }) });
    }
    if (item.kind === "folder") entries.push({ label: t("color.open"), onSelect: () => setOpen({ kind: "color", item }) });
    if (editable) {
      entries.push({ label: t("drive.rename"), shortcut: "F2", onSelect: () => setOpen({ kind: "rename", item }) });
    }
    if (item.kind === "file") entries.push({ label: t("drive.makeCopy"), onSelect: () => copy(item) });
    if (editable) entries.push({ label: t("drive.move"), onSelect: () => setOpen({ kind: "move", items: chosen }) });
    entries.push(starEntry);
    if (located(item)) {
      entries.push({ label: t("drive.showLocation"), onSelect: () => navigate(locationPath(item)) });
    }
    if (editable) {
      entries.push(SEPARATOR, { label: t("drive.toTrash"), shortcut: "Delete", onSelect: () => trash(chosen) });
    }
    return entries;
  }

  function itemMenu(item: Item, place: MenuPlace, byKeyboard: boolean, owner?: string): OpenMenu {
    const chosen = targets(item);
    const label =
      chosen.length > 1 ? t("drive.actionsForMany", { count: chosen.length }) : t("drive.actionsFor", { name: item.name });
    return { label, entries: itemEntries(chosen), place, byKeyboard, owner };
  }

  /** Right-clicking an item, or the context menu key on one. Empty space is
   * left to the page. */
  function contextMenu(event: TargetedMouseEvent<HTMLElement>) {
    const target = event.target as Element;
    const holder = target.closest<HTMLElement>("[data-id]");
    const item = holder && items.find((child) => child.id === holder.dataset["id"]);
    if (!item || typing(target)) return;
    event.preventDefault();
    event.stopPropagation();
    // The context menu key may give no position, so the menu opens under
    // the item.
    // A long press on a touch screen starts selecting, and the ⋮ button
    // has the menu.
    if (pointer.current === "touch") {
      anchor.current = item.id;
      toggle(item.id);
      return;
    }
    // As in Google Drive, the menu is for what's selected, so an item
    // outside it becomes the selection.
    if (!selected.has(item.id)) {
      anchor.current = item.id;
      setSelected(new Set([item.id]));
    }
    const byKeyboard = !event.clientX && !event.clientY;
    const place: MenuPlace = byKeyboard ? { under: holder } : { x: event.clientX, y: event.clientY };
    setMenu(itemMenu(item, place, byKeyboard));
  }

  shortcuts.current = (event) => {
    if (open || menu || shownFile || typing(event.target)) return;
    if (event.target instanceof Element && event.target.closest("dialog")) return;
    const command = event.ctrlKey || event.metaKey;
    const focused = (document.activeElement as Element | null)?.closest<HTMLElement>("[data-id]");
    const focusedItem = focused && items.find((item) => item.id === focused.dataset["id"]);
    const chosen = chosenItems.length > 0 ? chosenItems : focusedItem ? [focusedItem] : [];
    if (event.key === "Delete" || (event.key === "Backspace" && event.metaKey)) {
      if (chosen.length === 0 || !chosen.every(canEdit)) return;
      void trash(chosen);
    } else if (event.key === "F2") {
      if (chosen.length !== 1 || !canEdit(chosen[0]!)) return;
      setOpen({ kind: "rename", item: chosen[0]! });
    } else if (command && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "a") {
      setSelected(new Set(items.map((item) => item.id)));
    } else if (event.key === "Escape" && selected.size > 0) {
      setSelected(new Set());
    } else if (focusedItem && event.key === " " && !event.altKey) {
      anchor.current = focusedItem.id;
      toggle(focusedItem.id);
    } else if (focusedItem && ARROWS.includes(event.key) && !event.altKey) {
      // In a list, left and right are for scrolling across.
      if (mode === "list" && (event.key === "ArrowLeft" || event.key === "ArrowRight")) return;
      const next = arrowTo(focusedItem.id, event.key as Arrow);
      if (!next) return;
      focusItem(next);
      if (event.shiftKey) {
        selectRange(next, command);
      } else if (!command) {
        anchor.current = next;
        setSelected(new Set([next]));
      }
    } else {
      return;
    }
    event.preventDefault();
  };

  /** The items' IDs in the order they're shown, folders first in a grid. */
  const order = (mode === "list" ? ordered : [...folders, ...files]).map((item) => item.id);

  /** Where an arrow key goes from `id`, by where the items are on the
   * screen. */
  function arrowTo(id: string, key: Arrow): string | null {
    const boxes = [...(root.current?.querySelectorAll<HTMLElement>("[data-id]") ?? [])].map((element) => {
      const rect = element.getBoundingClientRect();
      return { id: element.dataset["id"]!, box: rect };
    });
    return neighbor(boxes, id, key);
  }

  function focusItem(id: string) {
    const link = root.current?.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"] [data-open]`);
    link?.focus();
    link?.scrollIntoView({ block: "nearest" });
  }

  /** Selects from the anchor to `id`, adding to what's selected with
   * `adding`. The anchor stays, so the range can grow or shrink. */
  function selectRange(id: string, adding: boolean) {
    const ids = range(order, anchor.current, id);
    if (anchor.current === null) anchor.current = id;
    setSelected((before) => new Set([...(adding ? before : []), ...ids]));
  }

  /** A click on an item: selects it, or with Ctrl, Cmd, or Shift, more
   * than one. In Settings, the reader can choose for a click to open or
   * download instead. On a touch screen, a tap opens or downloads, unless
   * something's selected already. Other links and buttons in the item do
   * their own thing. */
  function itemClick(event: MouseEvent, item: Item) {
    const control = (event.target as Element).closest("a, button");
    if (keyed(event) || (control && !control.hasAttribute("data-open"))) return;
    if (pointer.current === "touch") {
      if (selected.size === 0) {
        activate(item);
      } else {
        anchor.current = item.id;
        toggle(item.id);
      }
      return;
    }
    if (event.shiftKey) {
      selectRange(item.id, event.ctrlKey || event.metaKey);
    } else if (event.ctrlKey || event.metaKey) {
      anchor.current = item.id;
      toggle(item.id);
    } else if (clickAction === "select") {
      anchor.current = item.id;
      setSelected(new Set([item.id]));
    } else if (event.detail === 1) {
      // The second click of a double click would open or download again.
      activate(item);
    }
  }

  function itemDoubleClick(event: MouseEvent, item: Item) {
    const control = (event.target as Element).closest("a, button");
    if (pointer.current === "touch" || clickAction !== "select") return;
    if (control && !control.hasAttribute("data-open")) return;
    if (event.ctrlKey || event.metaKey || event.shiftKey) return;
    openItem(item);
  }

  /** What each item's element needs for choosing and opening it. */
  function choosing(item: Item) {
    return {
      onClick: (event: MouseEvent) => itemClick(event, item),
      onDblClick: (event: MouseEvent) => itemDoubleClick(event, item),
    };
  }

  /** What was selected when a box started, which it adds to with Ctrl,
   * Cmd, or Shift. */
  const bandBase = useRef<ReadonlySet<string> | null>(null);
  const band = useSelectionBand(root, {
    allowed: () => !open && !menu && !shownFile,
    touch: (ids, adding) => {
      setSelected((before) => {
        const base = adding ? (bandBase.current ??= before) : new Set<string>();
        return new Set([...base, ...ids]);
      });
    },
    click: (adding) => {
      if (!adding) setSelected(new Set());
    },
  });
  if (!band) bandBase.current = null;

  function toggle(id: string) {
    setSelected((before) => {
      const next = new Set(before);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  /** The item's name, as a link to it. A click selects the item, and Enter
   * opens it. A middle click opens it in a new tab, as links do. */
  function nameLink(item: Item, className?: string) {
    return (
      <a
        class={className}
        href={item.kind === "folder" ? folderPath(item) : filePath(item)}
        data-open
        draggable={false}
        onClick={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          if (keyed(event)) openItem(item);
        }}
      >
        {item.name}
        {selected.has(item.id) && <span class="visually-hidden">{t("drive.selectedMark")}</span>}
      </a>
    );
  }

  function moreButton(item: Item) {
    return (
      <button
        type="button"
        class="icon-button more"
        aria-label={t("drive.moreActions", { name: item.name })}
        aria-haspopup="menu"
        aria-expanded={menu?.owner === item.id}
        onClick={(event) => setMenu(itemMenu(item, { under: event.currentTarget }, keyed(event), item.id))}
      >
        <MoreIcon />
      </button>
    );
  }

  /** Marks for a starred item, and for one the reader shared, apart from
   * on Shared by me, where everything is. A shared folder's icon shows
   * it's shared, so only screen readers get its mark. */
  function starMark(item: Item) {
    const shared = item.shared && !shares;
    if (!shared && !item.starred) return null;
    return (
      <span class="marks">
        {shared &&
          (item.kind === "folder" ? (
            <span class="visually-hidden">{t("share.sharedMark")}</span>
          ) : (
            <span class="shared-mark" title={t("share.sharedMark")}>
              <PeopleIcon />
              <span class="visually-hidden">{t("share.sharedMark")}</span>
            </span>
          ))}
        {item.starred && (
          <span class="star-mark" title={t("drive.starred")}>
            <StarIcon filled />
            <span class="visually-hidden">{t("drive.starred")}</span>
          </span>
        )}
      </span>
    );
  }

  function where(item: Item | Found) {
    if (!located(item)) return null;
    if (owners) return <span>{item.owner}</span>;
    const path = [item.owner === null ? t("drive.myDrive") : t("shared.title"), ...item.folders];
    return (
      <a href={locationPath(item)} onClick={followLink} title={path.join(" › ")}>
        {path[path.length - 1]}
      </a>
    );
  }

  /** What lets an item be dragged onto a folder, with everything selected
   * if it's selected, and lets a folder take a drag. */
  function dragging(item: Item) {
    return {
      draggable: canEdit(item),
      onDragStart: (event: DragEvent) => {
        // As in Google Drive, dragging an item outside the selection
        // selects it instead.
        if (!selected.has(item.id)) {
          anchor.current = item.id;
          setSelected(new Set([item.id]));
        }
        startDrag(event, selected.has(item.id) ? chosenItems : [item]);
      },
      onDragEnd: () => {
        endDrag();
        setDropOn(null);
      },
      ...(item.kind === "folder" && canEdit(item) ? dropProps(item, setDropOn, drive.notify) : {}),
    };
  }

  /** An item's classes: whether it's selected, and whether a drag is over
   * it. */
  function classes(item: Item, base = "") {
    return [base, selected.has(item.id) && "selected", dropOn === item.id && "drop-target"].filter(Boolean).join(" ") || undefined;
  }

  /** A column's header, which sorts the list by that column. */
  function header(key: SortKey, name: string, className?: string) {
    const active = sort?.key === key ? sort : null;
    return (
      <th
        scope="col"
        class={className}
        aria-sort={active ? (active.descending ? "descending" : "ascending") : undefined}
      >
        <button type="button" class="sort-button" onClick={() => setSort(nextSort(sort, key))}>
          {name}
          {active && <SortIcon descending={active.descending} />}
        </button>
      </th>
    );
  }

  return (
    <div
      class="item-list"
      ref={root}
      onContextMenu={contextMenu}
      onPointerDown={(event) => (pointer.current = event.pointerType)}
    >
      {/* Filters fill the row until something is selected, then the
          selection's actions take their place, so selecting doesn't move
          the items under the pointer. */}
      <div class="list-toolbar">
        {chosenItems.length === 0 ? (
          (toolbar ?? <FilterBar
            items={all}
            filters={filters}
            // The storage page lists only the reader's own files.
            source={showLocation && !owners && !shares && sortScope !== "storage"}
            mine={!owners}
            shares={shares}
          />)
        ) : (
          <div class="selection-bar" role="group" aria-label={t("drive.selection")}>
            <button
              type="button"
              class="icon-button"
              aria-label={t("drive.clearSelection")}
              onClick={() => setSelected(new Set())}
            >
              <CloseIcon />
            </button>
            <span class="selection-count">{t("drive.selected", { count: chosenItems.length })}</span>
            {/* Icons with names in tooltips, as in Google Drive, so the bar
                fits on one line and never pushes the list down. */}
            {chosenItems.length === 1 && chosenEditable && (
              <BarButton label={t("drive.rename")} onClick={() => setOpen({ kind: "rename", item: chosenItems[0]! })}>
                <RenameIcon />
              </BarButton>
            )}
            {chosenEditable && (
              <BarButton label={t("drive.move")} onClick={() => setOpen({ kind: "move", items: chosenItems })}>
                <MoveIcon />
              </BarButton>
            )}
            <BarButton label={t("viewer.download")} onClick={() => download(chosenItems)}>
              <DownloadIcon />
            </BarButton>
            {chosenItems.some((item) => !item.starred) ? (
              <BarButton label={t("drive.addStar")} onClick={() => star(chosenItems, true)}>
                <StarIcon />
              </BarButton>
            ) : (
              <BarButton label={t("drive.removeStar")} onClick={() => star(chosenItems, false)}>
                <StarIcon filled />
              </BarButton>
            )}
            {chosenEditable && (
              <BarButton label={t("drive.toTrash")} onClick={() => trash(chosenItems)}>
                <TrashIcon />
              </BarButton>
            )}
          </div>
        )}
      </div>

      {items.length === 0 ? (
        <div class="empty">
          {all.length > 0 ? (
            <>
              <p class="hint">{t("filters.none")}</p>
              <button type="button" class="secondary" onClick={clearFilters}>
                {t("search.clearFilters")}
              </button>
            </>
          ) : (
            <p class="hint">{empty}</p>
          )}
        </div>
      ) : mode === "list" ? (
        <table class="items" aria-label={label}>
          <thead>
            <tr>
              {header("name", t("drive.name"))}
              {showLocation && header("location", owners ? t("shared.owner") : t("drive.location"), "location")}
              {shares && header("with", t("sharedByMe.with"), "with")}
              {shares
                ? header("shared", t("sharedByMe.sharedOn"), "modified")
                : header("modified", t("drive.modified"), "modified")}
              {header("size", t("drive.size"), "size")}
              <td class="more-cell" />
            </tr>
          </thead>
          <tbody>
            {ordered.map((item) => (
              <tr key={item.id} data-id={item.id} class={classes(item)} {...dragging(item)} {...choosing(item)}>
                <th scope="row">
                  <span class="name-cell">
                    <ItemIcon item={item} />
                    {nameLink(item, "item-name")}
                    {starMark(item)}
                  </span>
                  <Snippet item={item} />
                </th>
                {showLocation && <td class="location">{where(item)}</td>}
                {shares && (
                  <td class="with" title={sharedWithTitle(item as SharedOut)}>
                    {sharedWithText(item as SharedOut)}
                  </td>
                )}
                <td class="modified">{formatDate(shares ? (item as SharedOut).shared_at : item.modified_at)}</td>
                <td class="size">{item.size === null ? "—" : formatSize(item.size)}</td>
                <td class="more-cell">{moreButton(item)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div class="grid-view" role="group" aria-label={label}>
          {folders.length > 0 && (
            <section>
              <h2 class="section-title">{t("drive.folders")}</h2>
              <ul class="tiles">
                {folders.map((item) => (
                  <li
                    key={item.id}
                    data-id={item.id}
                    class={classes(item, "tile")}
                    {...dragging(item)}
                    {...choosing(item)}
                  >
                    <ItemIcon item={item} />
                    {nameLink(item, "tile-name")}
                    {starMark(item)}
                    {moreButton(item)}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {files.length > 0 && (
            <section>
              <h2 class="section-title">{t("drive.files")}</h2>
              <ul class="cards">
                {files.map((item) => (
                  <li
                    key={item.id}
                    data-id={item.id}
                    class={classes(item, "card")}
                    {...dragging(item)}
                    {...choosing(item)}
                  >
                    <div class="card-top">
                      <ItemIcon item={item} />
                      {nameLink(item, "tile-name")}
                      {starMark(item)}
                      {moreButton(item)}
                    </div>
                    {thumbnails && <CardPreview item={item} />}
                    <Snippet item={item} />
                    <p class="card-meta">
                      {located(item) ? where(item) : formatDate(item.modified_at)}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      {band && (
        <div
          class="selection-band"
          style={{
            left: `${band.left}px`,
            top: `${band.top}px`,
            width: `${Math.max(0, band.right - band.left)}px`,
            height: `${Math.max(0, band.bottom - band.top)}px`,
          }}
        />
      )}
      {menu && (
        <Menu
          label={menu.label}
          entries={menu.entries}
          place={menu.place}
          byKeyboard={menu.byKeyboard}
          onClose={() => setMenu(null)}
        />
      )}
      {open?.kind === "rename" && (
        <NameDialog
          title={t("drive.renameNamed", { name: open.item.name })}
          submit={t("drive.rename")}
          initial={open.item.name}
          file={open.item.kind === "file"}
          onSubmit={async (name) => {
            const { id, name: before } = open.item;
            await api("PATCH", `/api/drive/items/${id}`, { name });
            setOpen(null);
            done(t("drive.renamed", { name }), async () => {
              await api("PATCH", `/api/drive/items/${id}`, { name: before });
            });
          }}
          onClose={() => setOpen(null)}
        />
      )}
      {open?.kind === "move" && (
        <MoveDialog
          items={open.items}
          onMoved={(to, id) => {
            setOpen(null);
            // Each goes back to the folder it came from.
            const moved = open.items.filter((item) => item.parent !== id);
            done(naming(open.items, "drive.movedOne", "drive.movedMany", to), async () => {
              for (const item of moved) await api("PATCH", `/api/drive/items/${item.id}`, { parent: item.parent });
            });
          }}
          onClose={() => setOpen(null)}
        />
      )}
      {open?.kind === "share" && (
        <ShareDialog
          item={open.item}
          onClose={(changed) => {
            setOpen(null);
            if (changed) announceChange();
          }}
        />
      )}
      {open?.kind === "unshare" && (
        <ConfirmDialog
          title={t("sharedByMe.stopTitle", { name: open.item.name })}
          body={t("sharedByMe.stopBody")}
          confirm={t("sharedByMe.stop")}
          onConfirm={async () => {
            await api("DELETE", `/api/drive/items/${open.item.id}/shares`);
            setOpen(null);
            done(t("sharedByMe.stopped", { name: open.item.name }));
          }}
          onClose={() => setOpen(null)}
        />
      )}
      {open?.kind === "color" && (
        <ColorDialog
          item={open.item}
          onChosen={() => {
            setOpen(null);
            announceChange();
          }}
          onClose={() => setOpen(null)}
        />
      )}
      {open?.kind === "versions" && (
        <VersionsDialog
          item={open.item}
          onRestored={(number) => {
            setOpen(null);
            done(t("drive.restoredVersion", { number, name: open.item.name }));
          }}
          onClose={() => setOpen(null)}
        />
      )}
      {shownFile && (
        <Viewer
          files={shown}
          file={shownFile}
          // Steps replace the entry, so Back closes the viewer.
          onShow={(file) => navigate(filePath(file), { replace: true, state: history.state })}
          onClose={closeFile}
        />
      )}
    </div>
  );
}

/** An action in the selection bar: an icon, with its name in a tooltip and
 * for screen readers. */
function BarButton({ label, onClick, children }: { label: string; onClick: () => void; children: ComponentChildren }) {
  return (
    <button type="button" class="icon-button" aria-label={label} title={label} onClick={onClick}>
      {children}
    </button>
  );
}

/** The picture on a grid card: the file's thumbnail if the server has one,
 * or a large icon that shows what kind of file it is. The card's name link
 * covers it, so screen readers skip it. */
export function CardPreview({ item }: { item: Item }) {
  const [failed, setFailed] = useState(false);
  const kind = item.sha256 && !failed ? item.thumbnail : null;
  // The hash changes with each version, so browsers keep each thumbnail
  // and fetch a new one when the file changes.
  const src = `/api/drive/items/${item.id}/thumbnail?v=${item.sha256}`;
  const page = item.preview === "pdf" || item.preview === "document" ? " is-page" : "";
  return (
    <div class={kind ? `card-preview has-thumbnail has-${kind}${page}` : "card-preview"} aria-hidden="true">
      {kind === "picture" ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
        />
      ) : kind === "text" ? (
        <TextPreview src={src} onError={() => setFailed(true)} />
      ) : (
        <ItemIcon item={item} />
      )}
    </div>
  );
}

/** A text file's first lines, drawn as a small page. Like a lazy image, it
 * waits until the card is nearly on screen, so a folder of a thousand notes
 * doesn't fetch them all at once. */
function TextPreview({ src, onError }: { src: string; onError: () => void }) {
  const page = useRef<HTMLPreElement>(null);
  const [text, setText] = useState("");
  useEffect(() => {
    const element = page.current;
    if (!element) return;
    let current = true;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        fetch(src)
          .then((response) => (response.ok ? response.text() : Promise.reject()))
          .then((lines) => current && setText(lines))
          .catch(() => current && onError());
      },
      { rootMargin: "200px" },
    );
    observer.observe(element);
    return () => {
      current = false;
      observer.disconnect();
    };
  }, [src]);
  return (
    <pre ref={page} class="card-text">
      {text}
    </pre>
  );
}

/** The buttons beside a page's title: one that opens the details panel, and
 * the switch between rows and a grid. */
/** A line of text from inside a search result, around the words it
 * matched, which are marked. */
function Snippet({ item }: { item: Item | Found }) {
  const pieces = "snippet" in item ? (item as Hit).snippet : null;
  if (!pieces?.length) return null;
  return (
    <span class="snippet">
      {pieces.map((piece, index) => (piece.matched ? <mark key={index}>{piece.text}</mark> : piece.text))}
    </span>
  );
}

export function PageTools() {
  const drive = useDrive();
  const [detailsOpen, setDetailsOpen] = useDetailsOpen();
  useEffect(() => {
    drive.offerDetails(true);
    return () => drive.offerDetails(false);
  }, []);
  return (
    <div class="page-tools">
      <button
        type="button"
        class="icon-button"
        aria-pressed={detailsOpen}
        aria-label={t("details.show")}
        title={t("details.show")}
        onClick={() => setDetailsOpen(!detailsOpen)}
      >
        <InfoIcon />
      </button>
      <ViewToggle />
    </div>
  );
}

/** Switches every list between rows and a grid. */
function ViewToggle() {
  const [mode, setMode] = useViewMode();
  return (
    <div class="view-toggle" role="group" aria-label={t("drive.layout")}>
      <button
        type="button"
        aria-pressed={mode === "list"}
        aria-label={t("drive.listView")}
        title={t("drive.listView")}
        onClick={() => setMode("list")}
      >
        <ListIcon />
      </button>
      <button
        type="button"
        aria-pressed={mode === "grid"}
        aria-label={t("drive.gridView")}
        title={t("drive.gridView")}
        onClick={() => setMode("grid")}
      >
        <GridIcon />
      </button>
    </div>
  );
}
