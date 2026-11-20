// Docs (decision 30): the list of documents, and the editor. This module
// and everything it imports load the first time Docs opens.

import "./messages.ts";

import type { ComponentChildren, RefObject } from "preact";
import { deleteSelection, selectAll } from "prosemirror-commands";
import type { Command } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { useEffect, useRef, useState } from "preact/hooks";
import * as Y from "yjs";

import { api, type Session } from "../api.ts";
import { NameDialog, ShareDialog } from "../drive/dialogs.tsx";
import { ChevronIcon, CloseIcon, MoreIcon } from "../drive/icons.tsx";
import { type Item, thumbnailAddress } from "../drive/item.ts";
import { formatDate, formatList, type MessageKey, t } from "../i18n.ts";
import { LiveDocument, type LiveStatus, type Visitor } from "../shell/coedit.ts";
import { Dialog, problemText } from "../shell/dialog.tsx";
import { rememberAppPage } from "../shell/last-app.ts";
import { Menu, type MenuEntry, type MenuPlace, SEPARATOR } from "../shell/menu.tsx";
import { MenuBar, type MenuBarMenu } from "../shell/menu-bar.tsx";
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
  MAX_ALT,
  redo,
  PICTURE_TYPES,
  removeLink,
  type PictureAt,
  selectedPicture,
  selectedText,
  selectPicture,
  setLink,
  tableCommands,
  toggle,
  toggleList,
  toggleQuote,
  undo,
} from "./editor.ts";
import { ColorMenu } from "./color-menu.tsx";
import { addFonts } from "./font-faces.ts";
import { fitSize, FONTS, fontStack, SIZES } from "./fonts.ts";
import {
  AlignIcon,
  BoldIcon,
  BulletsIcon,
  ChecklistIcon,
  ClearFormatIcon,
  CodeIcon,
  DocIcon,
  HighlightIcon,
  IndentLessIcon,
  IndentMoreIcon,
  ItalicIcon,
  LineSpacingIcon,
  LinkIcon,
  MinusIcon,
  NumbersIcon,
  PageBreakIcon,
  PictureIcon,
  PlusIcon,
  QuoteIcon,
  RedoIcon,
  RuleIcon,
  StrikeIcon,
  TableIcon,
  TextColorIcon,
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
import {
  type Align,
  ALIGNS,
  BULLET_STYLES,
  type BulletStyle,
  type Layout,
  LINE_PRESETS,
  LIST_SAMPLES,
  NUMBER_STYLES,
  type NumberStyle,
} from "./layout.ts";
import {
  changeIndent,
  currentNumber,
  insertPageBreak,
  type ParagraphSettings,
  restartNumbering,
  setAlign,
  setLineSpacing,
  setListStyle,
  setParagraph,
  setStyle,
  toggleSpace,
} from "./paragraph.ts";
import { HEADING_LEVELS, linkFromTyped } from "./schema.ts";
import { clearFormatting, setColor, setFont, setHighlight, setSize, stepFontSize } from "./text-style.ts";

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
      {!editing && <TopBar session={session} onSignOut={onSignOut} module={t("apps.docs")} home="/docs/" />}
      {editing ? (
        <DocumentPage
          key={opened === null || opened === started.current ? "new" : opened}
          id={opened}
          session={session}
          onSignOut={onSignOut}
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
  const [menu, setMenu] = useState<{
    document: DocumentInfo;
    place: MenuPlace;
    byKeyboard: boolean;
  } | null>(null);
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
      {
        label: t("shortcuts.newTab"),
        onSelect: () => window.open(documentPath(document.id), "_blank", "noopener"),
      },
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
  onSignOut,
  onStarted,
}: {
  id: string | null;
  session: Session;
  onSignOut: () => void;
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
  const [describing, setDescribing] = useState<PictureAt | null>(null);
  // What to do to the picture once its alt text dialog has gone, since the
  // document can't have focus, or select it, while the dialog is open.
  const described = useRef<{ picture: PictureAt; alt?: string } | null>(null);
  const [sharing, setSharing] = useState<Item | null>(null);
  const [page, setPage] = useState<PageSetup | null>(null);
  const [settingUp, setSettingUp] = useState(false);
  const [spacing, setSpacing] = useState<Layout | null>(null);
  const [restarting, setRestarting] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const mount = useRef<HTMLDivElement>(null);
  const nameField = useRef<HTMLInputElement>(null);
  const choosePictures = useRef<HTMLInputElement>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
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
      onAltText: () => startAltText(),
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
    setLinking({
      href: now.link ?? (linkFromTyped(selected) && /\.\w/.test(selected) ? selected : ""),
    });
  }

  function startSpacing() {
    const layout = view.current && formatting(view.current.state).layout;
    if (layout) setSpacing(layout);
  }

  function startRestart() {
    if (view.current) setRestarting(currentNumber(view.current.state));
  }

  function startAltText() {
    const picture = view.current && selectedPicture(view.current.state);
    if (picture) setDescribing(picture);
  }

  useEffect(() => {
    const done = described.current;
    if (describing || !done) return;
    described.current = null;
    run(selectPicture(done.picture, done.alt));
  }, [describing]);

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

  /** A notice that goes away by itself after a while. */
  function tell(text: string) {
    clearTimeout(noticeTimer.current);
    setNotice(text);
    noticeTimer.current = setTimeout(() => setNotice((now) => (now === text ? "" : now)), 10_000);
  }
  useEffect(() => () => clearTimeout(noticeTimer.current), []);

  /** Cut or copy from the menu, which browsers allow right after a click. */
  function clipboard(action: "cut" | "copy") {
    const editor = view.current;
    if (!editor) return;
    editor.focus();
    if (!document.execCommand(action)) tell(t("docs.clipboardKeys"));
  }

  /** Paste from the menu. Browsers ask first, or don't allow it, since
   * only a key press shows the person chose to paste. */
  async function paste(plain: boolean) {
    const editor = view.current;
    if (!editor) return;
    editor.focus();
    try {
      if (plain) {
        editor.pasteText(await navigator.clipboard.readText());
        return;
      }
      for (const item of await navigator.clipboard.read()) {
        const picture = item.types.find((type) => PICTURE_TYPES.includes(type));
        if (item.types.includes("text/html")) editor.pasteHTML(await (await item.getType("text/html")).text());
        else if (picture)
          await addPictures([
            new File([await item.getType(picture)], "picture", {
              type: picture,
            }),
          ]);
        else if (item.types.includes("text/plain")) editor.pasteText(await (await item.getType("text/plain")).text());
        else continue;
        return;
      }
    } catch {
      tell(t("docs.pasteKeys"));
    }
  }

  function fullScreen() {
    document.documentElement.requestFullscreen().then(
      () => view.current?.focus(),
      () => undefined,
    );
  }

  function menus(): MenuBarMenu[] {
    const editing = !readOnly && format !== null;
    const file: MenuEntry[] = [
      {
        label: t("docs.newDocument"),
        onSelect: () => window.open(NEW_DOCUMENT_PATH, "_blank", "noopener"),
      },
      SEPARATOR,
      { label: t("docs.shareMenu"), onSelect: () => void share() },
      {
        label: t("docs.download"),
        submenu: [
          {
            label: t("docs.downloadDocx"),
            onSelect: () => void download("docx"),
          },
          {
            label: t("docs.downloadOdt"),
            onSelect: () => void download("odt"),
          },
          {
            label: t("docs.downloadPdf"),
            onSelect: () => void print(t("docs.pdfHint")),
          },
          {
            label: t("docs.downloadHtml"),
            onSelect: () => void download("html"),
          },
          { label: t("docs.downloadMd"), onSelect: () => void download("md") },
        ],
      },
      ...(readOnly
        ? []
        : [
            {
              label: t("docs.renameMenu"),
              onSelect: () => nameField.current?.focus(),
            },
          ]),
      SEPARATOR,
      ...(readOnly ? [] : [{ label: t("docs.pageSetup"), onSelect: () => setSettingUp(true) }]),
      {
        label: t("docs.print"),
        shortcut: t("docs.printShortcut"),
        onSelect: () => void print(),
      },
    ];
    const edit: MenuEntry[] = readOnly
      ? [
          {
            label: t("docs.copy"),
            shortcut: t("docs.copyShortcut"),
            onSelect: () => clipboard("copy"),
          },
          SEPARATOR,
          {
            label: t("docs.selectAll"),
            shortcut: t("docs.selectAllShortcut"),
            onSelect: () => run(selectAll),
          },
        ]
      : [
          {
            label: t("docs.undo"),
            shortcut: t("docs.undoShortcut"),
            onSelect: () => run(undo),
          },
          {
            label: t("docs.redo"),
            shortcut: t("docs.redoShortcut"),
            onSelect: () => run(redo),
          },
          SEPARATOR,
          {
            label: t("docs.cut"),
            shortcut: t("docs.cutShortcut"),
            onSelect: () => clipboard("cut"),
          },
          {
            label: t("docs.copy"),
            shortcut: t("docs.copyShortcut"),
            onSelect: () => clipboard("copy"),
          },
          {
            label: t("docs.paste"),
            shortcut: t("docs.pasteShortcut"),
            onSelect: () => void paste(false),
          },
          {
            label: t("docs.pastePlain"),
            shortcut: t("docs.pastePlainShortcut"),
            onSelect: () => void paste(true),
          },
          SEPARATOR,
          {
            label: t("docs.selectAll"),
            shortcut: t("docs.selectAllShortcut"),
            onSelect: () => run(selectAll),
          },
          { label: t("docs.delete"), onSelect: () => run(deleteSelection) },
        ];
    const all: MenuBarMenu[] = [
      { label: t("docs.file"), entries: () => file },
      { label: t("docs.edit"), entries: () => edit },
    ];
    if (document.fullscreenEnabled) {
      all.push({
        label: t("docs.view"),
        entries: () => [{ label: t("docs.fullScreen"), onSelect: fullScreen }],
      });
    }
    if (editing && format) {
      all.push(
        {
          label: t("docs.insert"),
          entries: () => [
            {
              label: t("docs.menuPicture"),
              onSelect: () => choosePictures.current?.click(),
            },
            { label: t("docs.menuTable"), onSelect: () => run(insertTable) },
            {
              label: t("docs.menuLink"),
              shortcut: t("docs.linkShortcut"),
              onSelect: startLink,
            },
            SEPARATOR,
            { label: t("docs.rule"), onSelect: () => run(insertRule) },
            {
              label: t("docs.pageBreak"),
              shortcut: t("docs.pageBreakShortcut"),
              onSelect: () => run(insertPageBreak),
            },
          ],
        },
        { label: t("docs.format"), entries: () => formatEntries(format) },
      );
    }
    return all;
  }

  function formatEntries(format: Formatting): MenuEntry[] {
    const picture = view.current && selectedPicture(view.current.state);
    const listStyles = (styles: readonly (BulletStyle | NumberStyle)[]) =>
      styles.map((style) => ({
        label: LIST_SAMPLES[style],
        checked: format.listStyle === style,
        onSelect: () => run(setListStyle(style)),
      }));
    return [
      {
        label: t("docs.text"),
        submenu: [
          {
            label: t("docs.bold"),
            shortcut: t("docs.boldShortcut"),
            onSelect: () => run(toggle.bold()),
          },
          {
            label: t("docs.italic"),
            shortcut: t("docs.italicShortcut"),
            onSelect: () => run(toggle.italic()),
          },
          {
            label: t("docs.underline"),
            shortcut: t("docs.underlineShortcut"),
            onSelect: () => run(toggle.underline()),
          },
          {
            label: t("docs.strike"),
            shortcut: t("docs.strikeShortcut"),
            onSelect: () => run(toggle.strike()),
          },
          {
            label: t("docs.superscript"),
            shortcut: t("docs.superscriptShortcut"),
            onSelect: () => run(toggle.superscript()),
          },
          {
            label: t("docs.subscript"),
            shortcut: t("docs.subscriptShortcut"),
            onSelect: () => run(toggle.subscript()),
          },
          {
            label: t("docs.inlineCode"),
            shortcut: t("docs.inlineCodeShortcut"),
            onSelect: () => run(toggle.code()),
          },
          SEPARATOR,
          {
            label: t("docs.larger"),
            shortcut: t("docs.largerShortcut"),
            onSelect: () => run(stepFontSize(1)),
          },
          {
            label: t("docs.smaller"),
            shortcut: t("docs.smallerShortcut"),
            onSelect: () => run(stepFontSize(-1)),
          },
        ],
      },
      {
        label: t("docs.paragraphStyles"),
        submenu: STYLES.map(([style, label, key]) => ({
          label: label(),
          shortcut: key === undefined ? undefined : t("docs.styleShortcut", { key }),
          checked: format.style === style,
          onSelect: () => run(setStyle(style)),
        })),
      },
      ...(format.layout
        ? [
            {
              label: t("docs.alignIndent"),
              submenu: [
                ...alignEntries(format, run),
                SEPARATOR,
                {
                  label: t("docs.indentMore"),
                  shortcut: t("docs.indentMoreShortcut"),
                  onSelect: () => run(changeIndent(1)),
                },
                {
                  label: t("docs.indentLess"),
                  shortcut: t("docs.indentLessShortcut"),
                  onSelect: () => run(changeIndent(-1)),
                },
                SEPARATOR,
                { label: t("docs.customSpacing"), onSelect: startSpacing },
              ],
            },
            {
              label: t("docs.lineSpacing"),
              submenu: spacingEntries(format.layout, run, startSpacing),
            },
          ]
        : []),
      {
        label: t("docs.bulletsNumbering"),
        submenu: [
          { label: t("docs.bullets"), submenu: listStyles(BULLET_STYLES) },
          { label: t("docs.numbers"), submenu: listStyles(NUMBER_STYLES) },
          {
            label: t("docs.checklist"),
            shortcut: t("docs.checklistShortcut"),
            onSelect: () => run(toggleList("checks")),
          },
          ...(format.numbered ? [SEPARATOR, { label: t("docs.restartNumbering"), onSelect: startRestart }] : []),
          ...(format.list
            ? [
                SEPARATOR,
                {
                  label: t("docs.removeList"),
                  onSelect: () => run(toggleList(format.list!)),
                },
              ]
            : []),
        ],
      },
      { label: t("docs.quote"), onSelect: () => run(toggleQuote()) },
      ...(format.table ? [{ label: t("docs.tableMenu"), submenu: tableEntries(run) }] : []),
      ...(picture
        ? [
            {
              label: t("docs.picture"),
              submenu: [
                {
                  label: t("docs.altTextMenu"),
                  shortcut: t("docs.altTextShortcut"),
                  onSelect: startAltText,
                },
                {
                  label: t("docs.resetSize"),
                  onSelect: () => run(resetPictureSize),
                },
              ],
            },
          ]
        : []),
      SEPARATOR,
      {
        label: t("docs.clearFormatting"),
        shortcut: t("docs.clearFormattingShortcut"),
        onSelect: () => run(clearFormatting),
      },
    ];
  }

  // The document's icon and name take Accordion's name's place in the top
  // bar, with Share beside the app picker, so the page starts higher up.
  // The icon leads back to Docs.
  const bar = (children?: ComponentChildren) => (
    <TopBar
      session={session}
      onSignOut={onSignOut}
      className="docs-top-bar"
      brand={
        <a class="docs-home-link" href="/docs/" title={t("docs.backToDocs")} aria-label={t("docs.backToDocs")} onClick={followLink}>
          <DocIcon />
        </a>
      }
    >
      {children}
    </TopBar>
  );

  if (failed) {
    return (
      <>
        {bar()}
        <main class="page narrow">
          <p class="error" role="alert">
            {t("docs.loadDocumentFailed")}
          </p>
        </main>
      </>
    );
  }
  if (!info) {
    return (
      <>
        {bar()}
        <p class="loading">{t("shell.loading")}</p>
      </>
    );
  }

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
      {bar(
        <div class="docs-head">
          <DocumentName
            info={info}
            field={nameField}
            rename={rename}
            onRenamed={(name) => setInfo({ ...info, name })}
            onError={(problem) => setError(t("docs.renameFailed", { problem }))}
          />
          {readOnly && <span class="docs-badge">{t("docs.viewOnly")}</span>}
          <span class="spacer" />
          {visitors.length > 0 && (
            <span
              class="docs-visitors"
              title={t("docs.others", {
                names: formatList(visitors.map((visitor) => visitor.name)),
              })}
            >
              {visitors.slice(0, 4).map((visitor) => (
                <Initials key={visitor.name} visitor={visitor} />
              ))}
            </span>
          )}
          <button type="button" class="docs-share" onClick={() => void share()}>
            {t("docs.share")}
          </button>
        </div>,
      )}
      <div class="docs-menus">
        <MenuBar label={t("docs.menus")} menus={menus()} />
      </div>
      {!readOnly && format && (
        <Toolbar
          format={format}
          run={run}
          onLink={startLink}
          onChoosePictures={() => choosePictures.current?.click()}
          onSpacing={startSpacing}
          onRestart={startRestart}
        />
      )}
      <input
        ref={choosePictures}
        type="file"
        accept={PICTURE_TYPES.join(",")}
        multiple
        hidden
        onChange={(event) => {
          const files = [...(event.currentTarget.files ?? [])];
          event.currentTarget.value = "";
          if (files.length) void addPictures(files);
        }}
      />
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
      {describing && (
        <AltTextDialog
          alt={describing.alt}
          onApply={(alt) => {
            described.current = { picture: describing, alt };
            setDescribing(null);
          }}
          onClose={() => {
            described.current = { picture: describing };
            setDescribing(null);
          }}
        />
      )}
      {sharing && <ShareDialog item={sharing} onClose={() => setSharing(null)} />}
      {spacing && (
        <SpacingDialog
          layout={spacing}
          onApply={(settings) => {
            setSpacing(null);
            run(setParagraph(settings));
          }}
          onClose={() => {
            setSpacing(null);
            view.current?.focus();
          }}
        />
      )}
      {restarting !== null && (
        <RestartDialog
          start={restarting}
          onApply={(start) => {
            setRestarting(null);
            run(restartNumbering(start));
          }}
          onClose={() => {
            setRestarting(null);
            view.current?.focus();
          }}
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
      // The print page has the document's fonts too, and prints once the
      // ones it shows have loaded.
      const printed = frame.contentDocument;
      addFonts(printed);
      void printed.body.offsetHeight;
      void printed.fonts.ready.then(() => {
        page.focus();
        page.print();
        resolve();
      });
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

/** A paragraph's indents, in inches or centimeters as the reader's region
 * measures them, and its line spacing and the space around it, as Google
 * Docs' **Indentation options** and **Custom spacing** have them. */
function SpacingDialog({
  layout,
  onApply,
  onClose,
}: {
  layout: Layout;
  onApply: (settings: ParagraphSettings) => void;
  onClose: () => void;
}) {
  const inches = usesInches();
  const unit = inches ? t("docs.unitInches") : t("docs.unitCentimeters");
  const length = (points: number) => String(fromPoints(points, inches));
  const [left, setLeft] = useState(length(layout.indent));
  const [right, setRight] = useState(length(layout.indentRight));
  const [special, setSpecial] = useState<"none" | "first" | "hanging">(
    layout.firstLine > 0 ? "first" : layout.firstLine < 0 ? "hanging" : "none",
  );
  const [by, setBy] = useState(length(Math.abs(layout.firstLine) || 36));
  const [line, setLine] = useState(String(layout.line));
  const [before, setBefore] = useState(String(layout.before));
  const [after, setAfter] = useState(String(layout.after));
  const [problem, setProblem] = useState("");
  const number = (text: string) => (text.trim() === "" ? Number.NaN : Number(text.replace(",", ".")));

  return (
    <Dialog title={t("docs.paragraphTitle")} class="docs-setup-dialog" onClose={onClose}>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          const values = [left, right, special === "none" ? "0" : by, line, before, after].map(number);
          const [leftValue, rightValue, byValue, lineValue, beforeValue, afterValue] = values as [
            number,
            number,
            number,
            number,
            number,
            number,
          ];
          if (values.some((value) => !Number.isFinite(value) || value < 0) || lineValue < 0.5 || lineValue > 10) {
            setProblem(t("docs.paragraphInvalid"));
            return;
          }
          const firstLine = toPoints(byValue, inches) * (special === "hanging" ? -1 : 1);
          onApply({
            indent: toPoints(leftValue, inches),
            indentRight: toPoints(rightValue, inches),
            firstLine: special === "none" ? 0 : firstLine,
            line: lineValue,
            before: beforeValue,
            after: afterValue,
          });
        }}
      >
        <fieldset>
          <legend>{t("docs.indents")}</legend>
          <div class="docs-margin-fields">
            <label>
              {t("docs.indentLeft", { unit })}
              <input type="text" inputMode="decimal" value={left} onInput={(event) => setLeft(event.currentTarget.value)} />
            </label>
            <label>
              {t("docs.indentRight", { unit })}
              <input type="text" inputMode="decimal" value={right} onInput={(event) => setRight(event.currentTarget.value)} />
            </label>
            <label>
              {t("docs.indentSpecial")}
              <select value={special} onChange={(event) => setSpecial(event.currentTarget.value as typeof special)}>
                <option value="none">{t("docs.indentNone")}</option>
                <option value="first">{t("docs.indentFirstLine")}</option>
                <option value="hanging">{t("docs.indentHanging")}</option>
              </select>
            </label>
            <label>
              {t("docs.indentBy", { unit })}
              <input
                type="text"
                inputMode="decimal"
                value={by}
                disabled={special === "none"}
                onInput={(event) => setBy(event.currentTarget.value)}
              />
            </label>
          </div>
        </fieldset>
        <fieldset>
          <legend>{t("docs.spacing")}</legend>
          <div class="docs-margin-fields">
            <label>
              {t("docs.spacingLine")}
              <input type="text" inputMode="decimal" value={line} onInput={(event) => setLine(event.currentTarget.value)} />
            </label>
            <label>
              {t("docs.spacingBefore")}
              <input type="text" inputMode="decimal" value={before} onInput={(event) => setBefore(event.currentTarget.value)} />
            </label>
            <label>
              {t("docs.spacingAfter")}
              <input type="text" inputMode="decimal" value={after} onInput={(event) => setAfter(event.currentTarget.value)} />
            </label>
          </div>
        </fieldset>
        <p class="error" role="alert">
          {problem}
        </p>
        <div class="dialog-buttons">
          <button type="button" class="secondary" onClick={onClose}>
            {t("docs.cancel")}
          </button>
          <button type="submit">{t("docs.paragraphApply")}</button>
        </div>
      </form>
    </Dialog>
  );
}

/** The number a numbered list's item starts from, which splits the list
 * there if the item isn't its first. */
function RestartDialog({ start, onApply, onClose }: { start: number; onApply: (start: number) => void; onClose: () => void }) {
  const [typed, setTyped] = useState(String(start));
  const [problem, setProblem] = useState("");
  return (
    <Dialog title={t("docs.restartTitle")} onClose={onClose}>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          const value = Number(typed.trim());
          if (typed.trim() === "" || !Number.isInteger(value) || value < 0 || value > 1_000_000) {
            setProblem(t("docs.restartInvalid"));
            return;
          }
          onApply(value);
        }}
      >
        <label>
          {t("docs.restartAt")}
          <input type="text" inputMode="numeric" value={typed} onInput={(event) => setTyped(event.currentTarget.value)} />
        </label>
        <p class="error" role="alert">
          {problem}
        </p>
        <div class="dialog-buttons">
          <button type="button" class="secondary" onClick={onClose}>
            {t("docs.cancel")}
          </button>
          <button type="submit">{t("docs.restartApply")}</button>
        </div>
      </form>
    </Dialog>
  );
}

/** The document's name, which the owner and editors can change. */
function DocumentName({
  info,
  field,
  rename,
  onRenamed,
  onError,
}: {
  info: DocumentInfo;
  /** The name's box, which **Rename** in the File menu focuses. */
  field: RefObject<HTMLInputElement | null>;
  rename: (name: string) => Promise<string>;
  onRenamed: (name: string) => void;
  onError: (problem: string) => void;
}) {
  const [value, setValue] = useState(info.name);
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

/** The labels for each alignment, in menus and on buttons. */
const ALIGN_NAMES = {
  left: ["docs.alignLeftLong", "docs.alignLeftShortcut"],
  center: ["docs.alignCenterLong", "docs.alignCenterShortcut"],
  right: ["docs.alignRightLong", "docs.alignRightShortcut"],
  justify: ["docs.alignJustifyLong", "docs.alignJustifyShortcut"],
} as const satisfies Record<Align, readonly [string, string]>;

function alignEntries(format: Formatting, run: Run): MenuEntry[] {
  return ALIGNS.map((align) => ({
    label: t(ALIGN_NAMES[align][0]),
    shortcut: t(ALIGN_NAMES[align][1]),
    checked: format.align === align,
    onSelect: () => run(setAlign(align)),
  }));
}

/** The paragraph styles, with what names each and its key after Ctrl+Alt. */
const STYLES: [string, () => string, number?][] = [
  ["paragraph", () => t("docs.styleNormal"), 0],
  ["title", () => t("docs.styleTitle")],
  ["subtitle", () => t("docs.styleSubtitle")],
  ...HEADING_LEVELS.map((level): [string, () => string, number] => [
    `heading-${level}`,
    () => t("docs.styleHeading", { level }),
    level,
  ]),
  ["code", () => t("docs.styleCode")],
];

function spacingEntries(layout: Layout, run: Run, onSpacing: () => void): MenuEntry[] {
  return [
    ...LINE_PRESETS.map((line) => ({
      label: lineName(line),
      checked: layout.line === line,
      onSelect: () => run(setLineSpacing(line)),
    })),
    SEPARATOR,
    {
      label: t(layout.before === 0 ? "docs.addSpaceBefore" : "docs.removeSpaceBefore"),
      onSelect: () => run(toggleSpace("before")),
    },
    {
      label: t(layout.after === 0 ? "docs.addSpaceAfter" : "docs.removeSpaceAfter"),
      onSelect: () => run(toggleSpace("after")),
    },
    SEPARATOR,
    { label: t("docs.customSpacing"), onSelect: onSpacing },
  ];
}

function tableEntries(run: Run): MenuEntry[] {
  return [
    { label: t("docs.rowAbove"), onSelect: () => run(tableCommands.rowAbove) },
    { label: t("docs.rowBelow"), onSelect: () => run(tableCommands.rowBelow) },
    {
      label: t("docs.columnLeft"),
      onSelect: () => run(tableCommands.columnLeft),
    },
    {
      label: t("docs.columnRight"),
      onSelect: () => run(tableCommands.columnRight),
    },
    SEPARATOR,
    {
      label: t("docs.headerRow"),
      onSelect: () => run(tableCommands.headerRow),
    },
    SEPARATOR,
    {
      label: t("docs.deleteRow"),
      onSelect: () => run(tableCommands.deleteRow),
    },
    {
      label: t("docs.deleteColumn"),
      onSelect: () => run(tableCommands.deleteColumn),
    },
    {
      label: t("docs.deleteTable"),
      onSelect: () => run(tableCommands.deleteTable),
    },
  ];
}

/** The selected picture back to its own size, or the text's width. */
const resetPictureSize: Command = (state, dispatch) => {
  const picture = selectedPicture(state);
  if (!picture) return false;
  dispatch?.(state.tr.setNodeAttribute(picture.pos, "width", null));
  return true;
};

/** Line spacing as the menu names it. */
function lineName(line: number): string {
  if (line === 1) return t("docs.lineSingle");
  if (line === 2) return t("docs.lineDouble");
  return String(line);
}

function Toolbar({
  format,
  run,
  onLink,
  onChoosePictures,
  onSpacing,
  onRestart,
}: {
  format: Formatting;
  run: Run;
  onLink: () => void;
  onChoosePictures: () => void;
  onSpacing: () => void;
  onRestart: () => void;
}) {
  const [tableMenu, setTableMenu] = useState<{
    place: MenuPlace;
    byKeyboard: boolean;
  } | null>(null);
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
        <option value="title">{t("docs.styleTitle")}</option>
        <option value="subtitle">{t("docs.styleSubtitle")}</option>
        {HEADING_LEVELS.map((level) => (
          <option key={level} value={`heading-${level}`}>
            {t("docs.styleHeading", { level })}
          </option>
        ))}
        <option value="code">{t("docs.styleCode")}</option>
      </select>
      <span class="docs-toolbar-gap" />
      <FontPicker font={format.text.font} run={run} />
      <span class="docs-toolbar-gap" />
      <SizeBox size={format.text.size} run={run} />
      <span class="docs-toolbar-gap" />
      {markButton(format.bold, t("docs.bold"), toggle.bold(), <BoldIcon />)}
      {markButton(format.italic, t("docs.italic"), toggle.italic(), <ItalicIcon />)}
      {markButton(format.underline, t("docs.underline"), toggle.underline(), <UnderlineIcon />)}
      {markButton(format.strike, t("docs.strike"), toggle.strike(), <StrikeIcon />)}
      {markButton(format.code, t("docs.inlineCode"), toggle.code(), <CodeIcon />)}
      <ColorButton kind="text" color={format.text.color} run={run} />
      <ColorButton kind="highlight" color={format.text.highlight} run={run} />
      <ToolButton label={t("docs.link")} pressed={format.link !== null} onClick={onLink}>
        <LinkIcon />
      </ToolButton>
      <span class="docs-toolbar-gap" />
      {format.layout && (
        <>
          <MenuButton
            label={t("docs.align")}
            icon={<AlignIcon align={format.align ?? "left"} />}
            entries={() => alignEntries(format, run)}
          />
          <MenuButton
            label={t("docs.lineSpacing")}
            icon={<LineSpacingIcon />}
            entries={() => spacingEntries(format.layout!, run, onSpacing)}
          />
          <span class="docs-toolbar-gap" />
        </>
      )}
      <ToolButton label={t("docs.bullets")} pressed={format.list === "bullets"} onClick={() => run(toggleList("bullets"))}>
        <BulletsIcon />
      </ToolButton>
      <ToolButton label={t("docs.numbers")} pressed={format.list === "numbers"} onClick={() => run(toggleList("numbers"))}>
        <NumbersIcon />
      </ToolButton>
      <MenuButton
        label={t("docs.listStyles")}
        icon={<ChevronIcon />}
        narrow
        entries={() => [
          ...BULLET_STYLES.map((style) => ({
            label: LIST_SAMPLES[style],
            checked: format.listStyle === style,
            onSelect: () => run(setListStyle(style)),
          })),
          SEPARATOR,
          ...NUMBER_STYLES.map((style) => ({
            label: LIST_SAMPLES[style],
            checked: format.listStyle === style,
            onSelect: () => run(setListStyle(style)),
          })),
          ...(format.numbered ? ([SEPARATOR, { label: t("docs.restartNumbering"), onSelect: onRestart }] as MenuEntry[]) : []),
        ]}
      />
      <ToolButton label={t("docs.checklist")} pressed={format.list === "checks"} onClick={() => run(toggleList("checks"))}>
        <ChecklistIcon />
      </ToolButton>
      <ToolButton label={t("docs.indentLess")} onClick={() => run(changeIndent(-1))}>
        <IndentLessIcon />
      </ToolButton>
      <ToolButton label={t("docs.indentMore")} onClick={() => run(changeIndent(1))}>
        <IndentMoreIcon />
      </ToolButton>
      <ToolButton label={t("docs.quote")} pressed={format.quote} onClick={() => run(toggleQuote())}>
        <QuoteIcon />
      </ToolButton>
      <span class="docs-toolbar-gap" />
      <ToolButton label={t("docs.picture")} onClick={onChoosePictures}>
        <PictureIcon />
      </ToolButton>
      <ToolButton label={t("docs.rule")} onClick={() => run(insertRule)}>
        <RuleIcon />
      </ToolButton>
      <ToolButton label={t("docs.pageBreak")} onClick={() => run(insertPageBreak)}>
        <PageBreakIcon />
      </ToolButton>
      {format.table ? (
        <button
          type="button"
          class="icon-button docs-tool"
          title={t("docs.tableMenu")}
          aria-label={t("docs.tableMenu")}
          aria-haspopup="menu"
          aria-expanded={tableMenu !== null}
          onClick={(event) =>
            setTableMenu({
              place: { under: event.currentTarget },
              byKeyboard: event.detail === 0,
            })
          }
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
          entries={tableEntries(run)}
          place={tableMenu.place}
          byKeyboard={tableMenu.byKeyboard}
          onClose={() => setTableMenu(null)}
        />
      )}
      <span class="docs-toolbar-gap" />
      <ToolButton label={t("docs.clearFormatting")} onClick={() => run(clearFormatting)}>
        <ClearFormatIcon />
      </ToolButton>
    </div>
  );
}

/** The font menu, each font's name shown in that font. With more than one
 * font selected, the button shows none. */
function FontPicker({ font, run }: { font: string | null; run: Run }) {
  const [menu, setMenu] = useState<{
    place: MenuPlace;
    byKeyboard: boolean;
  } | null>(null);
  return (
    <>
      <button
        type="button"
        class="docs-style docs-font"
        title={t("docs.font")}
        aria-label={t("docs.font")}
        aria-haspopup="menu"
        aria-expanded={menu !== null}
        onMouseDown={(event) => event.preventDefault()}
        onClick={(event) =>
          setMenu({
            place: { under: event.currentTarget },
            byKeyboard: event.detail === 0,
          })
        }
      >
        <span class="docs-font-name">{font ?? ""}</span>
        <ChevronIcon />
      </button>
      {menu && (
        <Menu
          label={t("docs.font")}
          entries={FONTS.map((choice) => ({
            label: choice.name,
            font: fontStack(choice.name),
            checked: choice.name === font,
            onSelect: () => run(setFont(choice.name)),
          }))}
          place={menu.place}
          byKeyboard={menu.byKeyboard}
          onClose={() => setMenu(null)}
        />
      )}
    </>
  );
}

/** The size in points, with a step down and up on either side, as in
 * Google Docs. Typing a size and pressing Enter sets it, and the list
 * offers the usual ones. */
function SizeBox({ size, run }: { size: number | null; run: Run }) {
  // What's typed, until it's set or dropped.
  const [typed, setTyped] = useState<string | null>(null);
  const shown = typed ?? (size === null ? "" : String(size));
  const apply = (text: string) => {
    setTyped(null);
    const points = fitSize(Number(text.trim().replace(",", ".")));
    if (text.trim() && points !== null) run(setSize(points));
  };
  return (
    <span class="docs-size">
      <ToolButton label={t("docs.smaller")} onClick={() => run(stepFontSize(-1))}>
        <MinusIcon />
      </ToolButton>
      <input
        class="docs-size-input"
        inputMode="decimal"
        list="docs-sizes"
        title={t("docs.fontSize")}
        aria-label={t("docs.fontSize")}
        value={shown}
        onFocus={(event) => event.currentTarget.select()}
        onInput={(event) => {
          const value = event.currentTarget.value;
          // Choosing from the list sets the size straight away.
          if ((event as InputEvent).inputType === "insertReplacementText" || !(event as InputEvent).inputType) apply(value);
          else setTyped(value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            apply(event.currentTarget.value);
          } else if (event.key === "Escape") {
            event.preventDefault();
            setTyped(null);
            run(() => true);
          }
        }}
        onBlur={() => setTyped(null)}
      />
      <datalist id="docs-sizes">
        {SIZES.map((choice) => (
          <option key={choice} value={choice} />
        ))}
      </datalist>
      <ToolButton label={t("docs.larger")} onClick={() => run(stepFontSize(1))}>
        <PlusIcon />
      </ToolButton>
    </span>
  );
}

/** Text color or highlight: the button shows the color now in a bar under
 * its icon, and opens the grid. */
function ColorButton({ kind, color, run }: { kind: "text" | "highlight"; color: string | null; run: Run }) {
  const [open, setOpen] = useState<{
    under: Element;
    byKeyboard: boolean;
  } | null>(null);
  const label = t(kind === "text" ? "docs.textColor" : "docs.highlight");
  const bar = color ?? (kind === "text" ? "currentColor" : "transparent");
  return (
    <>
      <button
        type="button"
        class="icon-button docs-tool docs-color-button"
        title={label}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open !== null}
        onMouseDown={(event) => event.preventDefault()}
        onClick={(event) => setOpen(open ? null : { under: event.currentTarget, byKeyboard: event.detail === 0 })}
      >
        {kind === "text" ? <TextColorIcon /> : <HighlightIcon />}
        <span class="docs-color-bar" style={{ backgroundColor: bar }} aria-hidden="true" />
      </button>
      {open && (
        <ColorMenu
          label={label}
          noneLabel={t(kind === "text" ? "docs.colorDefault" : "docs.colorNone")}
          color={color}
          under={open.under}
          byKeyboard={open.byKeyboard}
          onPick={(picked) => run(kind === "text" ? setColor(picked) : setHighlight(picked))}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}

/** A toolbar button that opens a menu under it. `entries` runs as it
 * opens, so the menu shows the selection as it is then. */
function MenuButton({
  label,
  icon,
  entries,
  narrow,
}: {
  label: string;
  icon: ComponentChildren;
  entries: () => MenuEntry[];
  /** A small arrow beside the button before it, as Google Docs has. */
  narrow?: boolean;
}) {
  const [menu, setMenu] = useState<{
    place: MenuPlace;
    byKeyboard: boolean;
  } | null>(null);
  return (
    <>
      <button
        type="button"
        class={narrow ? "icon-button docs-tool docs-tool-narrow" : "icon-button docs-tool"}
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={menu !== null}
        onMouseDown={(event) => event.preventDefault()}
        onClick={(event) =>
          setMenu({
            place: { under: event.currentTarget },
            byKeyboard: event.detail === 0,
          })
        }
      >
        {icon}
      </button>
      {menu && (
        <Menu label={label} entries={entries()} place={menu.place} byKeyboard={menu.byKeyboard} onClose={() => setMenu(null)} />
      )}
    </>
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

/** A picture's alt text: what it shows, for someone who can't see it, such
 * as a person using a screen reader. Downloads and the file keep it. */
function AltTextDialog({ alt, onApply, onClose }: { alt: string; onApply: (alt: string) => void; onClose: () => void }) {
  const [typed, setTyped] = useState(alt);
  return (
    <Dialog title={t("docs.altTextTitle")} class="docs-alt-dialog" onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onApply(typed);
        }}
      >
        <label class="field">
          <span>{t("docs.altTextLabel")}</span>
          <textarea
            rows={3}
            maxLength={MAX_ALT}
            autoFocus
            value={typed}
            onInput={(event) => setTyped(event.currentTarget.value)}
            onKeyDown={(event) => {
              // Enter saves, as in the other dialogs. Alt text is one line.
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                onApply(typed);
              }
            }}
          />
        </label>
        <p class="hint">{t("docs.altTextHint")}</p>
        <div class="dialog-buttons">
          <span class="spacer" />
          <button type="button" class="secondary" onClick={onClose}>
            {t("docs.cancel")}
          </button>
          <button type="submit">{t("docs.altTextApply")}</button>
        </div>
      </form>
    </Dialog>
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
