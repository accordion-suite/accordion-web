// The details panel beside Drive's pages, as in Google Drive: what an item
// is, where it is, who owns it, and who else can open it, and on its
// Activity tab, what happened to it. It shows what's selected, or the folder
// that's open when nothing is, and stays open as the reader moves between
// pages.
//
// A file's details include its format's full name, and what the server read
// from it: a picture's or a video's size, how long a video or a sound lasts,
// and how many pages a document has.

import { useEffect, useRef, useState } from "preact/hooks";

import { api } from "../api.ts";
import { formatLength, formatMoment, formatNumber, formatSize, type MessageKey, t } from "../i18n.ts";
import { followLink } from "../shell/router.ts";
import { ActivityTab } from "./activity.tsx";
import { ShareDialog } from "./dialogs.tsx";
import { CloseIcon, InfoIcon, ItemIcon, kindOf } from "./icons.tsx";
import { folderPath } from "./item-actions.tsx";
import { CardPreview } from "./item-list.tsx";
import { type Item, type ShareEntry, canEdit } from "./item.ts";
import { announceChange, pathTo } from "./store.ts";

const TYPES: Record<string, MessageKey> = {
  folder: "details.folder",
  document: "details.document",
  spreadsheet: "details.spreadsheet",
  presentation: "details.presentation",
  pdf: "details.pdf",
  image: "details.image",
  video: "details.video",
  audio: "details.audio",
  archive: "details.archive",
  code: "details.code",
  font: "details.font",
  ebook: "details.ebook",
  design: "details.design",
  file: "details.file",
};

/** What `GET /api/drive/items/{id}/facts` says about a file. Each is null
 * when the file doesn't have it, or the server hasn't read it yet. */
interface Facts {
  width: number | null;
  height: number | null;
  seconds: number | null;
  pages: number | null;
  /** Whether a document goes on past `pages`. */
  more_pages: boolean;
}

/** The full name of each format, which loads the first time the panel
 * shows a file. */
let formats: Readonly<Record<string, string>> | null = null;

function useFormats(): Readonly<Record<string, string>> | null {
  const [loaded, setLoaded] = useState(formats);
  useEffect(() => {
    if (loaded) return;
    import("../messages/formats.en.ts").then(
      (module) => {
        formats = module.formatsEn;
        setLoaded(formats);
      },
      // Without the names, the panel shows the extension alone.
      () => undefined,
    );
  }, []);
  return loaded;
}

/** A file's extension in lowercase, without the dot, or null. A name that
 * only starts with a dot has none. */
function extensionOf(name: string): string | null {
  const dot = name.lastIndexOf(".");
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : null;
}

/** The kinds of file whose pages the panel counts. A spreadsheet's printed
 * pages don't say much about it. */
const PAGED = new Set(["document", "presentation", "pdf", "ebook"]);

/** Someone who can open an item, and the folder that gives them access if
 * it's one above the item. */
interface Access {
  share: ShareEntry;
  from: Item | null;
}

/** Everyone the owner shared `path`'s last item with, directly or through a
 * folder above it, with the most access each has. */
async function whoHasAccess(path: readonly Item[]): Promise<Access[]> {
  const item = path[path.length - 1]!;
  const shared = path.filter((folder) => folder.shared);
  const lists = await Promise.all(
    shared.map((folder) => api<ShareEntry[]>("GET", `/api/drive/items/${folder.id}/shares`)),
  );
  const people = new Map<string, Access>();
  lists.forEach((shares, at) => {
    const folder = shared[at]!;
    for (const share of shares) {
      const before = people.get(share.user);
      // Closer folders come later, so a tie goes to the closest.
      if (!before || share.level === "editor" || before.share.level === "viewer") {
        people.set(share.user, { share, from: folder.id === item.id ? null : folder });
      }
    }
  });
  return [...people.values()].sort((a, b) => a.share.display_name.localeCompare(b.share.display_name));
}

/** An item's name, with "My Drive" for the reader's top folder. */
function nameOf(item: Item): string {
  return item.parent === null ? t("drive.myDrive") : item.name;
}

export function DetailsPanel({
  items,
  me,
  onClose,
}: {
  items: readonly Item[];
  /** The reader's user ID, so their own changes say "You". */
  me: string;
  onClose: () => void;
}) {
  const only = items.length === 1 ? items[0]! : null;
  // The tab stays as the reader selects other items, as in Google Drive.
  const [tab, setTab] = useState<"details" | "activity">("details");
  return (
    <aside class="details" aria-labelledby="details-title">
      <div class="details-head">
        {only ? <ItemIcon item={only} /> : <InfoIcon />}
        <h2 id="details-title">{only ? nameOf(only) : t("details.title")}</h2>
        <button type="button" class="icon-button" aria-label={t("details.close")} onClick={onClose}>
          <CloseIcon />
        </button>
      </div>
      {only ? (
        <>
          <div class="details-tabs" role="tablist" aria-label={t("details.tabs")}>
            {(["details", "activity"] as const).map((each) => (
              <button
                key={each}
                type="button"
                role="tab"
                id={`details-tab-${each}`}
                aria-controls="details-tab-panel"
                aria-selected={tab === each}
                onClick={() => setTab(each)}
              >
                {t(each === "details" ? "details.tabDetails" : "details.tabActivity")}
              </button>
            ))}
          </div>
          <div id="details-tab-panel" role="tabpanel" aria-labelledby={`details-tab-${tab}`}>
            {tab === "details" ? <About key={only.id} item={only} /> : <ActivityTab key={only.id} item={only} me={me} />}
          </div>
        </>
      ) : (
        <p class="details-empty hint">
          {items.length === 0 ? t("details.none") : t("details.many", { count: items.length })}
        </p>
      )}
    </aside>
  );
}

/** An item's description, which anyone who can edit it changes in place,
 * as in Google Drive. It saves when the field loses focus, and when the
 * panel closes or moves to another item, so nothing typed is lost. */
function Description({ item }: { item: Item }) {
  // Nothing in the trash changes until it's restored.
  const editable = canEdit(item);
  const address = `/api/drive/items/${item.id}/description`;
  const [saved, setSaved] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let current = true;
    api<{ description: string }>("GET", address).then(
      ({ description }) => {
        if (!current) return;
        setSaved(description);
        setText(description);
      },
      (problem: Error) => current && setError(problem.message),
    );
    return () => {
      current = false;
    };
  }, [address]);

  async function save() {
    if (saved === null || text.trim() === saved) return;
    setError("");
    try {
      const { description } = await api<{ description: string }>("PUT", address, { description: text });
      setSaved(description);
      setText(description);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : t("error.problem"));
    }
  }

  const unsaved = useRef<() => void>(() => undefined);
  unsaved.current = () => {
    if (saved !== null && text.trim() !== saved) {
      void api("PUT", address, { description: text }).catch(() => undefined);
    }
  };
  useEffect(() => () => unsaved.current(), []);

  // Someone who can only view sees nothing when there's nothing to read.
  if (saved === null || (!editable && !saved)) return null;
  return (
    <section class="details-section details-description">
      <h3>
        <label for={`description-${item.id}`}>{t("description.title")}</label>
      </h3>
      {editable ? (
        <textarea
          id={`description-${item.id}`}
          placeholder={t("description.add")}
          maxLength={2000}
          value={text}
          onInput={(event) => setText(event.currentTarget.value)}
          onBlur={() => void save()}
        />
      ) : (
        <p id={`description-${item.id}`}>{saved}</p>
      )}
      {error && (
        <p class="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function About({ item }: { item: Item }) {
  const [path, setPath] = useState<Item[] | null>(null);
  const [people, setPeople] = useState<Access[] | null>(null);
  const [error, setError] = useState("");
  const [sharing, setSharing] = useState(false);
  const [facts, setFacts] = useState<Facts | null>(null);
  const names = useFormats();
  const owner = item.access === "owner";

  // The item changes with each reload of the page, such as after a rename
  // or a share, so it's read again then.
  useEffect(() => {
    let current = true;
    pathTo(item)
      .then(async (found) => {
        const access = owner ? await whoHasAccess(found) : null;
        if (!current) return;
        setPath(found);
        setPeople(access);
        setError("");
      })
      .catch((problem: Error) => current && setError(problem.message));
    return () => {
      current = false;
    };
  }, [item]);

  // The facts change with a new version, and the server reads a new file's
  // a little after its thumbnail, so they're read again with the item.
  useEffect(() => {
    if (item.kind !== "file") {
      setFacts(null);
      return;
    }
    let current = true;
    api<Facts>("GET", `/api/drive/items/${item.id}/facts`).then(
      (read) => current && setFacts(read),
      // The panel does without them.
      () => current && setFacts(null),
    );
    return () => {
      current = false;
    };
  }, [item]);

  const kind = kindOf(item);
  const extension = item.kind === "file" ? extensionOf(item.name) : null;
  const formatName = extension ? names?.[extension] : undefined;
  const pages = facts?.pages != null && PAGED.has(kind) ? facts.pages : null;
  const parent = path && path.length > 1 ? path[path.length - 2]! : null;
  const trail = path?.slice(0, -1).map(nameOf) ?? [];
  if (path && item.owner !== null) trail.unshift(t("shared.title"));

  return (
    <div class="details-body">
      {item.kind === "file" && <CardPreview item={item} />}

      <section class="details-section">
        <h3>{t("details.access")}</h3>
        {owner ? (
          people === null ? (
            <p class="hint">{t("shell.loading")}</p>
          ) : (
            <ul class="details-people">
              <li>
                <span>{t("details.you")}</span>
                <span class="hint">{t("share.ownerRole")}</span>
              </li>
              {people.map(({ share, from }) => (
                <li key={share.user}>
                  <span>
                    {share.display_name}
                    {from && <span class="details-from hint">{t("details.from", { folder: nameOf(from) })}</span>}
                  </span>
                  <span class="hint">{t(share.level === "editor" ? "share.editor" : "share.viewer")}</span>
                </li>
              ))}
            </ul>
          )
        ) : (
          <p>
            {t("details.ownedBy", { name: item.owner ?? "" })}
            <br />
            <span class="hint">{t(item.access === "editor" ? "details.canEdit" : "details.canView")}</span>
          </p>
        )}
        {owner && item.parent !== null && !item.trashed_at && (
          <button type="button" class="secondary" onClick={() => setSharing(true)}>
            {t("details.manageAccess")}
          </button>
        )}
        {item.access === "editor" && !item.trashed_at && (
          <button type="button" class="secondary" onClick={() => setSharing(true)}>
            {t("share.open")}
          </button>
        )}
      </section>

      <section class="details-section">
        <h3>{t(item.kind === "folder" ? "details.folderDetails" : "details.fileDetails")}</h3>
        {error && (
          <p class="error" role="alert">
            {error}
          </p>
        )}
        <dl class="details-facts">
          <dt>{t("details.type")}</dt>
          <dd>{t(TYPES[kind] ?? "details.file")}</dd>
          {extension && (
            <>
              <dt>{t("details.format")}</dt>
              <dd>
                {formatName
                  ? t("details.formatNamed", { name: formatName, extension })
                  : t("details.formatExtension", { extension })}
              </dd>
            </>
          )}
          {item.size !== null && (
            <>
              <dt>{t("drive.size")}</dt>
              <dd>{formatSize(item.size)}</dd>
            </>
          )}
          {facts?.width != null && facts.height != null && (
            <>
              <dt>{t("details.dimensions")}</dt>
              <dd>{t("details.pixels", { width: facts.width, height: facts.height })}</dd>
            </>
          )}
          {facts?.seconds != null && (
            <>
              <dt>{t("details.length")}</dt>
              <dd>{formatLength(facts.seconds)}</dd>
            </>
          )}
          {pages !== null && (
            <>
              <dt>{t(kind === "presentation" ? "details.slides" : "details.pages")}</dt>
              <dd>{facts?.more_pages ? t("details.pagesOrMore", { count: pages }) : formatNumber(pages)}</dd>
            </>
          )}
          {path && item.parent !== null && (
            <>
              <dt>{t("drive.location")}</dt>
              <dd>
                {parent ? (
                  <a href={folderPath(parent)} onClick={followLink} title={trail.join(" › ")}>
                    {nameOf(parent)}
                  </a>
                ) : (
                  <a href="/drive/shared" onClick={followLink}>
                    {t("shared.title")}
                  </a>
                )}
              </dd>
            </>
          )}
          <dt>{t("shared.owner")}</dt>
          <dd>{item.owner ?? t("details.me")}</dd>
          <dt>{t("drive.modified")}</dt>
          <dd>{formatMoment(item.modified_at)}</dd>
          <dt>{t("details.created")}</dt>
          <dd>{formatMoment(item.created_at)}</dd>
          {item.trashed_at && (
            <>
              <dt>{t("trash.deleted")}</dt>
              <dd>{formatMoment(item.trashed_at)}</dd>
            </>
          )}
        </dl>
      </section>

      <Description key={item.id} item={item} />

      {sharing && (
        <ShareDialog
          item={item}
          onClose={(changed) => {
            setSharing(false);
            if (changed) announceChange();
          }}
        />
      )}
    </div>
  );
}
