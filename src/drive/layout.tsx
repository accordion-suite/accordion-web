// Drive's frame around each of its pages: the top bar with search, and the
// sidebar with New, the places to go, the folders in My Drive, and how much
// space is used. Notices, such as "Moved to the trash", appear along the
// bottom, with Undo where something can be undone. The details panel, when
// it's open, is a column on the right.
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

import type { ComponentChildren, TargetedDragEvent, TargetedEvent, TargetedMouseEvent } from "preact";
import { createContext } from "preact";
import { useContext, useEffect, useRef, useState } from "preact/hooks";

import { api, send, type Session } from "../api.ts";
import { formatSize, t } from "../i18n.ts";
import { Menu, type MenuEntry, type MenuPlace } from "../shell/menu.tsx";
import { followLink, navigate, usePath, useQueryString } from "../shell/router.ts";
import { TopBar } from "../shell/top-bar.tsx";
import { DetailsPanel } from "./details.tsx";
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
import { announceChange, useChanges, useDetailsOpen } from "./store.ts";
import { finished } from "./uploads.ts";

/** Something to tell the reader, such as what just changed. */
export interface Notice {
  message: string;
  /** A problem stays until it's closed. Other notices go after a while. */
  problem?: boolean;
  /** Undoes the change, from the notice's Undo button or Ctrl+Z. */
  undo?: () => Promise<void>;
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
  // dropped does.
  useEffect(() => {
    const paste = (event: ClipboardEvent) => {
      const files = [...(event.clipboardData?.files ?? [])];
      if (!target.drops || files.length === 0 || typing(event.target)) return;
      if (event.target instanceof Element && event.target.closest("dialog")) return;
      event.preventDefault();
      notify(null);
      void upload({ files: files.map((file) => ({ file, path: [] })), folders: [] });
    };
    document.addEventListener("paste", paste);
    return () => document.removeEventListener("paste", paste);
  });

  // "/" goes to the search box and "?" lists the keyboard shortcuts, as in
  // Google Drive.
  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || typing(event.target)) return;
      if (document.querySelector("dialog[open]")) return;
      if (event.key === "/") {
        event.preventDefault();
        document.querySelector<HTMLInputElement>(".search input")?.focus();
      } else if (event.key === "?") {
        event.preventDefault();
        setOpen({ kind: "shortcuts" });
      }
    };
    document.addEventListener("keydown", keys);
    return () => document.removeEventListener("keydown", keys);
  }, []);

  // Ctrl+Z undoes what the notice says, as its Undo button does.
  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey) return;
      if (event.key.toLowerCase() !== "z" || typing(event.target) || !notice?.undo) return;
      if (event.target instanceof Element && event.target.closest("dialog")) return;
      event.preventDefault();
      void undo(notice);
    };
    document.addEventListener("keydown", keys);
    return () => document.removeEventListener("keydown", keys);
  }, [notice]);

  function notify(next: Notice | null) {
    clearTimeout(noticeTimer.current);
    setNotice(next);
    if (next && !next.problem) noticeTimer.current = window.setTimeout(() => setNotice(null), NOTICE_MS);
  }

  async function undo(done: Notice) {
    notify(null);
    try {
      await done.undo!();
    } catch (failure) {
      notify({ message: (failure as Error).message, problem: true });
    }
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

  /** New's menu, for `into` or the target folder. */
  function newEntries(into: Item | null = here): MenuEntry[] {
    if (!into) return [];
    const choose = (input: HTMLInputElement | null) => {
      chooseInto.current = into;
      input?.click();
    };
    return [
      { label: t("drive.newFolder"), icon: <NewFolderIcon />, onSelect: () => setOpen({ kind: "newFolder", into }) },
      { label: t("drive.newText"), icon: <NewTextIcon />, onSelect: () => setOpen({ kind: "newText", into }) },
      "separator",
      { label: t("drive.upload"), icon: <UploadFileIcon />, onSelect: () => choose(chooser.current) },
      { label: t("drive.uploadFolder"), icon: <UploadFolderIcon />, onSelect: () => choose(folderChooser.current) },
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
    newEntries: () => newEntries(),
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
        <nav id="sidebar" class="sidebar" aria-label={t("drive.places")}>
          <button
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
          {notice && !notice.problem && <NoticeBar notice={notice} onUndo={() => undo(notice)} onClose={() => notify(null)} />}
        </div>
        <div class="notice-area" role="alert">
          {notice?.problem && <NoticeBar notice={notice} onClose={() => notify(null)} />}
        </div>
      </div>

      {menu && (
        <Menu
          label={t("drive.newIn", { folder: menu.into ? nameOf(menu.into) : hereName })}
          entries={newEntries(menu.into ?? here)}
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

function NoticeBar({ notice, onUndo, onClose }: { notice: Notice; onUndo?: () => void; onClose: () => void }) {
  return (
    <div class={notice.problem ? "notice problem" : "notice"}>
      <span>{notice.message}</span>
      {notice.undo && onUndo && (
        <button type="button" class="link notice-undo" onClick={onUndo}>
          {t("drive.undo")}
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
              style={{ paddingLeft: `${depth * 16 + 16}px` }}
              {...dropProps(folder, setDropOn, drive.notify)}
              onContextMenu={(event) => onMenu(folder, event)}
            >
              <button
                type="button"
                class="tree-toggle"
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
