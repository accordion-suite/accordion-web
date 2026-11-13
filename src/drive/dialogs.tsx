// Drive's dialogs: naming a new folder or renaming, choosing where to move
// to or a folder to search in, choosing what an upload does to items with
// its names, a file's versions, and sharing.

import type { Ref, TargetedSubmitEvent } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

import { ApiError, api } from "../api.ts";
import { formatDate, formatSize, type MessageKey, t } from "../i18n.ts";
import { Dialog, problemText as message } from "../shell/dialog.tsx";
import type { Child } from "./folder-upload.ts";
import { FOLDER_COLORS, type FolderColor, type Item, type ShareEntry } from "./item.ts";
import { ItemIcon } from "./icons.tsx";
import { LinksSection } from "./links.tsx";
import { type Access, pathTo, whoHasAccess } from "./store.ts";
import { keptFor, useRetention } from "./retention.ts";
import { freeName, stemLength } from "./names.ts";

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

/** The folder `id` is in, or null if the reader can't open it, such as
 * above a folder someone shared with them. */
async function parentOf(folder: Item): Promise<Item | null> {
  if (folder.parent === null) return null;
  try {
    return await api<Item>("GET", `/api/drive/items/${folder.parent}`);
  } catch (problem) {
    if (problem instanceof ApiError && problem.status === 404) return null;
    throw problem;
  }
}

async function place(id: string | null, moving: ReadonlySet<string>): Promise<Place> {
  const folder = await api<Item>("GET", id === null ? "/api/drive/top" : `/api/drive/items/${id}`);
  const [parent, children] = await Promise.all([
    parentOf(folder),
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

/** Lets the reader browse to a folder, then moves `items` into it. Items
 * can only move within their owner's storage, so for someone else's items
 * it starts in the folder they're in. */
export function MoveDialog({
  items,
  onMoved,
  onClose,
}: {
  items: readonly Item[];
  /** With the folder's name and ID. */
  onMoved: (to: string, id: string) => void;
  onClose: () => void;
}) {
  const moving = new Set(items.map((item) => item.id));
  const first = items[0]!;
  const [at, setAt] = useState<string | null>(first.access === "owner" ? null : first.parent);
  const [shown, setShown] = useState<Place | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const location = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    setError("");
    place(at, moving).then(setShown, (problem) => setError(message(problem)));
  }, [at]);

  const name = (folder: Item) => (folder.parent === null ? t("drive.myDrive") : folder.name);
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
      onMoved(name(here), here.id);
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
      <FolderBrowser shown={shown} error={error} heading={location} name={name} open={open} />
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

/** A folder's name, and the folders in it to open, for choosing one. */
function FolderBrowser({
  shown,
  error,
  heading,
  name,
  open,
}: {
  shown: Place | null;
  error: string;
  heading: Ref<HTMLHeadingElement>;
  name: (folder: Item) => string;
  open: (id: string) => void;
}) {
  if (!shown) return !error ? <p class="loading">{t("shell.loading")}</p> : null;
  return (
    <>
      <h3 ref={heading} tabIndex={-1} class="move-location">
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
  );
}

/** Lets the reader browse to one of their folders, for a search to look
 * in it and the folders inside it. */
export function ChooseFolderDialog({
  onChosen,
  onClose,
}: {
  onChosen: (id: string, name: string) => void;
  onClose: () => void;
}) {
  const [at, setAt] = useState<string | null>(null);
  const [shown, setShown] = useState<Place | null>(null);
  const [error, setError] = useState("");
  const location = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    setError("");
    place(at, new Set()).then(setShown, (problem) => setError(message(problem)));
  }, [at]);

  const name = (folder: Item) => (folder.parent === null ? t("drive.myDrive") : folder.name);

  function open(id: string) {
    setAt(id);
    location.current?.focus();
  }

  return (
    <Dialog title={t("search.chooseFolder")} onClose={onClose}>
      <FolderBrowser shown={shown} error={error} heading={location} name={name} open={open} />
      <p class="error" role="alert">
        {error}
      </p>
      <div class="dialog-buttons">
        <button type="button" disabled={!shown} onClick={() => shown && onChosen(shown.folder.id, name(shown.folder))}>
          {shown ? t("search.searchIn", { name: name(shown.folder) }) : t("search.search")}
        </button>
        <button type="button" class="secondary" onClick={onClose}>
          {t("dialog.cancel")}
        </button>
      </div>
    </Dialog>
  );
}

/** A saved version of a file, as `/api/drive/items/{id}/versions` lists it. */
interface Version {
  id: string;
  number: number;
  size: number;
  sha256: string;
  created_at: string;
}

/** A file's saved versions, newest first, to download one or make it the
 * current version again. */
export function VersionsDialog({
  item,
  onRestored,
  onClose,
}: {
  item: Item;
  onRestored: (number: number) => void;
  onClose: () => void;
}) {
  const [versions, setVersions] = useState<Version[] | null>(null);
  const retention = useRetention();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Version[]>("GET", `/api/drive/items/${item.id}/versions`).then(setVersions, (problem) =>
      setError(message(problem)),
    );
  }, [item.id]);

  async function restore(version: Version) {
    setBusy(true);
    setError("");
    try {
      await api("POST", `/api/drive/items/${item.id}/versions/${version.id}/restore`);
      onRestored(version.number);
    } catch (problem) {
      setError(message(problem));
      setBusy(false);
    }
  }

  const current = versions?.[0];
  return (
    <Dialog title={t("drive.versionsOf", { name: item.name })} class="versions-dialog" onClose={onClose}>
      {retention && (
        <p class="hint">
          {retention === "unknown"
            ? t("drive.versionsHintUnknown")
            : t("drive.versionsHint", { time: keptFor(retention.version_days) })}
        </p>
      )}
      {versions ? (
        <ul class="versions">
          {versions.map((version) => (
            <li key={version.id}>
              <div class="version-about">
                <span class="version-name">
                  {version === current
                    ? t("drive.versionCurrent", { number: version.number })
                    : t("drive.version", { number: version.number })}
                </span>
                <span class="version-detail">
                  {t("drive.versionAbout", { date: formatDate(version.created_at), size: formatSize(version.size) })}
                </span>
              </div>
              <a
                class="button secondary"
                href={`/api/drive/items/${item.id}/versions/${version.id}/content`}
                download={item.name}
                aria-label={t("drive.downloadVersion", { number: version.number })}
              >
                {t("viewer.download")}
              </a>
              {/* Restoring what's already current would change nothing. */}
              {version.sha256 !== current?.sha256 && (
                <button
                  type="button"
                  class="secondary"
                  disabled={busy}
                  aria-label={t("drive.restoreVersionNamed", { number: version.number })}
                  onClick={() => restore(version)}
                >
                  {t("drive.restoreVersion")}
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        !error && <p class="loading">{t("shell.loading")}</p>
      )}
      <p class="error" role="alert">
        {error}
      </p>
      <div class="dialog-buttons">
        <button type="button" onClick={onClose}>
          {t("dialog.close")}
        </button>
      </div>
    </Dialog>
  );
}

/** Someone on the server, as `/api/directory` lists them. */
export interface Person {
  id: string;
  username: string;
  display_name: string;
  you: boolean;
}

/** Who can open an item, to share it with more people, change what each
 * may do, or stop sharing, and its links. Only the owner shares with
 * people, so an editor sees only the links. `onClose` says whether
 * anything changed, so lists can show the item as shared. */
export function ShareDialog({ item, onClose }: { item: Item; onClose: (changed: boolean) => void }) {
  const [shares, setShares] = useState<ShareEntry[] | null>(null);
  const [people, setPeople] = useState<Person[] | null>(null);
  // People who can open it through a folder above it, which the folder's
  // own sharing changes.
  const [through, setThrough] = useState<Access[]>([]);
  const [adding, setAdding] = useState("");
  const [level, setLevel] = useState<ShareEntry["level"]>("viewer");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const changed = useRef(false);
  const owner = item.access === "owner";

  async function load() {
    const [nextShares, nextPeople, access] = await Promise.all([
      api<ShareEntry[]>("GET", `/api/drive/items/${item.id}/shares`),
      people ? Promise.resolve(people) : api<Person[]>("GET", "/api/directory"),
      pathTo(item).then(whoHasAccess),
    ]);
    setShares(nextShares);
    setPeople(nextPeople);
    setThrough(access.filter((each) => each.from !== null));
  }

  useEffect(() => {
    if (owner) load().catch((problem) => setError(message(problem)));
  }, [item.id]);

  /** Runs a change, then lists who has access again. */
  async function change(run: () => Promise<unknown>, said: string) {
    setBusy(true);
    setError("");
    setStatus("");
    try {
      await run();
      changed.current = true;
      await load();
      setStatus(said);
    } catch (problem) {
      setError(message(problem));
    }
    setBusy(false);
  }

  const you = people?.find((person) => person.you);
  const sharedWith = new Set(shares?.map((share) => share.user));
  const others = people?.filter((person) => !person.you && !sharedWith.has(person.id)) ?? [];
  const levelName = (value: ShareEntry["level"]) => t(value === "editor" ? "share.editor" : "share.viewer");

  function linksChanged() {
    changed.current = true;
  }

  function share(event: TargetedSubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const person = others.find((other) => other.id === adding);
    if (!person) return;
    void change(
      () => api("PUT", `/api/drive/items/${item.id}/shares/${person.id}`, { level }),
      t("share.shared", { item: item.name, name: person.display_name }),
    ).then(() => setAdding(""));
  }

  return (
    <Dialog title={t("share.title", { name: item.name })} class="share-dialog" onClose={() => onClose(changed.current)}>
      {!owner ? (
        <>
          <p class="hint">{t("share.ownerOnly", { name: item.owner ?? "" })}</p>
          <LinksSection item={item} onChanged={linksChanged} />
        </>
      ) : shares && people ? (
        <>
          {others.length === 0 ? (
            <p class="hint">{t(people.some((person) => !person.you) ? "share.everyone" : "share.noOthers")}</p>
          ) : (
            <form class="share-add" onSubmit={share} noValidate>
              <div class="share-field">
                <label for="share-person">{t("share.person")}</label>
                <select id="share-person" value={adding} onChange={(event) => setAdding(event.currentTarget.value)}>
                  <option value="">{t("share.choose")}</option>
                  {others.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.display_name} ({person.username})
                    </option>
                  ))}
                </select>
              </div>
              <div class="share-field">
                <label for="share-level">{t("share.level")}</label>
                <select
                  id="share-level"
                  value={level}
                  onChange={(event) => setLevel(event.currentTarget.value as ShareEntry["level"])}
                >
                  <option value="viewer">{t("share.viewer")}</option>
                  <option value="editor">{t("share.editor")}</option>
                </select>
              </div>
              <button type="submit" disabled={busy || !adding}>
                {t("share.submit")}
              </button>
            </form>
          )}
          <p class="hint">{t(item.kind === "folder" ? "share.help" : "share.helpFile")}</p>
          <h3 class="share-heading">{t("share.who")}</h3>
          <ul class="share-people">
            {you && (
              <li>
                <span class="share-name">
                  <span>{t("share.ownerYou", { name: you.display_name })}</span>
                  <span class="share-username">{you.username}</span>
                </span>
                <span class="share-role">{t("share.ownerRole")}</span>
              </li>
            )}
            {shares.map((entry) => (
              <li key={entry.user}>
                <span class="share-name">
                  <span>{entry.display_name}</span>
                  <span class="share-username">{entry.username}</span>
                </span>
                <select
                  class="short"
                  aria-label={t("share.levelFor", { name: entry.display_name })}
                  value={entry.level}
                  disabled={busy}
                  onChange={(event) => {
                    const next = event.currentTarget.value as ShareEntry["level"];
                    void change(
                      () => api("PUT", `/api/drive/items/${item.id}/shares/${entry.user}`, { level: next }),
                      t("share.changed", { name: entry.display_name, level: levelName(next).toLowerCase(), item: item.name }),
                    );
                  }}
                >
                  <option value="viewer">{t("share.viewer")}</option>
                  <option value="editor">{t("share.editor")}</option>
                </select>
                <button
                  type="button"
                  class="secondary"
                  disabled={busy}
                  aria-label={t("share.removeNamed", { name: entry.display_name })}
                  onClick={() =>
                    void change(
                      () => api("DELETE", `/api/drive/items/${item.id}/shares/${entry.user}`),
                      t("share.removed", { item: item.name, name: entry.display_name }),
                    )
                  }
                >
                  {t("share.remove")}
                </button>
              </li>
            ))}
          </ul>
          {through.length > 0 && (
            <ul class="share-people">
              {through.map(({ share: entry, from }) => (
                <li key={`${entry.user}-through`}>
                  <span class="share-name">
                    <span>{entry.display_name}</span>
                    <span class="share-username">{t("details.from", { folder: from!.name })}</span>
                  </span>
                  <span class="share-role">{levelName(entry.level)}</span>
                </li>
              ))}
            </ul>
          )}
          {shares.length === 0 && through.length === 0 && <p class="hint">{t("share.nobody")}</p>}
          <LinksSection item={item} onChanged={linksChanged} />
        </>
      ) : (
        !error && <p class="loading">{t("shell.loading")}</p>
      )}
      <p class="share-status" role="status">
        {status}
      </p>
      <p class="error" role="alert">
        {error}
      </p>
      <div class="dialog-buttons">
        <button type="button" onClick={() => onClose(changed.current)}>
          {t("dialog.done")}
        </button>
      </div>
    </Dialog>
  );
}

/** Keys pressed together, such as "Ctrl+A"; one after the other, such as
 * Alt+C then F; or either of two. */
type Keys = string | { then: readonly [string, string] } | { or: readonly [Keys, Keys] };

/** Drive's keyboard shortcuts, by what they're for. They follow Google
 * Drive's, and file managers' where Drive has none. Ctrl is Cmd on a Mac,
 * and Alt is Option. */
const SHORTCUTS: readonly [MessageKey, readonly [Keys, MessageKey][]][] = [
  [
    "shortcuts.anywhere",
    [
      ["/", "shortcuts.search"],
      [{ or: ["?", "Ctrl+/"] }, "shortcuts.help"],
      ["Ctrl+Z", "shortcuts.undo"],
      [{ or: ["Ctrl+Y", "Ctrl+Shift+Z"] }, "shortcuts.redo"],
      ["Alt+↑", "shortcuts.up"],
    ],
  ],
  [
    "shortcuts.creating",
    [
      ["Alt+N", "shortcuts.newMenu"],
      [{ then: ["Alt+C", "F"] }, "shortcuts.newFolder"],
      [{ then: ["Alt+C", "T"] }, "shortcuts.newText"],
      [{ then: ["Alt+C", "U"] }, "shortcuts.upload"],
      [{ then: ["Alt+C", "I"] }, "shortcuts.uploadFolder"],
    ],
  ],
  [
    "shortcuts.going",
    [
      [{ or: [{ then: ["Alt+G", "N"] }, { then: ["Alt+G", "F"] }] }, "shortcuts.toSidebar"],
      [{ then: ["Alt+G", "I"] }, "shortcuts.toItems"],
      ["Alt+Shift+A", "shortcuts.toFolder"],
      [{ then: ["Alt+G", "D"] }, "shortcuts.toDetails"],
      [{ then: ["Alt+V", "D"] }, "shortcuts.details"],
      [{ then: ["Alt+V", "A"] }, "shortcuts.activity"],
      [{ then: ["Alt+G", "U"] }, "shortcuts.toUploads"],
      [{ then: ["Alt+V", "L"] }, "shortcuts.layout"],
    ],
  ],
  [
    "shortcuts.inSidebar",
    [
      ["↑ ↓", "shortcuts.sidebarStep"],
      [{ or: ["→", "←"] }, "shortcuts.sidebarOpen"],
      [{ or: ["Home", "End"] }, "shortcuts.sidebarEnds"],
      ["Enter", "shortcuts.sidebarGo"],
    ],
  ],
  [
    "shortcuts.inPath",
    [
      ["← →", "shortcuts.pathStep"],
      ["Enter", "shortcuts.pathGo"],
      ["↓", "shortcuts.pathDown"],
    ],
  ],
  [
    "shortcuts.choosing",
    [
      ["A–Z", "shortcuts.typeAhead"],
      ["↑ ↓ ← →", "shortcuts.move"],
      ["Shift+↑ ↓ ← →", "shortcuts.extend"],
      ["Ctrl+↑ ↓ ← →", "shortcuts.focus"],
      [{ or: ["Home", "End"] }, "shortcuts.ends"],
      [{ or: ["Shift+Home", "Shift+End"] }, "shortcuts.extendEnds"],
      ["Space", "shortcuts.toggle"],
      ["Ctrl+A", "shortcuts.all"],
      ["Esc", "shortcuts.clear"],
    ],
  ],
  [
    "shortcuts.acting",
    [
      ["Enter", "shortcuts.open"],
      ["Ctrl+Enter", "shortcuts.newTab"],
      ["Ctrl+Alt+P", "shortcuts.preview"],
      [{ or: ["Alt+A", "Shift+F10"] }, "shortcuts.menu"],
      ["F2", "shortcuts.rename"],
      ["Ctrl+Alt+A", "shortcuts.share"],
      ["Ctrl+Alt+M", "shortcuts.moveTo"],
      ["Ctrl+Alt+S", "shortcuts.star"],
      ["Ctrl+X", "shortcuts.cut"],
      ["Ctrl+C", "shortcuts.copy"],
      ["Ctrl+V", "shortcuts.paste"],
      ["Ctrl+Shift+C", "shortcuts.copyNames"],
      [{ or: ["Delete", "#"] }, "shortcuts.trash"],
    ],
  ],
  [
    "shortcuts.viewing",
    [
      ["← →", "shortcuts.step"],
      ["Space", "shortcuts.play"],
      ["Esc", "shortcuts.close"],
    ],
  ],
];

function KeysShown({ keys }: { keys: Keys }) {
  if (typeof keys === "string") return <kbd>{keys}</kbd>;
  if ("then" in keys) {
    return (
      <span class="keys">
        <kbd>{keys.then[0]}</kbd> {t("shortcuts.then")} <kbd>{keys.then[1]}</kbd>
      </span>
    );
  }
  return (
    <>
      <KeysShown keys={keys.or[0]} /> {t("shortcuts.or")} <KeysShown keys={keys.or[1]} />
    </>
  );
}

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title={t("shortcuts.title")} class="shortcuts" onClose={onClose}>
      <p class="hint">{t("shortcuts.mac")}</p>
      {SHORTCUTS.map(([group, keys]) => (
        <section key={group}>
          <h3>{t(group)}</h3>
          <dl>
            {keys.map(([key, does]) => (
              <div key={does}>
                <dt>
                  <KeysShown keys={key} />
                </dt>
                <dd>{t(does)}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
      <div class="dialog-buttons">
        <button type="button" onClick={onClose}>
          {t("dialog.close")}
        </button>
      </div>
    </Dialog>
  );
}

/** Picks a folder's color, for the reader only, as in Google Drive. */
export function ColorDialog({ item, onChosen, onClose }: { item: Item; onChosen: () => void; onClose: () => void }) {
  const [error, setError] = useState("");
  async function choose(color: FolderColor | null) {
    setError("");
    try {
      if (color) await api("PUT", `/api/drive/items/${item.id}/color`, { color });
      else await api("DELETE", `/api/drive/items/${item.id}/color`);
      onChosen();
    } catch (problem) {
      setError(message(problem));
    }
  }
  return (
    <Dialog title={t("color.title", { name: item.name })} class="color-dialog" onClose={onClose}>
      <p class="hint">{t("color.onlyYou")}</p>
      <div class="swatches" role="radiogroup" aria-label={t("color.label")}>
        {[null, ...FOLDER_COLORS].map((color) => (
          <button
            key={color ?? "none"}
            type="button"
            role="radio"
            aria-checked={item.color === color}
            class="swatch"
            title={t(color ? `color.${color}` : "color.none")}
            onClick={() => void choose(color)}
          >
            <ItemIcon item={{ kind: "folder", name: item.name, color }} />
            <span class="visually-hidden">{t(color ? `color.${color}` : "color.none")}</span>
          </button>
        ))}
      </div>
      {error && (
        <p class="error" role="alert">
          {error}
        </p>
      )}
      <div class="dialog-buttons">
        <button type="button" class="secondary" onClick={onClose}>
          {t("dialog.cancel")}
        </button>
      </div>
    </Dialog>
  );
}
