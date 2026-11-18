// Docs (decision 30): the list of documents, and the editor. This module
// and everything it imports load the first time Docs opens.

import "./messages.ts";

import type { ComponentChildren } from "preact";
import type { Command } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { useEffect, useRef, useState } from "preact/hooks";

import { api, type Session } from "../api.ts";
import { ShareDialog } from "../drive/dialogs.tsx";
import { type Item, thumbnailAddress } from "../drive/item.ts";
import { formatDate, formatList, t } from "../i18n.ts";
import { LiveDocument, type LiveStatus, type Visitor } from "../shell/coedit.ts";
import { Dialog, problemText } from "../shell/dialog.tsx";
import { rememberAppPage } from "../shell/last-app.ts";
import { Menu, type MenuPlace } from "../shell/menu.tsx";
import { PageThumbnail } from "../shell/page-thumbnail.tsx";
import { PageTitle, useTabTitle } from "../shell/page.tsx";
import { followLink, navigate, usePath } from "../shell/router.ts";
import { TopBar } from "../shell/top-bar.tsx";
import { createDocument, type DocumentInfo, documentPath, listDocuments, openDocument, renameDocument } from "./docs-api.ts";
import {
  createEditor,
  type Formatting,
  formatting,
  insertRule,
  insertTable,
  redo,
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
  QuoteIcon,
  RedoIcon,
  RuleIcon,
  StrikeIcon,
  TableIcon,
  UnderlineIcon,
  UndoIcon,
} from "./icons.tsx";
import { linkFromTyped } from "./schema.ts";

export function Docs({ session, onSignOut }: { session: Session; onSignOut: () => void }) {
  const path = usePath();
  const opened = /^\/docs\/d\/([^/]+)\/?$/.exec(path);
  useEffect(() => rememberAppPage("docs", path), [path]);
  return (
    <>
      <TopBar session={session} onSignOut={onSignOut} module={t("apps.docs")} home="/docs/" />
      {opened ? <DocumentPage key={opened[1]} id={opened[1]!} session={session} /> : <DocsHome />}
    </>
  );
}

/** Docs' home: a new document, and the documents the reader has. */
function DocsHome() {
  const [documents, setDocuments] = useState<DocumentInfo[] | null>(null);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    listDocuments().then(
      (found) => setDocuments(found.documents),
      () => setError(t("docs.loadFailed")),
    );
  }, []);

  async function create() {
    setCreating(true);
    setError("");
    try {
      const made = await createDocument();
      navigate(documentPath(made.id));
    } catch (problem) {
      setError(problemText(problem));
      setCreating(false);
    }
  }

  return (
    <main class="page docs-home">
      <PageTitle bare>{t("docs.title")}</PageTitle>
      <section class="docs-start" aria-labelledby="docs-start-title">
        <h2 id="docs-start-title">{t("docs.newTitle")}</h2>
        <button type="button" class="docs-blank" disabled={creating} onClick={() => void create()}>
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
                <DocumentCard document={document} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

/** A document on Docs' home: the top of its page, its name, who owns it if
 * someone shared it, and when it last changed. The page shows the editor's icon until the
 * server has made its thumbnail. */
function DocumentCard({ document }: { document: DocumentInfo }) {
  const [failed, setFailed] = useState(false);
  const thumbnail = document.thumbnail === "page" && document.sha256 && !failed;
  return (
    <a class="docs-card" href={documentPath(document.id)} onClick={followLink}>
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
  );
}

/** A document open for editing, with everyone else who has it open. */
function DocumentPage({ id, session }: { id: string; session: Session }) {
  const [info, setInfo] = useState<DocumentInfo | null>(null);
  const [failed, setFailed] = useState(false);
  const [status, setStatus] = useState<LiveStatus>("connecting");
  const [visitors, setVisitors] = useState<Visitor[]>([]);
  const [format, setFormat] = useState<Formatting | null>(null);
  const [linking, setLinking] = useState<{ href: string } | null>(null);
  const [sharing, setSharing] = useState<Item | null>(null);
  const [error, setError] = useState("");
  const mount = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const live = useRef<LiveDocument | null>(null);
  useTabTitle(t("shell.tabTitle", { page: info?.name ?? t("docs.title") }));

  useEffect(() => {
    let current = true;
    openDocument(id).then(
      (opened) => current && setInfo(opened),
      () => current && setFailed(true),
    );
    return () => {
      current = false;
    };
  }, [id]);

  const readOnly = info?.access === "viewer";

  // The editor appears once the document has arrived from the server, so
  // it never starts from an empty page of its own.
  useEffect(() => {
    if (!info) return;
    const document = new LiveDocument(`/api/docs/documents/${id}/live`, `/api/docs/documents/${id}`, { name: session.user.display_name }, (next) => {
      setStatus(next);
      if (next === "live" && !view.current && mount.current) {
        view.current = createEditor(mount.current, document, {
          readOnly,
          onChange: () => view.current && setFormat(formatting(view.current.state)),
          onLink: () => startLink(),
        });
        setFormat(formatting(view.current.state));
        view.current.focus();
      }
    });
    live.current = document;
    const others = () => setVisitors(document.visitors());
    document.awareness.on("change", others);
    return () => {
      document.awareness.off("change", others);
      view.current?.destroy();
      view.current = null;
      document.close();
      live.current = null;
    };
  }, [info?.id, readOnly]);

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
      setSharing(await api<Item>("GET", `/api/drive/items/${id}`));
    } catch (problem) {
      setError(problemText(problem));
    }
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
        <button type="button" onClick={() => void share()}>
          {t("docs.share")}
        </button>
      </div>
      {!readOnly && format && (
        <Toolbar
          format={format}
          run={run}
          onLink={startLink}
        />
      )}
      {(statusText || error) && (
        <p class={status === "gone" || status === "signedOut" || error ? "error docs-status" : "hint docs-status"} role="status">
          {error || statusText}
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
    </div>
  );
}

/** The document's name, which the owner and editors can change. */
function DocumentName({
  info,
  onRenamed,
  onError,
}: {
  info: DocumentInfo;
  onRenamed: (name: string) => void;
  onError: (problem: string) => void;
}) {
  const [value, setValue] = useState(info.name);
  useEffect(() => setValue(info.name), [info.name]);
  const readOnly = info.access === "viewer";

  async function save() {
    const typed = value.trim();
    if (!typed || typed === info.name) {
      setValue(info.name);
      return;
    }
    try {
      onRenamed(await renameDocument(info.id, typed));
    } catch (problem) {
      setValue(info.name);
      onError(problemText(problem));
    }
  }

  return (
    <input
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

function Toolbar({ format, run, onLink }: { format: Formatting; run: Run; onLink: () => void }) {
  const [tableMenu, setTableMenu] = useState<{ place: MenuPlace; byKeyboard: boolean } | null>(null);
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
