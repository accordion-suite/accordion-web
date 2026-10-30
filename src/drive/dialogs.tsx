// Drive's dialogs: naming a new folder or renaming, choosing where to move
// to, choosing what an upload does to items with its names, and confirming
// what can't be undone.

import type { TargetedSubmitEvent } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

import { api } from "../api.ts";
import { t } from "../i18n.ts";
import { Dialog } from "../shell/dialog.tsx";
import type { Child } from "./folder-upload.ts";
import type { Item } from "./item.ts";
import { freeName, stemLength } from "./names.ts";

function message(problem: unknown): string {
  return problem instanceof Error ? problem.message : t("error.problem");
}

/** Asks for a name, such as for a new folder. `onSubmit` throws to show a
 * problem, such as a name that's taken, and leaves the dialog open. */
export function NameDialog({
  title,
  submit,
  initial = "",
  file = false,
  onSubmit,
  onClose,
}: {
  title: string;
  submit: string;
  initial?: string;
  /** Selects only the part before the extension. */
  file?: boolean;
  onSubmit: (name: string) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
    input.current?.setSelectionRange(0, file ? stemLength(initial) : initial.length);
  }, []);

  async function save(event: TargetedSubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) {
      setError(t("drive.nameNeeded"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onSubmit(name.trim());
    } catch (problem) {
      setError(message(problem));
      setBusy(false);
    }
  }

  return (
    <Dialog title={title} onClose={onClose}>
      <form onSubmit={save} noValidate>
        <label for="item-name">{t("drive.name")}</label>
        <input
          ref={input}
          id="item-name"
          value={name}
          maxLength={255}
          autocomplete="off"
          aria-describedby="item-name-error"
          onInput={(event) => setName(event.currentTarget.value)}
        />
        <p id="item-name-error" class="error" role="alert">
          {error}
        </p>
        <div class="dialog-buttons">
          <button type="submit" disabled={busy}>
            {submit}
          </button>
          <button type="button" class="secondary" onClick={onClose}>
            {t("dialog.cancel")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** Asks before something that can't be undone, such as emptying the
 * trash. */
export function ConfirmDialog({
  title,
  body,
  confirm,
  onConfirm,
  onClose,
}: {
  title: string;
  body: string;
  confirm: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function go() {
    setBusy(true);
    setError("");
    try {
      await onConfirm();
    } catch (problem) {
      setError(message(problem));
      setBusy(false);
    }
  }

  return (
    <Dialog title={title} onClose={onClose}>
      <p>{body}</p>
      <p class="error" role="alert">
        {error}
      </p>
      <div class="dialog-buttons">
        <button type="button" class="danger" disabled={busy} onClick={go}>
          {confirm}
        </button>
        {/* Focus starts on the safe choice. */}
        <button type="button" class="secondary" autofocus onClick={onClose}>
          {t("dialog.cancel")}
        </button>
      </div>
    </Dialog>
  );
}

/** Asks whether uploads replace the items that have their names, or keep
 * both, as Google Drive's upload options do. */
export function ClashDialog({
  clashes,
  onChoose,
  onClose,
}: {
  clashes: readonly Child[];
  onChoose: (replace: boolean) => void;
  onClose: () => void;
}) {
  const first = clashes[0]!;
  const files = clashes.filter((child) => child.kind === "file").length;
  const folders = clashes.length - files;
  const taken = new Set(clashes.map((child) => child.name));
  const said =
    clashes.length > 1
      ? t("drive.clashMany", { count: clashes.length })
      : t(first.kind === "file" ? "drive.clashFile" : "drive.clashFolder", { name: first.name });

  return (
    <Dialog title={t("drive.clashTitle")} onClose={onClose}>
      <p>{said}</p>
      {files > 0 && <p>{t("drive.replaceFiles", { count: files })}</p>}
      {folders > 0 && <p>{t("drive.replaceFolders", { count: folders })}</p>}
      <p>{t("drive.keepBothHelp", { example: freeName(first.name, taken) })}</p>
      <div class="dialog-buttons">
        <button type="button" onClick={() => onChoose(true)}>
          {t("drive.replace")}
        </button>
        {/* Focus starts on the choice that changes nothing that's there. */}
        <button type="button" class="secondary" autofocus onClick={() => onChoose(false)}>
          {t("drive.keepBoth")}
        </button>
        <button type="button" class="secondary" onClick={onClose}>
          {t("dialog.cancel")}
        </button>
      </div>
    </Dialog>
  );
}

interface Place {
  folder: Item;
  parent: Item | null;
  folders: Item[];
}

async function place(id: string | null, moving: ReadonlySet<string>): Promise<Place> {
  const folder = await api<Item>("GET", id === null ? "/api/drive/top" : `/api/drive/items/${id}`);
  const [parent, children] = await Promise.all([
    folder.parent === null ? null : api<Item>("GET", `/api/drive/items/${folder.parent}`),
    api<Item[]>("GET", `/api/drive/items/${folder.id}/children`),
  ]);
  const collator = new Intl.Collator(undefined, { numeric: true });
  // A folder can't move into itself, so the folders being moved aren't
  // offered.
  const folders = children
    .filter((child) => child.kind === "folder" && !moving.has(child.id))
    .sort((a, b) => collator.compare(a.name, b.name));
  return { folder, parent, folders };
}

/** Lets the reader browse to a folder, then moves `items` into it. */
export function MoveDialog({
  items,
  onMoved,
  onClose,
}: {
  items: readonly Item[];
  onMoved: (to: string) => void;
  onClose: () => void;
}) {
  const moving = new Set(items.map((item) => item.id));
  const [at, setAt] = useState<string | null>(null);
  const [shown, setShown] = useState<Place | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const location = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    setError("");
    place(at, moving).then(setShown, (problem) => setError(message(problem)));
  }, [at]);

  const name = (folder: Item) => (folder.parent === null ? t("drive.title") : folder.name);
  const here = shown?.folder;
  // Moving to where everything already is would change nothing.
  const already = here !== undefined && items.every((item) => item.parent === here.id);

  async function move() {
    if (!here) return;
    setBusy(true);
    setError("");
    try {
      for (const item of items) {
        if (item.parent !== here.id) {
          await api("PATCH", `/api/drive/items/${item.id}`, { parent: here.id });
        }
      }
      onMoved(name(here));
    } catch (problem) {
      setError(message(problem));
      setBusy(false);
    }
  }

  function open(id: string) {
    setAt(id);
    // The button that was selected goes away with its list, so focus moves
    // to the new folder's name, which screen readers then read out.
    location.current?.focus();
  }

  const title =
    items.length === 1 ? t("drive.moveOne", { name: items[0]!.name }) : t("drive.moveMany", { count: items.length });

  return (
    <Dialog title={title} onClose={onClose}>
      {shown ? (
        <>
          <h3 ref={location} tabIndex={-1} class="move-location">
            {name(shown.folder)}
          </h3>
          {shown.parent && (
            <button type="button" class="link" onClick={() => open(shown.parent!.id)}>
              {t("drive.up", { name: name(shown.parent) })}
            </button>
          )}
          {shown.folders.length === 0 ? (
            <p class="hint">{t("drive.noSubfolders")}</p>
          ) : (
            <ul class="move-folders" aria-label={t("drive.foldersIn", { name: name(shown.folder) })}>
              {shown.folders.map((folder) => (
                <li key={folder.id}>
                  <button type="button" class="link" onClick={() => open(folder.id)}>
                    {folder.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        !error && <p class="loading">{t("shell.loading")}</p>
      )}
      <p class="error" role="alert">
        {error}
      </p>
      <div class="dialog-buttons">
        <button type="button" disabled={busy || !shown || already} onClick={move}>
          {shown ? t("drive.moveHere", { name: name(shown.folder) }) : t("drive.move")}
        </button>
        <button type="button" class="secondary" onClick={onClose}>
          {t("dialog.cancel")}
        </button>
      </div>
    </Dialog>
  );
}
