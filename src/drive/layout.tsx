// Drive's frame around each of its pages: the top bar with search, and the
// sidebar with New, the places to go, the folders in My Drive, and how much
// space is used. Notices, such as "Moved to the trash", appear along the
// bottom, with Undo where something can be undone. Ctrl+Z and Ctrl+Y go
// back and forth through the changes made in the tab, after their notices
// are gone too. The details panel, when it's open, is a column on the
// right.
//
// Right-clicking My Drive in the sidebar opens New's menu for it, and
// right-clicking a folder under it opens the menu that folder has in a
// list, so the sidebar works like the page.
//
// New works the same on every page. It uploads into, or makes a folder in,
// the folder that's open, or My Drive on pages that aren't a folder or in a
// folder the reader can only view, as in Google Drive. A page says which
// folder that is with `useTarget`. Files dropped on a folder's page, or on
// Home, upload there too.

import type {
  ComponentChildren,
  TargetedDragEvent,
  TargetedEvent,
  TargetedKeyboardEvent,
  TargetedMouseEvent,
} from "preact";
import { createContext } from "preact";
import { useContext, useEffect, useRef, useState } from "preact/hooks";

import { api, send, type Session } from "../api.ts";
import { formatSize, t } from "../i18n.ts";
import { Menu, type MenuEntry, type MenuPlace } from "../shell/menu.tsx";
import { followLink, navigate, usePath, useQueryString } from "../shell/router.ts";
import { TopBar } from "../shell/top-bar.tsx";
import { hasClipped, pasteInto, pastingClipped } from "./clipboard.ts";
import { type DetailsTab, DetailsPanel } from "./details.tsx";
import { ClashDialog, NameDialog, ShortcutsDialog } from "./dialogs.tsx";
import {
  type Child,
  type Folders,
  type Tree,
  chosenTree,
  clashes,
  droppedTree,
  httpFolders,
  placeTree,
} from "./folder-upload.ts";
import { uploads } from "./http-transport.ts";
import {
  ChevronIcon,
  CloseIcon,
  CloudIcon,
  DriveIcon,
  HomeIcon,
  ItemIcon,
  NewFolderIcon,
  NewTextIcon,
  PeopleIcon,
  SharedOutIcon,
  PlusIcon,
  StarIcon,
  TrashIcon,
  UploadFileIcon,
  UploadFolderIcon,
} from "./icons.tsx";
import { folderPath, useItemActions } from "./item-actions.tsx";
import type { Item } from "./item.ts";
import { dropProps } from "./move.ts";
import { SearchBox } from "./search-box.tsx";
import { announceChange, focusNextList, useChanges, useDetailsOpen, useViewMode } from "./store.ts";
import { goToUploads } from "./upload-panel.tsx";
import { finished } from "./uploads.ts";

/** Something to tell the reader, such as what just changed. */
export interface Notice {
  message: string;
  /** A problem stays until it's closed. Other notices go after a while. */
  problem?: boolean;
  /** Undoes the change, from the notice's Undo button or Ctrl+Z. A notice
   * with it goes in the tab's history of changes. */
  undo?: () => Promise<void>;
  /** Does the change again once it's undone, from the Redo button or
   * Ctrl+Y. A change that can't be done again leaves it out. */
  redo?: () => Promise<void>;
  /** What the notice says once the change is undone, if not "Undone:"
   * and the notice's message. */
  undone?: string;
  /** For the notice that says a change was undone: the change, which
   * Redo does again. */
  again?: Notice;
}

interface DriveFrame {
  /** Tells the frame which folder New uses, whether drops upload into it,
   * and the IDs of the folders down to it, for the sidebar. */
  setTarget(folder: Item | null, drops: boolean, trail: readonly string[]): void;
  /** The menu that New opens, for a page's own right-click menu. */
  newEntries(): MenuEntry[];
  notify(notice: Notice | null): void;
  /** Tells the details panel what's selected on the page. */
  select(items: readonly Item[]): void;
  /** Tells the details panel what the page is about, for when nothing is
   * selected, such as the folder that's open. */
  setPageItem(item: Item | null): void;
  /** Says whether the page has the details panel. Pages that offer it show
   * the button that opens it. */
  offerDetails(offered: boolean): void;
  /** Opens a folder's right-click menu, as the sidebar does: New's menu
   * for My Drive, and the folder's actions for any other folder. */
  folderMenu(folder: Item, event: TargetedMouseEvent<HTMLElement>): void;
  /** The folder whose right-click menu is open, for its place to show it. */
  menuOn: string | null;
}

const Frame = createContext<DriveFrame | null>(null);

export function useDrive(): DriveFrame {
  const frame = useContext(Frame);
  if (!frame) throw new Error("A Drive page is outside DriveLayout.");
  return frame;
}

/** Makes `folder` the one New and drops use while the page is open. Null
 * means My Drive. */
export function useTarget(folder: Item | null, drops: boolean, trail: readonly string[] = []): void {
  const drive = useDrive();
  const key = [folder?.id ?? "", drops, ...trail].join("/");
  useEffect(() => drive.setTarget(folder, drops, trail), [key]);
}

/** Drive's folders, with the files still in the upload queue counted as
 * there, so uploading the same file twice in a row asks too. */
const foldersWithQueue: Folders = {
  create: httpFolders.create,
  async children(parent) {
    const queued = uploads.uploads
      .filter((upload) => upload.folder.id === parent && !finished(upload.state))
      .map((upload): Child => ({ name: upload.name, kind: "file" }));
    return [...(await httpFolders.children(parent)), ...queued];
  },
};

/** Whether a drag holds files from the device, rather than, say, text. */
function holdsFiles(event: DragEvent): boolean {
  return event.dataTransfer?.types.includes("Files") ?? false;
}

/** Whether a key press is meant for a text field rather than the page. */
export function typing(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest("input:not([type=checkbox]), textarea, [contenteditable]") !== null;
}

type Open =
  | { kind: "newFolder"; into: Item }
  | { kind: "newText"; into: Item }
  | { kind: "shortcuts" }
  | { kind: "clash"; clashes: Child[]; answer: (replace: boolean | null) => void };

/** How long a notice stays, unless it's a problem. */
const NOTICE_MS = 8000;

/** How many changes Ctrl+Z can go back through. */
const HISTORY_SIZE = 50;

/** The changes made in this tab that can be undone, newest last, and the
 * ones undone that can be done again, the last one undone last. They stay
 * until the tab reloads, so they're still there after a visit to another
 * app. Making a new change clears what can be done again, as in a text
 * editor. */
const history = { done: [] as Notice[], undone: [] as Notice[] };

/** Whether an undo or redo is still going, so pressing Ctrl+Z quickly
 * doesn't undo two changes at once, which could clash. */
let undoing = false;

/** How long the second key of a two-key shortcut, such as Alt+C then F,
 * can wait. */
const CHORD_MS = 2000;

export function DriveLayout({
  session,
  onSignOut,
  children,
}: {
  session: Session;
  onSignOut: () => void;
  children: ComponentChildren;
}) {
  const path = usePath();
  const query = useQueryString();
  useEffect(() => {
    lastPage = path + query;
  }, [path, query]);
  const [top, setTop] = useState<Item | null>(null);
  const [target, setTargetState] = useState<{ folder: Item | null; drops: boolean; trail: readonly string[] }>({
    folder: null,
    drops: false,
    trail: [],
  });
  const [open, setOpen] = useState<Open | null>(null);
  /** New's menu, for the folder that's open or, from the sidebar, `into`. */
  const [menu, setMenu] = useState<{ place: MenuPlace; byKeyboard: boolean; into?: Item } | null>(null);
  /** A sidebar folder's right-click menu. */
  const [folderMenu, setFolderMenu] = useState<{ folder: Item; place: MenuPlace; byKeyboard: boolean } | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [dropping, setDropping] = useState(false);
  const [dropOn, setDropOn] = useState<string | null>(null);
  const [, setShown] = useState(0);
  const myDriveOpen = expanded.has(MY_DRIVE);
  // Opening a folder in My Drive opens My Drive in the sidebar, once, so
  // the reader can still close it while they're there.
  useEffect(() => {
    if (top && target.trail.includes(top.id) && !expanded.has(MY_DRIVE)) {
      expanded.add(MY_DRIVE);
      setShown((count) => count + 1);
    }
  }, [top, target.trail]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const sharedCounts = useSharedCounts();
  const [selection, setSelection] = useState<readonly Item[]>([]);
  const [pageItem, setPageItem] = useState<Item | null>(null);
  const [detailsOffered, setDetailsOffered] = useState(false);
  const [detailsOpen, setDetailsOpen] = useDetailsOpen();
  const showDetails = detailsOpen && detailsOffered;
  const [detailsTab, setDetailsTab] = useState<DetailsTab>("details");
  const dragDepth = useRef(0);
  const chooser = useRef<HTMLInputElement>(null);
  const folderChooser = useRef<HTMLInputElement>(null);
  /** The folder the chooser's files go to, when it isn't the one open. */
  const chooseInto = useRef<Item | null>(null);
  const noticeTimer = useRef<number | undefined>(undefined);
  // A sidebar folder's menu is the one it has in a list.
  const folderActions = useItemActions({
    notify,
    // The folder's page shows it in the details panel.
    details: (folder) => {
      navigate(folderPath(folder));
      setDetailsOpen(true);
    },
    // Trashing the open folder, or one it's in, goes to the folder that
    // held it, since the page can't show it anymore.
    trashed: (items) => {
      const gone = items.find((item) => target.trail.includes(item.id));
      if (gone?.parent) navigate(gone.parent === top?.id ? "/drive/my-drive" : `/drive/folder/${gone.parent}`);
    },
  });

  useEffect(() => {
    api<Item>("GET", "/api/drive/top").then(setTop, (problem: Error) =>
      notify({ message: problem.message, problem: true }),
    );
    // Lists show a file as soon as its upload finishes.
    return uploads.onFinished(() => announceChange());
  }, []);

  // A page on a phone starts with the sidebar out of the way.
  useEffect(() => setSidebarOpen(false), [path]);

  // A file pasted on a page, such as a screenshot, uploads there, as one
  // dropped does. Items cut or copied in Drive move or copy there.
  useEffect(() => {
    const paste = (event: ClipboardEvent) => {
      if (typing(event.target)) return;
      if (event.target instanceof Element && event.target.closest("dialog")) return;
      if (pastingClipped(event)) {
        event.preventDefault();
        if (!target.drops || !target.folder) notify({ message: t("drive.pasteWhere"), problem: true });
        else void pasteInto(target.folder, nameOf(target.folder), notify);
        return;
      }
      const files = [...(event.clipboardData?.files ?? [])];
      if (!target.drops || files.length === 0) return;
      event.preventDefault();
      notify(null);
      void upload({ files: files.map((file) => ({ file, path: [] })), folders: [] });
    };
    document.addEventListener("paste", paste);
    return () => document.removeEventListener("paste", paste);
  });

  // Keys for anywhere in Drive, as in Google Drive: "/" goes to the search
  // box, "?" or Ctrl+/ lists the shortcuts, and Alt+N opens New. Alt+C,
  // Alt+G, and Alt+V start two-key shortcuts, for creating, going to a part
  // of the page, and showing or hiding one. Alt is Option on a Mac, which
  // changes the letter a key types, so they go by the key's place.
  const chord = useRef<{ prefix: string; at: number } | null>(null);
  const newButton = useRef<HTMLButtonElement>(null);
  const [viewMode, setViewMode] = useViewMode();
  const pageKeys = useRef<(event: KeyboardEvent) => void>(() => undefined);
  pageKeys.current = (event) => {
    if (typing(event.target) || document.querySelector("dialog[open]")) return;
    if (["Alt", "Shift", "Control", "Meta"].includes(event.key)) return;
    const letter = event.code.startsWith("Key") ? event.code.slice(3).toLowerCase() : "";
    const started = chord.current;
    chord.current = null;
    const command = event.ctrlKey || event.metaKey;
    if (started && Date.now() - started.at < CHORD_MS && letter && !command) {
      if (!secondKey(started.prefix, letter)) return;
    } else if (event.altKey && !command && !event.shiftKey && ["c", "g", "v"].includes(letter)) {
      chord.current = { prefix: letter, at: Date.now() };
    } else if (event.altKey && !command && !event.shiftKey && letter === "n") {
      if (!here || !newButton.current) return;
      setMenu({ place: { under: newButton.current }, byKeyboard: true });
    } else if (command && !event.altKey && event.key === "/") {
      setOpen({ kind: "shortcuts" });
    } else if (command || event.altKey) {
      return;
    } else if (event.key === "/") {
      document.querySelector<HTMLInputElement>(".search input")?.focus();
    } else if (event.key === "?") {
      setOpen({ kind: "shortcuts" });
    } else {
      return;
    }
    event.preventDefault();
  };

  /** Moves through the sidebar's places and folders with the arrow keys,
   * as in a file manager's folder tree: up and down go from one to the
   * next, right opens a folder or goes into it, and left closes it or goes
   * to the folder it's in. Enter opens one, as links do. */
  function sidebarKeys(event: TargetedKeyboardEvent<HTMLElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const link = (event.target as Element).closest<HTMLElement>(".place");
    if (!link) return;
    const links = [...event.currentTarget.querySelectorAll<HTMLElement>(".place")];
    const index = links.indexOf(link);
    const row = link.closest(".place-row");
    const toggle = row?.querySelector<HTMLButtonElement>(".tree-toggle");
    const isOpen = toggle?.getAttribute("aria-expanded") === "true";
    let next: HTMLElement | null | undefined;
    if (event.key === "Enter") {
      // The link opens the page, and its first item takes the focus. The
      // page that's open already only needs the focus.
      const here = link.getAttribute("aria-current") === "page";
      if (here) event.preventDefault();
      focusNextList(here);
      return;
    }
    if (event.key === "ArrowDown") next = links[index + 1];
    else if (event.key === "ArrowUp") next = links[index - 1];
    else if (event.key === "Home") next = links[0];
    else if (event.key === "End") next = links[links.length - 1];
    else if (event.key === "ArrowRight") {
      // A folder's folders load after it opens, so a second press goes in.
      if (toggle && !isOpen) toggle.click();
      else if (isOpen) next = row?.parentElement?.querySelector<HTMLElement>(":scope > .tree .place");
    } else if (event.key === "ArrowLeft") {
      if (toggle && isOpen) toggle.click();
      else next = link.closest(".tree")?.parentElement?.querySelector<HTMLElement>(":scope > .place-row > .place");
    } else return;
    event.preventDefault();
    next?.focus();
  }

  /** Does the second key of a two-key shortcut, and says whether it was
   * one. */
  function secondKey(prefix: string, letter: string): boolean {
    const shortcut = `${prefix} ${letter}`;
    if (prefix === "c") {
      if (!here) return false;
      if (letter === "f") setOpen({ kind: "newFolder", into: here });
      else if (letter === "t") setOpen({ kind: "newText", into: here });
      else if (letter === "u" || letter === "i") {
        chooseInto.current = here;
        (letter === "u" ? chooser : folderChooser).current?.click();
      } else return false;
    } else if (shortcut === "g n" || shortcut === "g f") {
      // Google Drive has both: N for the navigation panel, and F for the
      // folders in it.
      setSidebarOpen(true);
      const places = document.querySelector("#sidebar");
      const place =
        places?.querySelector<HTMLElement>('.place[aria-current="page"]') ?? places?.querySelector<HTMLElement>(".place");
      place?.focus();
    } else if (shortcut === "g i") {
      const list = document.querySelector(".item-list");
      const item =
        list?.querySelector<HTMLElement>(".selected [data-open]") ?? list?.querySelector<HTMLElement>("[data-open]");
      item?.focus();
    } else if (shortcut === "g d") {
      if (!detailsOffered) return false;
      setDetailsOpen(true);
      requestAnimationFrame(() => document.querySelector<HTMLElement>(".details")?.focus());
    } else if (shortcut === "g u") {
      return goToUploads();
    } else if (shortcut === "v l") {
      setViewMode(viewMode === "list" ? "grid" : "list");
    } else if (shortcut === "v d" || shortcut === "v a") {
      // As Google Drive's details and activity panes: each shows the panel
      // on its tab, or hides it if it's showing that tab already.
      if (!detailsOffered) return false;
      const tab = shortcut === "v d" ? "details" : "activity";
      const showing = detailsOpen && detailsTab === tab;
      setDetailsTab(tab);
      setDetailsOpen(!showing);
    } else {
      return false;
    }
    return true;
  }

  // These come before the list's keys, which skip what they've done, so the
  // F in Alt+G then F doesn't also jump to a file starting with F.
  useEffect(() => {
    const keys = (event: KeyboardEvent) => pageKeys.current(event);
    document.addEventListener("keydown", keys, true);
    return () => document.removeEventListener("keydown", keys, true);
  }, []);

  // Ctrl+Z undoes the last change, as the notice's Undo button does, even
  // once the notice is gone, and pressing it again goes further back.
  // Ctrl+Y or Ctrl+Shift+Z does the last change undone again, as Redo does.
  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || typing(event.target)) return;
      if (event.target instanceof Element && event.target.closest("dialog")) return;
      const key = event.key.toLowerCase();
      if (key === "z" && !event.shiftKey && history.done.length > 0) {
        event.preventDefault();
        void undo();
      } else if ((key === "y" || (key === "z" && event.shiftKey)) && history.undone.length > 0) {
        event.preventDefault();
        void redo();
      }
    };
    document.addEventListener("keydown", keys);
    return () => document.removeEventListener("keydown", keys);
  }, []);

  /** Shows a notice, and keeps a change that can be undone in the history. */
  function notify(next: Notice | null) {
    if (next?.undo) {
      history.done = [...history.done, next].slice(-HISTORY_SIZE);
      history.undone = [];
    }
    show(next);
  }

  function show(next: Notice | null) {
    clearTimeout(noticeTimer.current);
    setNotice(next);
    if (next && !next.problem) noticeTimer.current = window.setTimeout(() => setNotice(null), NOTICE_MS);
  }

  /** Undoes the last change, then says what it undid, with Redo if it can be
   * done again. Since it might be a change from a while ago, the notice
   * names it. */
  async function undo() {
    const change = history.done.at(-1);
    if (!change || undoing) return;
    undoing = true;
    history.done = history.done.slice(0, -1);
    show(null);
    try {
      await change.undo!();
      // A change that can't be done again stops Redo going past it.
      history.undone = change.redo ? [...history.undone, change] : [];
      show({
        message: change.undone ?? t("drive.undoneChange", { change: change.message }),
        again: change.redo ? change : undefined,
      });
    } catch (failure) {
      show({ message: (failure as Error).message, problem: true });
    }
    undoing = false;
    announceChange();
  }

  /** Does the last change undone again, and shows its notice again, with
   * Undo. */
  async function redo() {
    const change = history.undone.at(-1);
    if (!change || undoing) return;
    undoing = true;
    history.undone = history.undone.slice(0, -1);
    show(null);
    try {
      await change.redo!();
      history.done = [...history.done, change].slice(-HISTORY_SIZE);
      show(change);
    } catch (failure) {
      show({ message: (failure as Error).message, problem: true });
    }
    undoing = false;
    announceChange();
  }

  const here = target.folder ?? top;
  const hereName = here ? nameOf(here) : t("drive.myDrive");

  /** Asks whether to replace what has the upload's names, or keep both.
   * Null means cancel. */
  function ask(found: Child[]): Promise<boolean | null> {
    return new Promise((answer) => setOpen({ kind: "clash", clashes: found, answer }));
  }

  /** Uploads files and folders into `folder`, or the target folder, making
   * the folders first. */
  async function upload(tree: Tree, folder: Item | null = here) {
    if (!folder) return;
    const into = { id: folder.id, name: nameOf(folder), top: folder.parent === null };
    let placed;
    try {
      const found = clashes(tree, await foldersWithQueue.children(into.id));
      const replace = found.length > 0 ? await ask(found) : false;
      if (replace === null) return;
      placed = await placeTree(into, tree, replace, foldersWithQueue);
    } catch (failure) {
      notify({ message: (failure as Error).message, problem: true });
      return;
    }
    if (placed.some((file) => file.folder.id !== into.id) || tree.folders.length > 0) announceChange();
    const byFolder = new Map<string, typeof placed>();
    for (const file of placed) {
      byFolder.set(file.folder.id, [...(byFolder.get(file.folder.id) ?? []), file]);
    }
    // The panel links to My Drive by its own address, which placeTree
    // doesn't know about.
    for (const files of byFolder.values()) {
      const folder = files[0]!.folder;
      uploads.add(files, folder.id === into.id ? into : folder);
    }
  }

  function chosen(event: TargetedEvent<HTMLInputElement>, folders: boolean) {
    notify(null);
    const into = chooseInto.current ?? here;
    chooseInto.current = null;
    const files = [...(event.currentTarget.files ?? [])];
    // A chosen folder brings only its files, so an empty one brings
    // nothing, and the browser doesn't say so.
    if (folders && files.length === 0) notify({ message: t("drive.emptyFolder"), problem: true });
    else void upload(folders ? chosenTree(files) : { files: files.map((file) => ({ file, path: [] })), folders: [] }, into);
    // Lets the same files be chosen again.
    event.currentTarget.value = "";
  }

  /** New's menu, for `into` or the target folder. A right-click menu also
   * has Paste, when something's cut or copied. */
  function newEntries(into: Item | null = here, paste = false): MenuEntry[] {
    if (!into) return [];
    const choose = (input: HTMLInputElement | null) => {
      chooseInto.current = into;
      input?.click();
    };
    const pasting: MenuEntry[] =
      paste && hasClipped()
        ? [
            "separator",
            { label: t("drive.paste"), shortcut: "Ctrl+V", onSelect: () => void pasteInto(into, nameOf(into), notify) },
          ]
        : [];
    return [
      { label: t("drive.newFolder"), icon: <NewFolderIcon />, onSelect: () => setOpen({ kind: "newFolder", into }) },
      { label: t("drive.newText"), icon: <NewTextIcon />, onSelect: () => setOpen({ kind: "newText", into }) },
      "separator",
      { label: t("drive.upload"), icon: <UploadFileIcon />, onSelect: () => choose(chooser.current) },
      { label: t("drive.uploadFolder"), icon: <UploadFolderIcon />, onSelect: () => choose(folderChooser.current) },
      ...pasting,
    ];
  }

  /** Where a right-click menu opens: at the pointer, or under `holder` for
   * the context menu key, which gives no position. */
  function menuPlace(event: MouseEvent, holder: Element): { place: MenuPlace; byKeyboard: boolean } {
    const byKeyboard = !event.clientX && !event.clientY;
    return { place: byKeyboard ? { under: holder } : { x: event.clientX, y: event.clientY }, byKeyboard };
  }

  /** Right-clicking a folder in the sidebar opens the menu it has in a
   * list. */
  function openFolderMenu(folder: Item, event: TargetedMouseEvent<HTMLElement>) {
    event.preventDefault();
    setMenu(null);
    setFolderMenu({ folder, ...menuPlace(event, event.currentTarget) });
  }

  /** Right-clicking My Drive opens New's menu for it, as right-clicking
   * empty space on its page does. */
  function openNewMenu(top: Item, event: TargetedMouseEvent<HTMLElement>) {
    event.preventDefault();
    setFolderMenu(null);
    setMenu({ ...menuPlace(event, event.currentTarget), into: top });
  }

  function dragEnter(event: TargetedDragEvent<HTMLElement>) {
    if (!target.drops || !holdsFiles(event)) return;
    event.preventDefault();
    dragDepth.current += 1;
    setDropping(true);
  }

  function dragOver(event: TargetedDragEvent<HTMLElement>) {
    if (!target.drops || !holdsFiles(event)) return;
    event.preventDefault();
    event.dataTransfer!.dropEffect = "copy";
  }

  function dragLeave(event: TargetedDragEvent<HTMLElement>) {
    if (!target.drops || !holdsFiles(event)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDropping(false);
  }

  function drop(event: TargetedDragEvent<HTMLElement>) {
    if (!target.drops || !holdsFiles(event)) return;
    event.preventDefault();
    dragDepth.current = 0;
    setDropping(false);
    notify(null);
    const reading = droppedTree(event.dataTransfer!.items);
    if (reading) {
      reading.then(upload, (failure: Error) => notify({ message: failure.message, problem: true }));
    } else {
      // A browser that can't read folders from a drop still gives files.
      void upload({ files: [...event.dataTransfer!.files].map((file) => ({ file, path: [] })), folders: [] });
    }
  }

  const frame: DriveFrame = {
    setTarget: (folder, drops, trail) => setTargetState({ folder, drops, trail }),
    newEntries: () => newEntries(here, true),
    notify,
    select: setSelection,
    setPageItem,
    offerDetails: setDetailsOffered,
    folderMenu: (folder, event) =>
      folder.parent === null ? openNewMenu(folder, event) : openFolderMenu(folder, event),
    menuOn: folderMenu?.folder.id ?? menu?.into?.id ?? null,
  };

  return (
    <Frame.Provider value={frame}>
      <div class={["frame", sidebarOpen && "sidebar-open", showDetails && "details-open"].filter(Boolean).join(" ")}>
        <TopBar
          session={session}
          onSignOut={onSignOut}
          settings="/settings/drive"
          menuOpen={sidebarOpen}
          onMenu={() => setSidebarOpen(!sidebarOpen)}
        >
          <SearchBox />
        </TopBar>
        <nav id="sidebar" class="sidebar" aria-label={t("drive.places")} onKeyDown={sidebarKeys}>
          <button
            ref={newButton}
            type="button"
            class="new-button"
            aria-haspopup="menu"
            aria-expanded={menu !== null && !menu.into}
            onClick={(event) =>
              setMenu({ place: { under: event.currentTarget }, byKeyboard: event.detail === 0 })
            }
          >
            <PlusIcon />
            {t("drive.new")}
          </button>
          <ul class="places">
            <Place href="/drive/" current={path === "/drive/"} icon={<HomeIcon />}>
              {t("drive.home")}
            </Place>
            <li>
              <div
                class={
                  ["place-row", top && dropOn === top.id && "drop-target", menu?.into && menu.into === top && "menu-open"]
                    .filter(Boolean)
                    .join(" ")
                }
                {...(top ? dropProps({ id: top.id, name: t("drive.myDrive") }, setDropOn, notify) : {})}
                onContextMenu={(event) => top && openNewMenu(top, event)}
              >
                {top && (
                  <button
                    type="button"
                    class="tree-toggle place-toggle"
                    aria-expanded={myDriveOpen}
                    aria-label={t(myDriveOpen ? "drive.collapse" : "drive.expand", { name: t("drive.myDrive") })}
                    onClick={() => {
                      if (myDriveOpen) expanded.delete(MY_DRIVE);
                      else expanded.add(MY_DRIVE);
                      setShown((count) => count + 1);
                    }}
                  >
                    <ChevronIcon />
                  </button>
                )}
                <a
                  class="place"
                  href="/drive/my-drive"
                  onClick={followLink}
                  aria-current={path === "/drive/my-drive" ? "page" : undefined}
                >
                  <DriveIcon />
                  {t("drive.myDrive")}
                </a>
              </div>
              {top && myDriveOpen && (
                <FolderTree
                  parent={top.id}
                  trail={target.trail}
                  current={path}
                  depth={1}
                  menuOn={folderMenu?.folder.id ?? null}
                  onMenu={openFolderMenu}
                />
              )}
            </li>
            <Place
              href="/drive/shared-by-me"
              current={path === "/drive/shared-by-me"}
              icon={<SharedOutIcon />}
              count={sharedCounts.byMe}
            >
              {t("sharedByMe.title")}
            </Place>
            <Place
              href="/drive/shared"
              current={path === "/drive/shared"}
              icon={<PeopleIcon />}
              count={sharedCounts.withMe}
            >
              {t("shared.title")}
            </Place>
            <Place href="/drive/starred" current={path === "/drive/starred"} icon={<StarIcon />}>
              {t("starred.title")}
            </Place>
            <Place href="/drive/trash" current={path === "/drive/trash"} icon={<TrashIcon />}>
              {t("trash.title")}
            </Place>
            <StoragePlace current={path === "/drive/storage"} />
          </ul>
        </nav>
        {/* Closes the sidebar on a phone when the reader taps beside it. */}
        <div class="sidebar-scrim" aria-hidden="true" onClick={() => setSidebarOpen(false)} />
        <div
          class={dropping ? "frame-main dropping" : "frame-main"}
          onDragEnter={dragEnter}
          onDragOver={dragOver}
          onDragLeave={dragLeave}
          onDrop={drop}
        >
          {dropping && (
            <p class="drop-hint" aria-hidden="true">
              {t("drive.dropHere", { folder: hereName })}
            </p>
          )}
          {children}
        </div>
        {showDetails && (
          <DetailsPanel
            items={selection.length > 0 ? selection : pageItem ? [pageItem] : []}
            me={session.user.id}
            tab={detailsTab}
            onTab={setDetailsTab}
            onClose={() => setDetailsOpen(false)}
          />
        )}
        <input ref={chooser} type="file" multiple hidden onChange={(event) => chosen(event, false)} />
        <input
          ref={folderChooser}
          type="file"
          hidden
          // Chooses a folder. Every browser supports it, but Preact's types
          // don't list it yet.
          {...{ webkitdirectory: true }}
          onChange={(event) => chosen(event, true)}
        />
        <div class="notice-area" role="status">
          {notice && !notice.problem && (
            <NoticeBar
              notice={notice}
              onUndo={undo}
              onRedo={redo}
              onClose={() => notify(null)}
            />
          )}
        </div>
        <div class="notice-area" role="alert">
          {notice?.problem && <NoticeBar notice={notice} onClose={() => notify(null)} />}
        </div>
      </div>

      {menu && (
        <Menu
          label={t("drive.newIn", { folder: menu.into ? nameOf(menu.into) : hereName })}
          entries={newEntries(menu.into ?? here, !!menu.into)}
          place={menu.place}
          byKeyboard={menu.byKeyboard}
          onClose={() => setMenu(null)}
        />
      )}
      {folderMenu && (
        <Menu
          label={t("drive.actionsFor", { name: folderMenu.folder.name })}
          entries={folderActions.entries([folderMenu.folder])}
          place={folderMenu.place}
          byKeyboard={folderMenu.byKeyboard}
          onClose={() => setFolderMenu(null)}
        />
      )}
      {folderActions.dialog}
      {open?.kind === "newFolder" && (
        <NameDialog
          title={t("drive.newFolder")}
          submit={t("drive.create")}
          initial={t("drive.untitledFolder")}
          onSubmit={async (name) => {
            await api("POST", `/api/drive/items/${open.into.id}/children`, { name });
            setOpen(null);
            notify({ message: t("drive.created", { name }) });
            announceChange();
          }}
          onClose={() => setOpen(null)}
        />
      )}
      {open?.kind === "newText" && (
        <NameDialog
          title={t("drive.newTextTitle")}
          submit={t("drive.create")}
          initial={t("drive.untitledText")}
          file
          onSubmit={async (name) => {
            // The name must be free, so a new file never becomes a version
            // of one that's there.
            const file = await send<Item>("PUT", `/api/drive/items/${open.into.id}/children/${encodeURIComponent(name)}`, {
              headers: { "If-None-Match": "*" },
              body: null,
            });
            setOpen(null);
            announceChange();
            // Opens it in its folder, ready to edit. Closing it comes back
            // here.
            navigate(`${folderPath(open.into)}?file=${file.id}`, { state: { viewer: true, edit: true } });
          }}
          onClose={() => setOpen(null)}
        />
      )}
      {open?.kind === "shortcuts" && <ShortcutsDialog onClose={() => setOpen(null)} />}
      {open?.kind === "clash" && (
        <ClashDialog
          clashes={open.clashes}
          onChoose={(replace) => {
            setOpen(null);
            open.answer(replace);
          }}
          onClose={() => {
            setOpen(null);
            open.answer(null);
          }}
        />
      )}
    </Frame.Provider>
  );
}

/** A folder's name, or "My Drive" for the top folder. */
function nameOf(folder: Item): string {
  return folder.parent === null ? t("drive.myDrive") : folder.name;
}

function Place({
  href,
  current,
  icon,
  count,
  children,
}: {
  href: string;
  current: boolean;
  icon: ComponentChildren;
  /** How many items the page lists. None shows for zero, or before it
   * loads. */
  count?: number | null;
  children: ComponentChildren;
}) {
  return (
    <li>
      <div class="place-row">
        <a class="place" href={href} onClick={followLink} aria-current={current ? "page" : undefined}>
          {icon}
          {children}
          {count ? (
            <>
              <span class="place-count" aria-hidden="true">
                {count}
              </span>
              <span class="visually-hidden">{t("drive.placeCount", { count })}</span>
            </>
          ) : null}
        </a>
      </div>
    </li>
  );
}

function NoticeBar({
  notice,
  onUndo,
  onRedo,
  onClose,
}: {
  notice: Notice;
  onUndo?: () => void;
  onRedo?: () => void;
  onClose: () => void;
}) {
  return (
    <div class={notice.problem ? "notice problem" : "notice"}>
      <span>{notice.message}</span>
      {notice.undo && onUndo && (
        <button type="button" class="link notice-undo" onClick={onUndo}>
          {t("drive.undo")}
        </button>
      )}
      {notice.again?.redo && onRedo && (
        <button type="button" class="link notice-undo" onClick={onRedo}>
          {t("drive.redo")}
        </button>
      )}
      <button type="button" class="icon-button" aria-label={t("drive.closeNotice")} onClick={onClose}>
        <CloseIcon />
      </button>
    </div>
  );
}

/** The folders opened in the sidebar. They stay open while the reader moves
 * between pages. */
const expanded = new Set<string>();

/** Stands for My Drive in `expanded`. It starts closed, and opens when the
 * reader opens My Drive or a folder in it. */
const MY_DRIVE = "my-drive";

/** The address of the Drive page the reader was last on, such as a
 * folder, so Settings can lead back to it. */
let lastPage: string | null = null;

export function lastDrivePage(): string | null {
  return lastPage;
}

/** Closes the sidebar's folders and forgets the last page, which belong to
 * whoever was signed in before. */
export function forgetSidebar(): void {
  expanded.clear();
  lastPage = null;
}

/** The folders inside `parent`, each of which can open to show its own. */
function FolderTree({
  parent,
  trail,
  current,
  depth,
  menuOn,
  onMenu,
}: {
  parent: string;
  trail: readonly string[];
  current: string;
  depth: number;
  /** The folder whose menu is open. */
  menuOn: string | null;
  onMenu: (folder: Item, event: TargetedMouseEvent<HTMLElement>) => void;
}) {
  const [folders, setFolders] = useState<Item[] | null>(null);
  const [, setShown] = useState(0);
  const [dropOn, setDropOn] = useState<string | null>(null);
  const drive = useDrive();

  function load() {
    api<Item[]>("GET", `/api/drive/items/${parent}/children`).then(
      (children) => {
        const collator = new Intl.Collator(undefined, { numeric: true });
        setFolders(
          children.filter((child) => child.kind === "folder").sort((a, b) => collator.compare(a.name, b.name)),
        );
      },
      // The sidebar does without what it can't load. The page says what
      // went wrong.
      () => setFolders([]),
    );
  }

  useEffect(load, [parent]);
  useChanges(load, { folder: parent });

  // The path to the open folder opens in the tree, so it's in view.
  for (const id of trail) expanded.add(id);

  if (!folders || folders.length === 0) return null;
  // The arrow sits over the start of the row, so the row's highlight
  // reaches the sidebar's edge, as the places above it do.
  const indent = depth * 16 + 16;
  return (
    <ul class="tree" role="list">
      {folders.map((folder) => {
        const open = expanded.has(folder.id);
        const href = `/drive/folder/${folder.id}`;
        return (
          <li key={folder.id}>
            <div
              class={["place-row", dropOn === folder.id && "drop-target", menuOn === folder.id && "menu-open"]
                .filter(Boolean)
                .join(" ")}
              {...dropProps(folder, setDropOn, drive.notify)}
              onContextMenu={(event) => onMenu(folder, event)}
            >
              <button
                type="button"
                class="tree-toggle"
                style={{ left: `${indent}px` }}
                aria-expanded={open}
                aria-label={t(open ? "drive.collapse" : "drive.expand", { name: folder.name })}
                onClick={() => {
                  if (open) expanded.delete(folder.id);
                  else expanded.add(folder.id);
                  setShown((count) => count + 1);
                }}
              >
                <ChevronIcon />
              </button>
              <a
                class="place"
                style={{ paddingLeft: `${indent + 32}px` }}
                href={href}
                onClick={followLink}
                aria-current={current === href ? "page" : undefined}
              >
                <ItemIcon item={folder} />
                <span class="place-name">{folder.name}</span>
              </a>
            </div>
            {open && (
              <FolderTree
                parent={folder.id}
                trail={trail}
                current={current}
                depth={depth + 1}
                menuOn={menuOn}
                onMenu={onMenu}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** How many items Shared by me and Shared with me list, for their places
 * in the sidebar. The sidebar loads both lists, which stay short in a
 * household, and loads them again when sharing changes. */
function useSharedCounts(): { byMe: number | null; withMe: number | null } {
  const [byMe, setByMe] = useState<number | null>(null);
  const [withMe, setWithMe] = useState<number | null>(null);
  const load = () => {
    // A count that doesn't load is left out. The page says what went wrong.
    api<unknown[]>("GET", "/api/drive/shared-by-me").then((items) => setByMe(items.length), () => undefined);
    api<unknown[]>("GET", "/api/drive/shared").then((items) => setWithMe(items.length), () => undefined);
  };
  useEffect(load, []);
  useChanges(load);
  return { byMe, withMe };
}

export interface Usage {
  used: number;
  uploading: number;
  quota: number | null;
}

/** Storage, the last place in the list, as in Google Drive, with how much
 * space the reader's files take under it, and of how much, if there's a
 * limit. */
function StoragePlace({ current }: { current: boolean }) {
  const [usage, setUsage] = useState<Usage | null>(null);
  const load = () => {
    api<Usage>("GET", "/api/drive/usage").then(setUsage, () => undefined);
  };
  useEffect(load, []);
  useChanges(load);
  const used = usage && formatSize(usage.used);
  return (
    <li>
      <div class="place-row">
        <a class="place" href="/drive/storage" onClick={followLink} aria-current={current ? "page" : undefined}>
          <CloudIcon />
          {t("drive.storage")}
        </a>
      </div>
      {usage && used && (
        <div class="storage-meter">
          {usage.quota !== null && (
            <progress
              max={usage.quota}
              value={Math.min(usage.used, usage.quota)}
              aria-label={t("drive.storageUsed", { used, quota: formatSize(usage.quota) })}
            />
          )}
          <span class="storage-used">
            {usage.quota === null
              ? t("drive.storageUsedNoLimit", { used })
              : t("drive.storageUsed", { used, quota: formatSize(usage.quota) })}
          </span>
        </div>
      )}
    </li>
  );
}
