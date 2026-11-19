// Docs (decision 30): the list of documents, and the editor. This module
// and everything it imports load the first time Docs opens.

import "./messages.ts";

import type { ComponentChildren } from "preact";
import type { Command } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { useEffect, useRef, useState } from "preact/hooks";
import * as Y from "yjs";

import { api, type Session } from "../api.ts";
import { NameDialog, ShareDialog } from "../drive/dialogs.tsx";
import { CloseIcon, MoreIcon } from "../drive/icons.tsx";
import { type Item, thumbnailAddress } from "../drive/item.ts";
import { formatDate, formatList, type MessageKey, t } from "../i18n.ts";
import { LiveDocument, type LiveStatus, type Visitor } from "../shell/coedit.ts";
import { Dialog, problemText } from "../shell/dialog.tsx";
import { rememberAppPage } from "../shell/last-app.ts";
import { Menu, type MenuEntry, type MenuPlace, SEPARATOR } from "../shell/menu.tsx";
import { PageThumbnail } from "../shell/page-thumbnail.tsx";
import { PageTitle, useTabTitle } from "../shell/page.tsx";
import { followLink, navigate, usePath } from "../shell/router.ts";
import { TopBar } from "../shell/top-bar.tsx";
import {
  addPicture,
  createDocument,
  type DocumentInfo,
  documentPath,
  downloadAddress,
  NEW_DOCUMENT_PATH,
  type DownloadFormat,
  listDocuments,
  openDocument,
  pictureAddress,
  printAddress,
  renameDocument,
} from "./docs-api.ts";
import {
  createEditor,
  FRAGMENT,
  type Formatting,
  formatting,
  insertPicture,
  insertRule,
  insertTable,
  redo,
  PICTURE_TYPES,
  removeLink,
  selectedText,
  setLink,
  setStyle,
  tableCommands,
  toggle,
  toggleList,
  toggleQuote,
  undo,
} from "./editor.ts";
import {
  BoldIcon,
  BulletsIcon,
  ChecklistIcon,
  CodeIcon,
  DocIcon,
  ItalicIcon,
  LinkIcon,
  NumbersIcon,
  PictureIcon,
  QuoteIcon,
  RedoIcon,
  RuleIcon,
  StrikeIcon,
  TableIcon,
  UnderlineIcon,
  UndoIcon,
} from "./icons.tsx";
import {
  defaultPageSize,
  fromPoints,
  MARGIN_PRESETS,
  type MarginPreset,
  marginPreset,
  newPageSetup,
  PAGE,
  PAGE_SIZES,
  type PageSetup,
  type PageSize,
  pagePoints,
  readPage,
  toPoints,
  usesInches,
  writePage,
} from "./page-setup.ts";
import { linkFromTyped } from "./schema.ts";

export function Docs({ session, onSignOut }: { session: Session; onSignOut: () => void }) {
  const path = usePath();
  const opened = /^\/docs\/d\/([^/]+)\/?$/.exec(path)?.[1] ?? null;
  // A new document gets its file, and its address, as someone starts
  // writing, and stays the same page while the address changes.
  const started = useRef<string | null>(null);
  useEffect(() => rememberAppPage("docs", path), [path]);
  const editing = path === NEW_DOCUMENT_PATH || opened !== null;
  return (
    <>
      <TopBar session={session} onSignOut={onSignOut} module={t("apps.docs")} home="/docs/" />
      {editing ? (
        <DocumentPage
          key={opened === null || opened === started.current ? "new" : opened}
          id={opened}
          session={session}
          onStarted={(id) => {
            started.current = id;
            navigate(documentPath(id), { replace: true });
          }}
        />
      ) : (
        <DocsHome />
      )}
    </>
  );
}

/** Docs' home: a new document, and the documents the reader has. */
function DocsHome() {
  const [documents, setDocuments] = useState<DocumentInfo[] | null>(null);
  const [error, setError] = useState("");
  const [menu, setMenu] = useState<{ document: DocumentInfo; place: MenuPlace; byKeyboard: boolean } | null>(null);
  const [renaming, setRenaming] = useState<DocumentInfo | null>(null);
  const [notice, setNotice] = useState<HomeNotice | null>(null);

  function load() {
    listDocuments().then(
      (found) => setDocuments(found.documents),
      () => setError(t("docs.loadFailed")),
    );
  }

  useEffect(load, []);

  function changed(document: DocumentInfo) {
    setDocuments((now) => now && now.map((other) => (other.id === document.id ? document : other)));
  }

  async function trash(document: DocumentInfo) {
    try {
      await api("DELETE", `/api/drive/items/${document.id}`);
    } catch (problem) {
      setNotice({ text: problemText(problem), problem: true });
      return;
    }
    setDocuments((now) => now && now.filter((other) => other.id !== document.id));
    // Someone else's document goes to its owner's trash, and only the
    // owner can put it back, as in Drive.
    if (document.access !== "owner") {
      setNotice({ text: t("drive.trashedSharedOne", { name: document.name }) });
      return;
    }
    setNotice({
      text: t("drive.trashedOne", { name: document.name }),
      async undo() {
        try {
          await api("POST", `/api/drive/items/${document.id}/restore`);
          setNotice({ text: t("drive.restoredOne", { name: document.name }) });
        } catch (problem) {
          setNotice({ text: problemText(problem), problem: true });
        }
        load();
      },
    });
  }

  function entries(document: DocumentInfo): MenuEntry[] {
    const entries: MenuEntry[] = [
      { label: t("shortcuts.newTab"), onSelect: () => window.open(documentPath(document.id), "_blank", "noopener") },
    ];
    if (document.access !== "viewer") {
      entries.push(
        { label: t("drive.rename"), onSelect: () => setRenaming(document) },
        SEPARATOR,
        { label: t("drive.toTrash"), onSelect: () => void trash(document) },
      );
    }
    return entries;
  }

  return (
    <main class="page docs-home">
      <PageTitle bare>{t("docs.title")}</PageTitle>
      <section class="docs-start" aria-labelledby="docs-start-title">
        <h2 id="docs-start-title">{t("docs.newTitle")}</h2>
        <button type="button" class="docs-blank" onClick={() => navigate(NEW_DOCUMENT_PATH)}>
          <span class="docs-blank-page" aria-hidden="true">
            <span class="docs-blank-plus" />
          </span>
          <span>{t("docs.new")}</span>
        </button>
      </section>
      {error && (
        <p class="error" role="alert">
          {error}
        </p>
      )}
      <section class="docs-recent" aria-labelledby="docs-recent-title">
        <div class="docs-recent-head">
          <h2 id="docs-recent-title">{t("docs.recent")}</h2>
          <a href="/drive/place/docs" onClick={followLink}>
            {t("docs.showInDrive")}
          </a>
        </div>
        {documents === null ? (
          !error && <p class="loading">{t("shell.loading")}</p>
        ) : documents.length === 0 ? (
          <p class="hint">{t("docs.none")}</p>
        ) : (
          <ul class="docs-grid">
            {documents.map((document) => (
              <li key={document.id}>
                <DocumentCard
                  document={document}
                  menuOpen={menu?.document.id === document.id}
                  onMenu={(place, byKeyboard) => setMenu({ document, place, byKeyboard })}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
      {menu && (
        <Menu
          label={t("drive.actionsFor", { name: menu.document.name })}
          entries={entries(menu.document)}
          place={menu.place}
          align="end"
          byKeyboard={menu.byKeyboard}
          onClose={() => setMenu(null)}
        />
      )}
      {renaming && (
        <NameDialog
          title={t("drive.renameNamed", { name: renaming.name })}
          submit={t("drive.rename")}
          initial={renaming.name}
          file
          onSubmit={async (name) => {
            const named = await renameDocument(renaming.id, name);
            changed({ ...renaming, name: named });
            setRenaming(null);
            setNotice({ text: t("drive.renamed", { name: named }) });
          }}
          onClose={() => setRenaming(null)}
        />
      )}
      {notice && (
        <div class="notice-area" role="status">
          <HomeNoticeView notice={notice} onClose={() => setNotice(null)} />
        </div>
      )}
    </main>
  );
}

/** A document on Docs' home: the top of its page, its name, who owns it if
 * someone shared it, and when it last changed. The page shows the editor's icon until the
 * server has made its thumbnail. */
function DocumentCard({
  document,
  menuOpen,
  onMenu,
}: {
  document: DocumentInfo;
  menuOpen: boolean;
  /** Opens the document's menu, from its button or a right-click. */
  onMenu: (place: MenuPlace, byKeyboard: boolean) => void;
}) {
  const [failed, setFailed] = useState(false);
  const thumbnail = document.thumbnail === "page" && document.sha256 && !failed;
  return (
    <div class="docs-card-frame">
      <a
        class="docs-card"
        href={documentPath(document.id)}
        onClick={followLink}
        onContextMenu={(event) => {
          event.preventDefault();
          onMenu({ x: event.clientX, y: event.clientY }, false);
        }}
      >
        <span class={thumbnail ? "docs-card-page has-page" : "docs-card-page"} aria-hidden="true">
          {thumbnail ? <PageThumbnail src={thumbnailAddress(document)} onError={() => setFailed(true)} /> : <DocIcon />}
        </span>
        <span class="docs-card-name">
          <span class="docs-card-icon">
            <DocIcon />
          </span>
          <span class="docs-card-title">{document.name}</span>
        </span>
        {document.owner && <span class="docs-card-meta">{document.owner}</span>}
        <span class="docs-card-meta">{formatDate(document.modified_at)}</span>
      </a>
      <button
        type="button"
        class="icon-button docs-card-more"
        title={t("docs.more")}
        aria-label={t("drive.moreActions", { name: document.name })}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={(event) => onMenu({ under: event.currentTarget }, event.detail === 0)}
      >
        <MoreIcon />
      </button>
    </div>
  );
}

/** Something that just happened on Docs' home, such as a document moved to
 * the trash, with a way to undo it. */
interface HomeNotice {
  text: string;
  problem?: boolean;
  undo?: () => Promise<void>;
}

function HomeNoticeView({ notice, onClose }: { notice: HomeNotice; onClose: () => void }) {
  // Notices go after a while, as Drive's do.
  useEffect(() => {
    const timer = window.setTimeout(onClose, 8000);
    return () => window.clearTimeout(timer);
  }, [notice]);
  return (
    <div class={notice.problem ? "notice problem" : "notice"}>
      <span>{notice.text}</span>
      {notice.undo && (
        <button
          type="button"
          class="link notice-undo"
          onClick={() => {
            const undo = notice.undo!;
            onClose();
            void undo();
          }}
        >
          {t("drive.undo")}
        </button>
      )}
      <button type="button" class="icon-button" aria-label={t("dialog.close")} onClick={onClose}>
        <CloseIcon />
      </button>
    </div>
  );
}

/** A document open for editing, with everyone else who has it open. A new
 * document (`id` null) starts in the browser alone, and gets its file once
 * something in it changes. */
function DocumentPage({
  id,
  session,
  onStarted,
}: {
  id: string | null;
  session: Session;
  /** A new document has its file, with this ID. */
  onStarted: (id: string) => void;
}) {
  // What the page opened. A new document's address changes once it has a
  // file, but it's the same page.
  const [opening] = useState(id);
  const [info, setInfo] = useState<DocumentInfo | null>(opening ? null : draftInfo);
  const [failed, setFailed] = useState(false);
  const [status, setStatus] = useState<LiveStatus>(opening ? "connecting" : "live");
  const [visitors, setVisitors] = useState<Visitor[]>([]);
  const [format, setFormat] = useState<Formatting | null>(null);
  const [linking, setLinking] = useState<{ href: string } | null>(null);
  const [sharing, setSharing] = useState<Item | null>(null);
  const [page, setPage] = useState<PageSetup | null>(null);
  const [settingUp, setSettingUp] = useState(false);
  const [fileMenu, setFileMenu] = useState<{ place: MenuPlace; byKeyboard: boolean } | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const mount = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const live = useRef<LiveDocument | null>(null);
  /** The file's ID, once there is one. */
  const fileId = useRef(opening);
  const making = useRef<Promise<string> | null>(null);
  useTabTitle(t("shell.tabTitle", { page: info?.name ?? t("docs.title") }));

  useEffect(() => {
    if (!opening) return;
    let current = true;
    openDocument(opening).then(
      (opened) => current && setInfo(opened),
      () => current && setFailed(true),
    );
    return () => {
      current = false;
    };
  }, [opening]);

  const readOnly = info?.access === "viewer";
  const loaded = info !== null;

  // The editor appears once the document has arrived from the server, so
  // it never starts from an empty page of its own. A new document's
  // editor starts at once.
  useEffect(() => {
    if (!loaded) return;
    const id = fileId.current;
    const me = { name: session.user.display_name };
    const document = id
      ? new LiveDocument(liveAddress(id), checkAddress(id), me, (next) => {
          setStatus(next);
          if (next === "live" && !view.current) start(document);
        })
      : new LiveDocument(null, "", me, (next) => {
          // Joining the file just made isn't news: the page is already here.
          if (next !== "connecting") setStatus(next);
        });
    live.current = document;
    const others = () => setVisitors(document.visitors());
    document.awareness.on("change", others);
    const pageMap = document.doc.getMap<unknown>(PAGE);
    const showPage = () => setPage(readPage(pageMap));
    pageMap.observe(showPage);
    let firstChange: (() => void) | null = null;
    if (!id) {
      // The same single empty paragraph the server's new documents have.
      document.doc.getXmlFragment(FRAGMENT).insert(0, [new Y.XmlElement("paragraph")]);
      start(document);
      firstChange = () => {
        if (fileId.current) {
          document.doc.off("update", firstChange!);
          return;
        }
        void makeFile().catch(() => undefined);
      };
      document.doc.on("update", firstChange);
    }
    return () => {
      if (firstChange) document.doc.off("update", firstChange);
      pageMap.unobserve(showPage);
      document.awareness.off("change", others);
      view.current?.destroy();
      view.current = null;
      document.close();
      live.current = null;
    };
  }, [loaded, readOnly]);

  function start(document: LiveDocument) {
    if (!mount.current) return;
    view.current = createEditor(mount.current, document, {
      readOnly,
      onChange: () => view.current && setFormat(formatting(view.current.state)),
      onLink: () => startLink(),
      pictureAddress: (hash) => pictureAddress(fileId.current ?? "", hash),
      onPictures: (files) => void addPictures(files),
    });
    setFormat(formatting(view.current.state));
    // A new document, or one from before page setup, gets the paper of the
    // first editor to open it.
    const pageMap = document.doc.getMap<unknown>(PAGE);
    if (!readOnly && !readPage(pageMap)) writePage(pageMap, newPageSetup(defaultPageSize()));
    setPage(readPage(pageMap));
    view.current.focus();
  }

  /** The file's ID, making the file first for a new document. Its state
   * becomes the file's, and what changes meanwhile goes in on joining. */
  function makeFile(): Promise<string> {
    if (fileId.current) return Promise.resolve(fileId.current);
    making.current ??= (async () => {
      const document = live.current;
      if (!document) throw new Error("closed");
      const made = await createDocument(defaultPageSize(), Y.encodeStateAsUpdate(document.doc));
      fileId.current = made.id;
      setInfo(made);
      document.join(liveAddress(made.id), checkAddress(made.id));
      onStarted(made.id);
      return made.id;
    })().catch((problem: unknown) => {
      // The next change tries again.
      making.current = null;
      setError(t("docs.makeFailed", { problem: problemText(problem) }));
      throw problem;
    });
    return making.current;
  }

  // The page on screen is as wide as the paper, with its margins.
  useEffect(() => {
    const element = mount.current;
    if (!element) return;
    const properties = ["--page-width", "--page-height", "--margin-top", "--margin-right", "--margin-bottom", "--margin-left"];
    if (!page) {
      properties.forEach((property) => element.style.removeProperty(property));
      return;
    }
    const [width, height] = pagePoints(page);
    [width, height, ...page.margins].forEach((points, index) => element.style.setProperty(properties[index]!, `${points}pt`));
  }, [page, info]);

  // Ctrl+P prints the document, not the editor around it.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "p") {
        event.preventDefault();
        void print();
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  async function print(note = "") {
    setError("");
    setNotice(note);
    try {
      await printDocument(await makeFile());
    } catch {
      setNotice("");
      setError(t("docs.printFailed"));
    }
  }

  async function download(format: DownloadFormat) {
    let id: string;
    try {
      id = await makeFile();
    } catch {
      return;
    }
    const link = document.createElement("a");
    link.href = downloadAddress(id, format);
    // The server names the file after the document, with the format's
    // extension.
    link.download = "";
    link.click();
  }

  /** Adds pictures where the caret is, one after another, each once the
   * server has checked and shrunk it. */
  async function addPictures(files: File[]) {
    setError("");
    for (const file of files) {
      setNotice(t("docs.addingPicture"));
      try {
        const added = await addPicture(await makeFile(), file);
        run(insertPicture(added.hash));
      } catch (problem) {
        setError(problemText(problem));
        break;
      }
    }
    setNotice("");
  }

  function run(command: Command) {
    const editor = view.current;
    if (!editor) return;
    command(editor.state, editor.dispatch, editor);
    editor.focus();
  }

  function startLink() {
    const editor = view.current;
    if (!editor) return;
    const now = formatting(editor.state);
    const selected = selectedText(editor.state);
    setLinking({ href: now.link ?? (linkFromTyped(selected) && /\.\w/.test(selected) ? selected : "") });
  }

  async function share() {
    try {
      const id = await makeFile();
      setSharing(await api<Item>("GET", `/api/drive/items/${id}`));
    } catch (problem) {
      setError(problemText(problem));
    }
  }

  async function rename(name: string): Promise<string> {
    return renameDocument(await makeFile(), name);
  }

  if (failed) {
    return (
      <main class="page narrow">
        <p class="error" role="alert">
          {t("docs.loadDocumentFailed")}
        </p>
      </main>
    );
  }
  if (!info) return <p class="loading">{t("shell.loading")}</p>;

  const statusText =
    status === "connecting"
      ? t("docs.connecting")
      : status === "reconnecting"
        ? t("docs.reconnecting")
        : status === "gone"
          ? t("docs.gone")
          : status === "signedOut"
            ? t("docs.signedOut")
            : "";

  return (
    <div class="docs-document">
      <div class="docs-head">
        <DocIcon />
        <DocumentName
          info={info}
          rename={rename}
          onRenamed={(name) => setInfo({ ...info, name })}
          onError={(problem) => setError(t("docs.renameFailed", { problem }))}
        />
        {readOnly && <span class="docs-badge">{t("docs.viewOnly")}</span>}
        <span class="spacer" />
        {visitors.length > 0 && (
          <span class="docs-visitors" title={t("docs.others", { names: formatList(visitors.map((visitor) => visitor.name)) })}>
            {visitors.slice(0, 4).map((visitor) => (
              <Initials key={visitor.name} visitor={visitor} />
            ))}
          </span>
        )}
        <button
          type="button"
          class="secondary docs-file"
          aria-haspopup="menu"
          aria-expanded={fileMenu !== null}
          onClick={(event) => setFileMenu({ place: { under: event.currentTarget }, byKeyboard: event.detail === 0 })}
        >
          {t("docs.file")}
        </button>
        <button type="button" onClick={() => void share()}>
          {t("docs.share")}
        </button>
      </div>
      {!readOnly && format && (
        <Toolbar
          format={format}
          run={run}
          onLink={startLink}
          onPictures={(files) => void addPictures(files)}
        />
      )}
      {(statusText || error || notice) && (
        <p class={status === "gone" || status === "signedOut" || error ? "error docs-status" : "hint docs-status"} role="status">
          {error || statusText || notice}
        </p>
      )}
      <div class="docs-canvas">
        <div class="docs-page" ref={mount} />
      </div>
      {linking && (
        <LinkDialog
          href={linking.href}
          hasLink={format?.link !== null}
          onApply={(href) => {
            setLinking(null);
            run(setLink(href));
          }}
          onRemove={() => {
            setLinking(null);
            run(removeLink);
          }}
          onClose={() => {
            setLinking(null);
            view.current?.focus();
          }}
        />
      )}
      {sharing && <ShareDialog item={sharing} onClose={() => setSharing(null)} />}
      {fileMenu && (
        <Menu
          label={t("docs.file")}
          entries={[
            ...(readOnly ? [] : [{ label: t("docs.pageSetup"), onSelect: () => setSettingUp(true) }]),
            { label: t("docs.print"), shortcut: t("docs.printShortcut"), onSelect: () => void print() },
            "separator",
            { label: t("docs.downloadDocx"), onSelect: () => void download("docx") },
            { label: t("docs.downloadOdt"), onSelect: () => void download("odt") },
            { label: t("docs.downloadPdf"), onSelect: () => void print(t("docs.pdfHint")) },
            { label: t("docs.downloadHtml"), onSelect: () => void download("html") },
            { label: t("docs.downloadMd"), onSelect: () => void download("md") },
          ]}
          place={fileMenu.place}
          align="end"
          byKeyboard={fileMenu.byKeyboard}
          onClose={() => setFileMenu(null)}
        />
      )}
      {settingUp && live.current && (
        <PageSetupDialog
          setup={page ?? newPageSetup(defaultPageSize())}
          onApply={(setup) => {
            if (live.current) writePage(live.current.doc.getMap<unknown>(PAGE), setup);
            setSettingUp(false);
            view.current?.focus();
          }}
          onClose={() => {
            setSettingUp(false);
            view.current?.focus();
          }}
        />
      )}
    </div>
  );
}

/** Prints the document from its print page, in a frame the reader doesn't
 * see, so it comes out as anyone opening the file would see it, on its own
 * paper. Browsers offer Save as PDF in the same window. */
/** A new document, before it has a file. */
function draftInfo(): DocumentInfo {
  return {
    id: "",
    name: `${t("docs.untitled")}.html`,
    folder: null,
    modified_at: "",
    access: "owner",
    owner: null,
    sha256: null,
    thumbnail: null,
    thumbnail_version: null,
  };
}

function liveAddress(id: string): string {
  return `/api/docs/documents/${id}/live`;
}

function checkAddress(id: string): string {
  return `/api/docs/documents/${id}`;
}

function printDocument(id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const frame = document.createElement("iframe");
    frame.className = "docs-print-frame";
    frame.setAttribute("aria-hidden", "true");
    frame.tabIndex = -1;
    const done = () => setTimeout(() => frame.remove(), 1000);
    frame.addEventListener("load", () => {
      const page = frame.contentWindow;
      // An error page has no <main>: the document is gone or the
      // connection failed.
      if (!page || !frame.contentDocument?.querySelector("main")) {
        frame.remove();
        reject(new Error("no print page"));
        return;
      }
      page.addEventListener("afterprint", done);
      page.focus();
      page.print();
      resolve();
    });
    frame.addEventListener("error", () => {
      frame.remove();
      reject(new Error("no print page"));
    });
    frame.src = printAddress(id);
    document.body.append(frame);
  });
}

const SIZE_NAMES: Record<PageSize, MessageKey> = {
  letter: "docs.sizeLetter",
  a4: "docs.sizeA4",
  legal: "docs.sizeLegal",
  a5: "docs.sizeA5",
  a3: "docs.sizeA3",
  tabloid: "docs.sizeTabloid",
};

const PRESET_NAMES: Record<MarginPreset, MessageKey> = {
  normal: "docs.marginsNormal",
  narrow: "docs.marginsNarrow",
  wide: "docs.marginsWide",
};

/** Paper size, which way up, and margins, in inches or centimeters as the
 * reader's region measures them. */
function PageSetupDialog({
  setup,
  onApply,
  onClose,
}: {
  setup: PageSetup;
  onApply: (setup: PageSetup) => void;
  onClose: () => void;
}) {
  const inches = usesInches();
  const [size, setSize] = useState(setup.size);
  const [landscape, setLandscape] = useState(setup.landscape);
  const [typed, setTyped] = useState(setup.margins.map((points) => String(fromPoints(points, inches))));
  const [problem, setProblem] = useState("");
  const typedPoints = typed.map((value) => toPoints(Number(value.replace(",", ".")), inches));
  const preset = typed.every((value) => value.trim() !== "" && Number.isFinite(Number(value.replace(",", "."))))
    ? marginPreset(typedPoints as PageSetup["margins"])
    : null;
  const unit = inches ? t("docs.unitInches") : t("docs.unitCentimeters");
  const sides = ["docs.marginTop", "docs.marginRight", "docs.marginBottom", "docs.marginLeft"] as const;

  function choosePreset(name: string) {
    if (!(name in MARGIN_PRESETS)) return;
    setTyped(MARGIN_PRESETS[name as MarginPreset].map((points) => String(fromPoints(points, inches))));
  }

  return (
    <Dialog title={t("docs.pageSetupTitle")} class="docs-setup-dialog" onClose={onClose}>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          const margins = typedPoints as PageSetup["margins"];
          if (typed.some((value) => value.trim() === "") || margins.some((points) => !Number.isFinite(points) || points < 0)) {
            setProblem(t("docs.marginsInvalid"));
            return;
          }
          const wanted: PageSetup = { size, landscape, margins };
          const [width, height] = pagePoints(wanted);
          if (margins[1] + margins[3] > width - 72 || margins[0] + margins[2] > height - 72 || margins.some((points) => points > 288)) {
            setProblem(t("docs.marginsTooBig", { most: fromPoints(288, inches), unit }));
            return;
          }
          onApply(wanted);
        }}
      >
        <label>
          {t("docs.paperSize")}
          <select value={size} onChange={(event) => setSize(event.currentTarget.value as PageSize)}>
            {PAGE_SIZES.map((each) => (
              <option key={each} value={each}>
                {t(SIZE_NAMES[each])}
              </option>
            ))}
          </select>
        </label>
        <fieldset class="docs-orientation">
          <legend>{t("docs.orientation")}</legend>
          <label>
            <input type="radio" name="orientation" checked={!landscape} onChange={() => setLandscape(false)} />
            {t("docs.portrait")}
          </label>
          <label>
            <input type="radio" name="orientation" checked={landscape} onChange={() => setLandscape(true)} />
            {t("docs.landscape")}
          </label>
        </fieldset>
        <label>
          {t("docs.margins")}
          <select value={preset ?? "custom"} onChange={(event) => choosePreset(event.currentTarget.value)}>
            {(Object.keys(MARGIN_PRESETS) as MarginPreset[]).map((name) => (
              <option key={name} value={name}>
                {t(PRESET_NAMES[name], {
                  side: fromPoints(MARGIN_PRESETS[name][3], inches),
                  top: fromPoints(MARGIN_PRESETS[name][0], inches),
                  unit,
                })}
              </option>
            ))}
            <option value="custom">{t("docs.marginsCustom")}</option>
          </select>
        </label>
        <div class="docs-margin-fields">
          {sides.map((side, index) => (
            <label key={side}>
              {t(side, { unit })}
              <input
                type="text"
                inputMode="decimal"
                value={typed[index]}
                onInput={(event) => {
                  const value = event.currentTarget.value;
                  setTyped((now) => now.map((each, at) => (at === index ? value : each)));
                }}
              />
            </label>
          ))}
        </div>
        <p class="error" role="alert">
          {problem}
        </p>
        <div class="dialog-buttons">
          <button type="button" class="secondary" onClick={onClose}>
            {t("docs.cancel")}
          </button>
          <button type="submit">{t("docs.pageSetupApply")}</button>
        </div>
      </form>
    </Dialog>
  );
}

/** The document's name, which the owner and editors can change. */
function DocumentName({
  info,
  rename,
  onRenamed,
  onError,
}: {
  info: DocumentInfo;
  rename: (name: string) => Promise<string>;
  onRenamed: (name: string) => void;
  onError: (problem: string) => void;
}) {
  const [value, setValue] = useState(info.name);
  const field = useRef<HTMLInputElement>(null);
  // A new document's file gets its name while someone may be typing one.
  useEffect(() => {
    if (document.activeElement !== field.current) setValue(info.name);
  }, [info.name]);
  const readOnly = info.access === "viewer";

  async function save() {
    const typed = value.trim();
    if (!typed || typed === info.name) {
      setValue(info.name);
      return;
    }
    try {
      onRenamed(await rename(typed));
    } catch (problem) {
      setValue(info.name);
      onError(problemText(problem));
    }
  }

  return (
    <input
      ref={field}
      class="docs-name"
      aria-label={t("docs.name")}
      value={value}
      readOnly={readOnly}
      onInput={(event) => setValue(event.currentTarget.value)}
      onFocus={(event) => {
        // The name without its extension, as Drive's rename does.
        const dot = event.currentTarget.value.lastIndexOf(".");
        if (!readOnly && dot > 0) event.currentTarget.setSelectionRange(0, dot);
      }}
      onBlur={() => void save()}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          setValue(info.name);
          event.currentTarget.blur();
        }
      }}
    />
  );
}

function Initials({ visitor }: { visitor: Visitor }) {
  const initials = visitor.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join("");
  return (
    <span class="docs-visitor" ref={(element) => element?.style.setProperty("--caret", visitor.color)} title={visitor.name}>
      {initials}
    </span>
  );
}

type Run = (command: Command) => void;

function Toolbar({
  format,
  run,
  onLink,
  onPictures,
}: {
  format: Formatting;
  run: Run;
  onLink: () => void;
  onPictures: (files: File[]) => void;
}) {
  const [tableMenu, setTableMenu] = useState<{ place: MenuPlace; byKeyboard: boolean } | null>(null);
  const choosePictures = useRef<HTMLInputElement>(null);
  const markButton = (on: boolean, label: string, command: Command, icon: ComponentChildren) => (
    <ToolButton label={label} pressed={on} onClick={() => run(command)}>
      {icon}
    </ToolButton>
  );
  return (
    <div class="docs-toolbar" role="toolbar" aria-label={t("docs.toolbar")}>
      <ToolButton label={t("docs.undo")} onClick={() => run(undo)}>
        <UndoIcon />
      </ToolButton>
      <ToolButton label={t("docs.redo")} onClick={() => run(redo)}>
        <RedoIcon />
      </ToolButton>
      <span class="docs-toolbar-gap" />
      <select
        class="docs-style"
        aria-label={t("docs.style")}
        value={format.style}
        onChange={(event) => run(setStyle(event.currentTarget.value))}
      >
        <option value="paragraph">{t("docs.styleNormal")}</option>
        {[1, 2, 3].map((level) => (
          <option key={level} value={`heading-${level}`}>
            {t("docs.styleHeading", { level })}
          </option>
        ))}
        <option value="code">{t("docs.styleCode")}</option>
      </select>
      <span class="docs-toolbar-gap" />
      {markButton(format.bold, t("docs.bold"), toggle.bold(), <BoldIcon />)}
      {markButton(format.italic, t("docs.italic"), toggle.italic(), <ItalicIcon />)}
      {markButton(format.underline, t("docs.underline"), toggle.underline(), <UnderlineIcon />)}
      {markButton(format.strike, t("docs.strike"), toggle.strike(), <StrikeIcon />)}
      {markButton(format.code, t("docs.inlineCode"), toggle.code(), <CodeIcon />)}
      <ToolButton label={t("docs.link")} pressed={format.link !== null} onClick={onLink}>
        <LinkIcon />
      </ToolButton>
      <span class="docs-toolbar-gap" />
      <ToolButton label={t("docs.bullets")} pressed={format.list === "bullets"} onClick={() => run(toggleList("bullets"))}>
        <BulletsIcon />
      </ToolButton>
      <ToolButton label={t("docs.numbers")} pressed={format.list === "numbers"} onClick={() => run(toggleList("numbers"))}>
        <NumbersIcon />
      </ToolButton>
      <ToolButton label={t("docs.checklist")} pressed={format.list === "checks"} onClick={() => run(toggleList("checks"))}>
        <ChecklistIcon />
      </ToolButton>
      <ToolButton label={t("docs.quote")} pressed={format.quote} onClick={() => run(toggleQuote())}>
        <QuoteIcon />
      </ToolButton>
      <span class="docs-toolbar-gap" />
      <ToolButton label={t("docs.picture")} onClick={() => choosePictures.current?.click()}>
        <PictureIcon />
      </ToolButton>
      <input
        ref={choosePictures}
        type="file"
        accept={PICTURE_TYPES.join(",")}
        multiple
        hidden
        onChange={(event) => {
          const files = [...(event.currentTarget.files ?? [])];
          event.currentTarget.value = "";
          if (files.length) onPictures(files);
        }}
      />
      <ToolButton label={t("docs.rule")} onClick={() => run(insertRule)}>
        <RuleIcon />
      </ToolButton>
      {format.table ? (
        <button
          type="button"
          class="icon-button docs-tool"
          title={t("docs.tableMenu")}
          aria-label={t("docs.tableMenu")}
          aria-haspopup="menu"
          aria-expanded={tableMenu !== null}
          onClick={(event) => setTableMenu({ place: { under: event.currentTarget }, byKeyboard: event.detail === 0 })}
        >
          <TableIcon />
        </button>
      ) : (
        <ToolButton label={t("docs.table")} onClick={() => run(insertTable)}>
          <TableIcon />
        </ToolButton>
      )}
      {tableMenu && (
        <Menu
          label={t("docs.tableMenu")}
          entries={[
            { label: t("docs.rowAbove"), onSelect: () => run(tableCommands.rowAbove) },
            { label: t("docs.rowBelow"), onSelect: () => run(tableCommands.rowBelow) },
            { label: t("docs.columnLeft"), onSelect: () => run(tableCommands.columnLeft) },
            { label: t("docs.columnRight"), onSelect: () => run(tableCommands.columnRight) },
            "separator",
            { label: t("docs.headerRow"), onSelect: () => run(tableCommands.headerRow) },
            "separator",
            { label: t("docs.deleteRow"), onSelect: () => run(tableCommands.deleteRow) },
            { label: t("docs.deleteColumn"), onSelect: () => run(tableCommands.deleteColumn) },
            { label: t("docs.deleteTable"), onSelect: () => run(tableCommands.deleteTable) },
          ]}
          place={tableMenu.place}
          byKeyboard={tableMenu.byKeyboard}
          onClose={() => setTableMenu(null)}
        />
      )}
    </div>
  );
}

function ToolButton({
  label,
  pressed,
  onClick,
  children,
}: {
  label: string;
  pressed?: boolean;
  onClick: () => void;
  children: ComponentChildren;
}) {
  return (
    <button
      type="button"
      class="icon-button docs-tool"
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      // The editor keeps its selection while a button is pressed.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function LinkDialog({
  href,
  hasLink,
  onApply,
  onRemove,
  onClose,
}: {
  href: string;
  hasLink: boolean;
  onApply: (href: string) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const [typed, setTyped] = useState(href);
  const [problem, setProblem] = useState("");
  return (
    <Dialog title={t("docs.linkTitle")} onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const link = linkFromTyped(typed);
          if (!link) {
            setProblem(t("docs.linkInvalid"));
            return;
          }
          onApply(link);
        }}
      >
        <label class="field">
          <span>{t("docs.linkAddress")}</span>
          <input type="text" inputMode="url" autoFocus value={typed} onInput={(event) => setTyped(event.currentTarget.value)} />
        </label>
        {problem && (
          <p class="error" role="alert">
            {problem}
          </p>
        )}
        <div class="dialog-buttons">
          {hasLink && (
            <button type="button" class="secondary" onClick={onRemove}>
              {t("docs.linkRemove")}
            </button>
          )}
          <span class="spacer" />
          <button type="button" class="secondary" onClick={onClose}>
            {t("docs.cancel")}
          </button>
          <button type="submit">{t("docs.linkApply")}</button>
        </div>
      </form>
    </Dialog>
  );
}
