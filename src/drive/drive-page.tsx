// A folder in Drive: what's in it, with links into subfolders, to show
// photos and PDFs, and to download other files, uploads of files and folders
// by menu or by dropping them on it, and new folders. Files and folders can
// be renamed, moved, or moved to the trash from a menu, by right-clicking or
// with each one's button, or with keyboard shortcuts on what's selected. It
// uses only Drive's own API, /api/drive (decision 13).

import type { TargetedDragEvent, TargetedEvent, TargetedMouseEvent } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

import { api } from "../api.ts";
import { formatDate, formatSize, t } from "../i18n.ts";
import { PageTitle } from "../shell/page.tsx";
import { Menu, type MenuEntry, type MenuPlace, SEPARATOR } from "../shell/menu.tsx";
import { followLink, navigate, useQuery } from "../shell/router.ts";
import { MoveDialog, NameDialog } from "./dialogs.tsx";
import { type Tree, type TreeFile, chosenTree, droppedTree, key, makeFolders } from "./folder-upload.ts";
import { uploads } from "./http-transport.ts";
import type { Item } from "./item.ts";
import { Viewer } from "./viewer.tsx";

interface Loaded {
  folder: Item;
  parent: Item | null;
  children: Item[];
}

type Open =
  | { kind: "newFolder" }
  | { kind: "rename"; item: Item }
  | { kind: "move"; items: Item[] };

/** What just changed, with a way to undo moving to the trash. */
interface Done {
  message: string;
  restore?: Item[];
}

function folderPath(item: Item): string {
  return item.parent === null ? "/drive/" : `/drive/folder/${item.id}`;
}

/** The folder's address with `file` open in the viewer. */
function filePath(folder: Item, file: Item): string {
  return `${folderPath(folder)}?file=${encodeURIComponent(file.id)}`;
}

/** Marks a history entry that the viewer opened from its folder, so closing
 * it can go back rather than add another entry. */
const OPENED_HERE = { viewer: true };

async function load(id: string | null): Promise<Loaded> {
  const folder = await api<Item>("GET", id === null ? "/api/drive/top" : `/api/drive/items/${id}`);
  const [parent, children] = await Promise.all([
    folder.parent === null ? null : api<Item>("GET", `/api/drive/items/${folder.parent}`),
    api<Item[]>("GET", `/api/drive/items/${folder.id}/children`),
  ]);
  // Folders first, then by name in the reader's language.
  const collator = new Intl.Collator(undefined, { numeric: true });
  children.sort(
    (a, b) => Number(b.kind === "folder") - Number(a.kind === "folder") || collator.compare(a.name, b.name),
  );
  return { folder, parent, children };
}

/** An open menu. `owner` names the button that opened it, if one did. */
interface OpenMenu {
  label: string;
  entries: MenuEntry[];
  place: MenuPlace;
  owner?: string;
}

/** Saves a file, as its download link would. */
function download(item: Item) {
  const link = document.createElement("a");
  link.href = `/api/drive/items/${item.id}/content`;
  link.download = item.name;
  link.click();
}

/** Whether a key press is meant for a text field rather than the page. */
function typing(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest("input:not([type=checkbox]), textarea, [contenteditable]") !== null;
}

/** Whether a drag holds files from the device, rather than, say, text. */
function holdsFiles(event: DragEvent): boolean {
  return event.dataTransfer?.types.includes("Files") ?? false;
}

/** "Photo.jpg" for one item, or "3 items" for more. */
function naming(items: readonly Item[], one: Parameters<typeof t>[0], many: Parameters<typeof t>[0], to = "") {
  return items.length === 1
    ? t(one, { name: items[0]!.name, folder: to })
    : t(many, { count: items.length, folder: to });
}

export function DrivePage({ folder }: { folder: string | null }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState("");
  const [problem, setProblem] = useState("");
  const [done, setDone] = useState<Done | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [open, setOpen] = useState<Open | null>(null);
  const [dropping, setDropping] = useState(false);
  // Drags enter and leave each element inside the page, so this counts how
  // deep the pointer is to know when it has really left.
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const dragDepth = useRef(0);
  const chooser = useRef<HTMLInputElement>(null);
  const folderChooser = useRef<HTMLInputElement>(null);
  const showing = useQuery("file");
  // The shortcuts need what's loaded, so the page sets them once it is.
  const shortcuts = useRef<((event: KeyboardEvent) => void) | null>(null);
  shortcuts.current = null;

  useEffect(() => {
    const keys = (event: KeyboardEvent) => shortcuts.current?.(event);
    document.addEventListener("keydown", keys);
    return () => document.removeEventListener("keydown", keys);
  }, []);

  function refresh() {
    load(folder).then(
      (next) => {
        setLoaded(next);
        // Drops what's no longer here, such as a file moved elsewhere.
        const here = new Set(next.children.map((child) => child.id));
        setSelected((before) => new Set([...before].filter((id) => here.has(id))));
      },
      (problem: Error) => setProblem(problem.message),
    );
  }

  useEffect(() => {
    load(folder).then(setLoaded, (problem: Error) => setError(problem.message));
  }, [folder]);

  // Shows a file as soon as its upload into this folder finishes.
  const folderId = loaded?.folder.id;
  useEffect(() => {
    if (!folderId) return;
    return uploads.onFinished((upload) => {
      if (upload.folder.id === folderId) refresh();
    });
  }, [folder, folderId]);

  if (error) {
    return (
      <main>
        <PageTitle>{t("drive.title")}</PageTitle>
        <p class="error" role="alert">
          {error}
        </p>
      </main>
    );
  }
  if (!loaded) {
    return <p class="loading">{t("shell.loading")}</p>;
  }
  const { parent, children } = loaded;
  const folderName = parent ? loaded.folder.name : t("drive.title");
  const chosenItems = children.filter((child) => selected.has(child.id));
  const shown = children.filter((child) => child.preview !== null);
  const shownFile = shown.find((file) => file.id === showing);

  function openFile(event: MouseEvent, file: Item) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(filePath(loaded!.folder, file), { state: OPENED_HERE });
  }

  function closeFile() {
    if ((history.state as typeof OPENED_HERE | null)?.viewer) {
      history.back();
    } else {
      // Opened from a link or a reload, so there's no folder entry to go
      // back to.
      navigate(folderPath(loaded!.folder), { replace: true });
    }
  }

  function report(next: Done) {
    setProblem("");
    setDone(next);
    refresh();
  }

  /** Uploads files and folders into this folder, making the folders
   * first. */
  async function upload(tree: Tree) {
    let ids: Map<string, string>;
    try {
      ids = await makeFolders(loaded!.folder.id, tree);
    } catch (failure) {
      setProblem((failure as Error).message);
      return;
    }
    if (ids.size > 1) refresh();
    const byFolder = new Map<string, TreeFile[]>();
    for (const file of tree.files) {
      byFolder.set(key(file.path), [...(byFolder.get(key(file.path)) ?? []), file]);
    }
    for (const [folderKey, files] of byFolder) {
      const path = files[0]!.path;
      uploads.add(
        files.map(({ file }) => ({ file, name: file.name })),
        { id: ids.get(folderKey)!, name: path.length > 0 ? path[path.length - 1]! : folderName },
      );
    }
  }

  function chosen(event: TargetedEvent<HTMLInputElement>, folders: boolean) {
    setProblem("");
    const files = [...(event.currentTarget.files ?? [])];
    void upload(folders ? chosenTree(files) : { files: files.map((file) => ({ file, path: [] })), folders: [] });
    // Lets the same files be chosen again.
    event.currentTarget.value = "";
  }

  /** What an action on `item` applies to: everything selected, if it's
   * among them, or else just the item. */
  function targets(item: Item): Item[] {
    return selected.has(item.id) && chosenItems.length > 1 ? chosenItems : [item];
  }

  function itemEntries(items: Item[]): MenuEntry[] {
    if (items.length > 1) {
      return [
        { label: t("drive.moveMany", { count: items.length }), onSelect: () => setOpen({ kind: "move", items }) },
        SEPARATOR,
        { label: t("drive.trashMany", { count: items.length }), shortcut: "Delete", onSelect: () => trash(items) },
      ];
    }
    const item = items[0]!;
    const entries: MenuEntry[] = [];
    if (item.kind === "folder") {
      entries.push({ label: t("drive.open"), onSelect: () => navigate(folderPath(item)) });
    } else {
      if (item.preview) {
        entries.push({
          label: t("drive.open"),
          onSelect: () => navigate(filePath(loaded!.folder, item), { state: OPENED_HERE }),
        });
      }
      entries.push({ label: t("viewer.download"), onSelect: () => download(item) });
    }
    entries.push(
      SEPARATOR,
      { label: t("drive.rename"), shortcut: "F2", onSelect: () => setOpen({ kind: "rename", item }) },
      { label: t("drive.move"), onSelect: () => setOpen({ kind: "move", items }) },
      SEPARATOR,
      { label: t("drive.toTrash"), shortcut: "Delete", onSelect: () => trash(items) },
    );
    return entries;
  }

  function itemMenu(item: Item, place: MenuPlace, owner?: string): OpenMenu {
    const items = targets(item);
    const label =
      items.length > 1 ? t("drive.actionsForMany", { count: items.length }) : t("drive.actionsFor", { name: item.name });
    return { label, entries: itemEntries(items), place, owner };
  }

  function newMenu(place: MenuPlace, owner?: string): OpenMenu {
    return {
      label: t("drive.newIn", { folder: folderName }),
      entries: [
        { label: t("drive.newFolder"), onSelect: () => setOpen({ kind: "newFolder" }) },
        SEPARATOR,
        { label: t("drive.upload"), onSelect: () => chooser.current?.click() },
        { label: t("drive.uploadFolder"), onSelect: () => folderChooser.current?.click() },
      ],
      place,
      owner,
    };
  }

  /** Right-clicking, or the context menu key: a menu for the item under the
   * pointer, or for the folder itself on empty space. */
  function contextMenu(event: TargetedMouseEvent<HTMLElement>) {
    const target = event.target as Element;
    if (typing(target) || target.closest("dialog")) return;
    event.preventDefault();
    const row = target.closest<HTMLElement>("tr[data-id]");
    // The context menu key may give no position, so the menu opens under
    // what has focus.
    const place: MenuPlace =
      event.clientX || event.clientY ? { x: event.clientX, y: event.clientY } : { under: row ?? target };
    const item = row && children.find((child) => child.id === row.dataset["id"]);
    setMenu(item ? itemMenu(item, place) : newMenu(place));
  }

  shortcuts.current = (event) => {
    if (open || menu || shownFile || typing(event.target)) return;
    if (event.target instanceof Element && event.target.closest("dialog")) return;
    const command = event.ctrlKey || event.metaKey;
    const focused = (document.activeElement as Element | null)?.closest<HTMLElement>("tr[data-id]");
    const focusedItem = focused && children.find((child) => child.id === focused.dataset["id"]);
    const items = chosenItems.length > 0 ? chosenItems : focusedItem ? [focusedItem] : [];
    if (event.key === "Delete" || (event.key === "Backspace" && event.metaKey)) {
      if (items.length === 0) return;
      void trash(items);
    } else if (event.key === "F2") {
      if (items.length !== 1) return;
      setOpen({ kind: "rename", item: items[0]! });
    } else if (command && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "a") {
      setSelected(new Set(children.map((child) => child.id)));
    } else if (command && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "z") {
      if (!done?.restore) return;
      void undo(done.restore);
    } else if (event.key === "Escape" && selected.size > 0) {
      setSelected(new Set());
    } else {
      return;
    }
    event.preventDefault();
  };

  function toggle(id: string) {
    const next = new Set(selected);
    if (!next.delete(id)) next.add(id);
    setSelected(next);
  }

  function toggleAll() {
    setSelected(chosenItems.length === children.length ? new Set() : new Set(children.map((child) => child.id)));
  }

  async function trash(items: Item[]) {
    setDone(null);
    try {
      for (const item of items) {
        await api("DELETE", `/api/drive/items/${item.id}`);
      }
      report({ message: naming(items, "drive.trashedOne", "drive.trashedMany"), restore: items });
    } catch (failure) {
      setProblem((failure as Error).message);
      refresh();
    }
  }

  async function undo(items: Item[]) {
    try {
      for (const item of items) {
        await api("POST", `/api/drive/items/${item.id}/restore`);
      }
      report({ message: naming(items, "drive.restoredOne", "drive.restoredMany") });
    } catch (failure) {
      setDone(null);
      setProblem((failure as Error).message);
      refresh();
    }
  }

  function dragEnter(event: TargetedDragEvent<HTMLElement>) {
    if (!holdsFiles(event)) return;
    event.preventDefault();
    dragDepth.current += 1;
    setDropping(true);
  }

  function dragOver(event: TargetedDragEvent<HTMLElement>) {
    if (!holdsFiles(event)) return;
    event.preventDefault();
    event.dataTransfer!.dropEffect = "copy";
  }

  function dragLeave(event: TargetedDragEvent<HTMLElement>) {
    if (!holdsFiles(event)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDropping(false);
  }

  function drop(event: TargetedDragEvent<HTMLElement>) {
    if (!holdsFiles(event)) return;
    event.preventDefault();
    dragDepth.current = 0;
    setDropping(false);
    setProblem("");
    const reading = droppedTree(event.dataTransfer!.items);
    if (reading) {
      reading.then(upload, (failure: Error) => setProblem(failure.message));
    } else {
      // A browser that can't read folders from a drop still gives files.
      void upload({ files: [...event.dataTransfer!.files].map((file) => ({ file, path: [] })), folders: [] });
    }
  }

  return (
    <main
      class={dropping ? "dropping" : undefined}
      onDragEnter={dragEnter}
      onDragOver={dragOver}
      onDragLeave={dragLeave}
      onDrop={drop}
      onContextMenu={contextMenu}
    >
      {dropping && (
        <p class="drop-hint" aria-hidden="true">
          {t("drive.dropHere", { folder: folderName })}
        </p>
      )}
      {parent && (
        <p>
          <a href={folderPath(parent)} onClick={followLink}>
            {t("drive.up", { name: parent.parent === null ? t("drive.title") : parent.name })}
          </a>
        </p>
      )}
      <PageTitle>{folderName}</PageTitle>
      <div class="toolbar">
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={menu?.owner === "new"}
          onClick={(event) => setMenu(newMenu({ under: event.currentTarget }, "new"))}
        >
          {t("drive.new")}
        </button>
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
        <a class="toolbar-link" href="/drive/trash" onClick={followLink}>
          {t("trash.title")}
        </a>
      </div>
      {chosenItems.length > 0 && (
        <div class="toolbar selection" role="group" aria-label={t("drive.selection")}>
          <span>{t("drive.selected", { count: chosenItems.length })}</span>
          {chosenItems.length === 1 && (
            <button type="button" class="secondary" onClick={() => setOpen({ kind: "rename", item: chosenItems[0]! })}>
              {t("drive.rename")}
            </button>
          )}
          <button type="button" class="secondary" onClick={() => setOpen({ kind: "move", items: chosenItems })}>
            {t("drive.move")}
          </button>
          <button type="button" class="secondary" onClick={() => trash(chosenItems)}>
            {t("drive.toTrash")}
          </button>
          <button type="button" class="secondary" onClick={() => setSelected(new Set())}>
            {t("drive.clearSelection")}
          </button>
        </div>
      )}
      <p class="error" role="alert">
        {problem}
      </p>
      <p class="done" role="status">
        {done && (
          <>
            {done.message}{" "}
            {done.restore && (
              <button type="button" class="link" onClick={() => undo(done.restore!)}>
                {t("drive.undo")}
              </button>
            )}
          </>
        )}
      </p>
      {children.length === 0 ? (
        <p>{t("drive.empty")}</p>
      ) : (
        <>
          <p class="hint">{t("drive.count", { count: children.length })}</p>
          <table class="items">
            <thead>
              <tr>
                <td class="select">
                  <input
                    type="checkbox"
                    aria-label={t("drive.selectAll")}
                    checked={chosenItems.length === children.length}
                    indeterminate={chosenItems.length > 0 && chosenItems.length < children.length}
                    onChange={toggleAll}
                  />
                </td>
                <th scope="col">{t("drive.name")}</th>
                <th scope="col" class="modified">
                  {t("drive.modified")}
                </th>
                <th scope="col" class="size">
                  {t("drive.size")}
                </th>
                <td class="more" />
              </tr>
            </thead>
            <tbody>
              {children.map((item) => (
                <tr key={item.id} data-id={item.id} class={selected.has(item.id) ? "selected" : undefined}>
                  <td class="select">
                    <input
                      type="checkbox"
                      aria-label={t("drive.select", { name: item.name })}
                      checked={selected.has(item.id)}
                      onChange={() => toggle(item.id)}
                    />
                  </td>
                  <th scope="row">
                    {item.kind === "folder" ? (
                      <a href={folderPath(item)} onClick={followLink}>
                        {item.name}
                      </a>
                    ) : item.preview ? (
                      <a href={filePath(loaded.folder, item)} onClick={(event) => openFile(event, item)}>
                        {item.name}
                      </a>
                    ) : (
                      <a
                        href={`/api/drive/items/${item.id}/content`}
                        download={item.name}
                        aria-label={t("drive.download", { name: item.name })}
                      >
                        {item.name}
                      </a>
                    )}
                  </th>
                  <td class="modified">{formatDate(item.modified_at)}</td>
                  <td class="size">
                    {item.kind === "folder" ? t("drive.folder") : formatSize(item.size ?? 0)}
                  </td>
                  <td class="more">
                    <button
                      type="button"
                      class="icon"
                      aria-label={t("drive.moreActions", { name: item.name })}
                      aria-haspopup="menu"
                      aria-expanded={menu?.owner === item.id}
                      onClick={(event) => setMenu(itemMenu(item, { under: event.currentTarget }, item.id))}
                    >
                      ⋮
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {open?.kind === "newFolder" && (
        <NameDialog
          title={t("drive.newFolder")}
          submit={t("drive.create")}
          onSubmit={async (name) => {
            await api("POST", `/api/drive/items/${loaded.folder.id}/children`, { name });
            setOpen(null);
            report({ message: t("drive.created", { name }) });
          }}
          onClose={() => setOpen(null)}
        />
      )}
      {open?.kind === "rename" && (
        <NameDialog
          title={t("drive.renameNamed", { name: open.item.name })}
          submit={t("drive.rename")}
          initial={open.item.name}
          file={open.item.kind === "file"}
          onSubmit={async (name) => {
            await api("PATCH", `/api/drive/items/${open.item.id}`, { name });
            setOpen(null);
            report({ message: t("drive.renamed", { name }) });
          }}
          onClose={() => setOpen(null)}
        />
      )}
      {menu && <Menu label={menu.label} entries={menu.entries} place={menu.place} onClose={() => setMenu(null)} />}
      {shownFile && (
        <Viewer
          files={shown}
          file={shownFile}
          // Steps replace the entry, so Back closes the viewer.
          onShow={(file) =>
            navigate(filePath(loaded.folder, file), { replace: true, state: history.state })
          }
          onClose={closeFile}
        />
      )}
      {open?.kind === "move" && (
        <MoveDialog
          items={open.items}
          onMoved={(to) => {
            setOpen(null);
            report({ message: naming(open.items, "drive.movedOne", "drive.movedMany", to) });
          }}
          onClose={() => setOpen(null)}
        />
      )}
    </main>
  );
}
