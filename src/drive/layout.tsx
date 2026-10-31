// Drive's frame around each of its pages: the top bar with search, and the
// sidebar with New, the places to go, the folders in My Drive, and how much
// space is used. Notices, such as "Moved to the trash", appear along the
// bottom, with Undo where something can be undone.
//
// New works the same on every page. It uploads into, or makes a folder in,
// the folder that's open, or My Drive on pages that aren't a folder, as in
// Google Drive. A page says which folder that is with `useTarget`. Files
// dropped on a folder's page, or on Home, upload there too.

import type { ComponentChildren, TargetedDragEvent, TargetedEvent } from "preact";
import { createContext } from "preact";
import { useContext, useEffect, useRef, useState } from "preact/hooks";

import { api, type Session } from "../api.ts";
import { formatSize, t } from "../i18n.ts";
import { Menu, type MenuEntry, type MenuPlace } from "../shell/menu.tsx";
import { followLink, usePath } from "../shell/router.ts";
import { TopBar } from "../shell/top-bar.tsx";
import { ClashDialog, NameDialog } from "./dialogs.tsx";
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
  NewFolderIcon,
  PlusIcon,
  StarIcon,
  TrashIcon,
  UploadFileIcon,
  UploadFolderIcon,
} from "./icons.tsx";
import type { Item } from "./item.ts";
import { SearchBox } from "./search-box.tsx";
import { announceChange, useChanges } from "./store.ts";
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

type Open = { kind: "newFolder" } | { kind: "clash"; clashes: Child[]; answer: (replace: boolean | null) => void };

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
  const [top, setTop] = useState<Item | null>(null);
  const [target, setTargetState] = useState<{ folder: Item | null; drops: boolean; trail: readonly string[] }>({
    folder: null,
    drops: false,
    trail: [],
  });
  const [open, setOpen] = useState<Open | null>(null);
  const [menu, setMenu] = useState<{ place: MenuPlace; byKeyboard: boolean } | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [dropping, setDropping] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const dragDepth = useRef(0);
  const chooser = useRef<HTMLInputElement>(null);
  const folderChooser = useRef<HTMLInputElement>(null);
  const noticeTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    api<Item>("GET", "/api/drive/top").then(setTop, (problem: Error) =>
      notify({ message: problem.message, problem: true }),
    );
    // Lists show a file as soon as its upload finishes.
    return uploads.onFinished(() => announceChange());
  }, []);

  // A page on a phone starts with the sidebar out of the way.
  useEffect(() => setSidebarOpen(false), [path]);

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
  const hereName = target.folder && target.folder.parent !== null ? target.folder.name : t("drive.myDrive");

  /** Asks whether to replace what has the upload's names, or keep both.
   * Null means cancel. */
  function ask(found: Child[]): Promise<boolean | null> {
    return new Promise((answer) => setOpen({ kind: "clash", clashes: found, answer }));
  }

  /** Uploads files and folders into the target folder, making the folders
   * first. */
  async function upload(tree: Tree) {
    if (!here) return;
    const into = { id: here.id, name: hereName };
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
    for (const files of byFolder.values()) uploads.add(files, files[0]!.folder);
  }

  function chosen(event: TargetedEvent<HTMLInputElement>, folders: boolean) {
    notify(null);
    const files = [...(event.currentTarget.files ?? [])];
    // A chosen folder brings only its files, so an empty one brings
    // nothing, and the browser doesn't say so.
    if (folders && files.length === 0) notify({ message: t("drive.emptyFolder"), problem: true });
    else void upload(folders ? chosenTree(files) : { files: files.map((file) => ({ file, path: [] })), folders: [] });
    // Lets the same files be chosen again.
    event.currentTarget.value = "";
  }

  function newEntries(): MenuEntry[] {
    return [
      { label: t("drive.newFolder"), icon: <NewFolderIcon />, onSelect: () => setOpen({ kind: "newFolder" }) },
      "separator",
      { label: t("drive.upload"), icon: <UploadFileIcon />, onSelect: () => chooser.current?.click() },
      { label: t("drive.uploadFolder"), icon: <UploadFolderIcon />, onSelect: () => folderChooser.current?.click() },
    ];
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
    newEntries,
    notify,
  };

  return (
    <Frame.Provider value={frame}>
      <div class={sidebarOpen ? "frame sidebar-open" : "frame"}>
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
            aria-expanded={menu !== null}
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
              <div class="place-row">
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
              {top && <FolderTree parent={top.id} trail={target.trail} current={path} depth={1} />}
            </li>
            <Place href="/drive/starred" current={path === "/drive/starred"} icon={<StarIcon />}>
              {t("starred.title")}
            </Place>
            <Place href="/drive/trash" current={path === "/drive/trash"} icon={<TrashIcon />}>
              {t("trash.title")}
            </Place>
          </ul>
          <StorageMeter />
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
          label={t("drive.newIn", { folder: hereName })}
          entries={newEntries()}
          place={menu.place}
          byKeyboard={menu.byKeyboard}
          onClose={() => setMenu(null)}
        />
      )}
      {open?.kind === "newFolder" && here && (
        <NameDialog
          title={t("drive.newFolder")}
          submit={t("drive.create")}
          initial={t("drive.untitledFolder")}
          onSubmit={async (name) => {
            await api("POST", `/api/drive/items/${here.id}/children`, { name });
            setOpen(null);
            notify({ message: t("drive.created", { name }) });
            announceChange();
          }}
          onClose={() => setOpen(null)}
        />
      )}
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

function Place({
  href,
  current,
  icon,
  children,
}: {
  href: string;
  current: boolean;
  icon: ComponentChildren;
  children: ComponentChildren;
}) {
  return (
    <li>
      <div class="place-row">
        <a class="place" href={href} onClick={followLink} aria-current={current ? "page" : undefined}>
          {icon}
          {children}
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

/** The folders inside `parent`, each of which can open to show its own. */
function FolderTree({
  parent,
  trail,
  current,
  depth,
}: {
  parent: string;
  trail: readonly string[];
  current: string;
  depth: number;
}) {
  const [folders, setFolders] = useState<Item[] | null>(null);
  const [, setShown] = useState(0);

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
  useChanges(load);

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
            <div class="place-row" style={{ paddingLeft: `${depth * 16}px` }}>
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
                {folder.name}
              </a>
            </div>
            {open && <FolderTree parent={folder.id} trail={trail} current={current} depth={depth + 1} />}
          </li>
        );
      })}
    </ul>
  );
}

interface Usage {
  used: number;
  uploading: number;
  quota: number | null;
}

/** How much space the reader's files take, and of how much, if there's a
 * limit. */
function StorageMeter() {
  const [usage, setUsage] = useState<Usage | null>(null);
  const load = () => {
    api<Usage>("GET", "/api/drive/usage").then(setUsage, () => undefined);
  };
  useEffect(load, []);
  useChanges(load);
  if (!usage) return null;
  const used = formatSize(usage.used);
  return (
    <div class="storage">
      <CloudIcon />
      <div class="storage-text">
        <span class="storage-title">{t("drive.storage")}</span>
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
    </div>
  );
}
