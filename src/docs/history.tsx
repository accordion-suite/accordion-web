// A document's version history (decision 30): the page swaps to a chosen
// version, read-only and laid out as the editor lays it out, with the list
// of versions at the right. Its address is `/docs/d/{id}/history`, with
// `?version=` for the version shown, so Back and links work.

import { useEffect, useRef, useState } from "preact/hooks";
import type { EditorView } from "prosemirror-view";
import { yXmlFragmentToProseMirrorRootNode } from "y-prosemirror";
import * as Y from "yjs";

import type { Session } from "../api.ts";
import { NameDialog } from "../drive/dialogs.tsx";
import { MoreIcon } from "../drive/icons.tsx";
import { formatDate, formatDay, formatList, t } from "../i18n.ts";
import { caretColor } from "../shell/coedit.ts";
import { problemText } from "../shell/dialog.tsx";
import { Menu, type MenuEntry, type MenuPlace, SEPARATOR } from "../shell/menu.tsx";
import { useTabTitle } from "../shell/page.tsx";
import { followLink, navigate, useQuery } from "../shell/router.ts";
import { TopBar } from "../shell/top-bar.tsx";
import {
  copyVersion,
  type DocumentInfo,
  type DocVersion,
  documentPath,
  historyPath,
  listVersions,
  nameVersion,
  openDocument,
  pictureAddress,
  restoreVersion,
  versionState,
} from "./docs-api.ts";
import { createPrintView, FRAGMENT } from "./editor.ts";
import { addFonts } from "./font-faces.ts";
import { BackIcon } from "./icons.tsx";
import { useNarrow } from "./media.ts";
import { defaultPageSize, newPageSetup, PAGE, readPage } from "./page-setup.ts";
import { geometryOf, setPageGeometry, setPageParts, showPaper } from "./pages.ts";
import { readParts } from "./parts.ts";
import { schema } from "./schema.ts";

/** A version just restored from the history, which the document's page
 * tells of as it opens, with **Undo**. */
let restored: { id: string; text: string; previous: string } | null = null;

/** The version `id`'s page should tell of, once. */
export function takeRestored(id: string): { text: string; previous: string } | null {
  if (restored?.id !== id) return null;
  const taken = restored;
  restored = null;
  return taken;
}

/** What a version is called: its name, or when it was saved. */
function versionTitle(version: DocVersion): string {
  return version.name ?? formatDate(version.created_at);
}

export function HistoryPage({ id, session, onSignOut }: { id: string; session: Session; onSignOut: () => void }) {
  const [info, setInfo] = useState<DocumentInfo | null>(null);
  const [versions, setVersions] = useState<DocVersion[] | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [onlyNamed, setOnlyNamed] = useState(false);
  const [menu, setMenu] = useState<{ version: DocVersion; place: MenuPlace; byKeyboard: boolean } | null>(null);
  const [naming, setNaming] = useState<DocVersion | null>(null);
  const [copying, setCopying] = useState<DocVersion | null>(null);
  const [busy, setBusy] = useState(false);
  const chosen = useQuery("version");
  const narrow = useNarrow();
  useTabTitle(t("shell.tabTitle", { page: t("docs.historyTabTitle", { name: info?.name ?? t("docs.title") }) }));

  async function load() {
    try {
      const [opened, list] = await Promise.all([openDocument(id), listVersions(id)]);
      setInfo(opened);
      setVersions(list);
    } catch (problem) {
      setError(t("docs.historyFailed", { problem: problemText(problem) }));
    }
  }
  useEffect(() => void load(), [id]);

  const current = versions?.[0] ?? null;
  // On phones the list comes first, and choosing a version shows it.
  const shown = versions && (chosen ? (versions.find((version) => version.id === chosen) ?? null) : narrow ? null : current);
  const showList = !narrow || !chosen;
  const showPage = !narrow || chosen !== null;

  function choose(version: DocVersion) {
    if (version.id !== chosen) navigate(historyPath(id, version.id));
  }

  function changed(version: DocVersion) {
    setVersions((now) => now && now.map((other) => (other.id === version.id ? version : other)));
  }

  async function restore(version: DocVersion) {
    setBusy(true);
    setError("");
    try {
      const result = await restoreVersion(id, version.id);
      restored = {
        id,
        text: version.name
          ? t("docs.restoredNamed", { name: version.name })
          : t("docs.restoredFrom", { date: formatDate(version.created_at) }),
        previous: result.previous,
      };
      navigate(documentPath(id));
    } catch (problem) {
      setError(problemText(problem));
      setBusy(false);
    }
  }

  async function removeName(version: DocVersion) {
    setError("");
    try {
      changed(await nameVersion(id, version.id, ""));
      setNotice(t("docs.versionUnnamed"));
    } catch (problem) {
      setError(problemText(problem));
    }
  }

  function entries(version: DocVersion): MenuEntry[] {
    const list: MenuEntry[] = version.name
      ? [
          { label: t("docs.renameVersion"), onSelect: () => setNaming(version) },
          { label: t("docs.removeVersionName"), onSelect: () => void removeName(version) },
        ]
      : [{ label: t("docs.nameVersion"), onSelect: () => setNaming(version) }];
    list.push(SEPARATOR);
    if (version.id !== current?.id) list.push({ label: t("docs.restoreVersion"), onSelect: () => void restore(version) });
    list.push({ label: t("docs.copyMenu"), onSelect: () => setCopying(version) });
    return list;
  }

  const listed = versions && (onlyNamed ? versions.filter((version) => version.name) : versions);
  // Phones go back to the list from a version, and to the document from
  // the list.
  const back = narrow && chosen ? historyPath(id) : documentPath(id);
  const backLabel = narrow && chosen ? t("docs.historyToList") : t("docs.historyBack");

  return (
    <div class="docs-history">
      <TopBar
        session={session}
        onSignOut={onSignOut}
        className="docs-top-bar docs-history-bar"
        brand={
          <a class="icon-button docs-history-back" href={back} title={backLabel} aria-label={backLabel} onClick={followLink}>
            <BackIcon />
          </a>
        }
      >
        <div class="docs-history-head">
          <div class="docs-history-title">
            <h1>{shown ? versionTitle(shown) : showList ? t("docs.versionHistory") : ""}</h1>
            {info && <span class="hint">{info.name}</span>}
          </div>
          <span class="spacer" />
          {shown && showPage && (
            <span class="docs-history-actions">
              {shown.id !== current?.id && (
                <button type="button" disabled={busy} onClick={() => void restore(shown)}>
                  {t("docs.restoreVersion")}
                </button>
              )}
              <button type="button" class="secondary" onClick={() => setCopying(shown)}>
                {t("docs.copySubmit")}
              </button>
            </span>
          )}
        </div>
      </TopBar>
      {(error || notice) && (
        <p class={error ? "error docs-status" : "hint docs-status"} role="status">
          {error || notice}
        </p>
      )}
      <div class="docs-history-body">
        {showPage && (
          <div class="docs-canvas docs-history-canvas">
            {versions === null ? (
              !error && <p class="loading">{t("shell.loading")}</p>
            ) : shown ? (
              <VersionPage id={id} version={shown.id} narrow={narrow} onError={(problem) => setError(problem)} />
            ) : (
              chosen && <p class="hint docs-history-gone">{t("docs.versionGone")}</p>
            )}
          </div>
        )}
        {showList && (
          <aside class="docs-history-list" aria-labelledby="docs-history-list-title">
            {/* On phones the page's title already says what the list is. */}
            <h2 id="docs-history-list-title" class={narrow ? "visually-hidden" : undefined}>
              {t("docs.versionHistory")}
            </h2>
            {listed === null ? (
              !error && <p class="loading">{t("shell.loading")}</p>
            ) : listed.length === 0 ? (
              <p class="hint docs-history-empty">{t("docs.noNamedVersions")}</p>
            ) : (
              <VersionList
                versions={listed}
                current={current?.id ?? null}
                shown={shown?.id ?? null}
                menuFor={menu?.version.id ?? null}
                onChoose={choose}
                onMenu={(version, place, byKeyboard) => setMenu({ version, place, byKeyboard })}
              />
            )}
            <label class="choice docs-history-named">
              <input type="checkbox" checked={onlyNamed} onChange={(event) => setOnlyNamed(event.currentTarget.checked)} />
              {t("docs.onlyNamed")}
            </label>
          </aside>
        )}
      </div>
      {menu && (
        <Menu
          label={t("docs.versionActions", { name: versionTitle(menu.version) })}
          entries={entries(menu.version)}
          place={menu.place}
          align="end"
          byKeyboard={menu.byKeyboard}
          onClose={() => setMenu(null)}
        />
      )}
      {naming && (
        <NameDialog
          title={naming.name ? t("docs.renameVersionTitle") : t("docs.nameVersionTitle")}
          submit={t("docs.versionNameSave")}
          initial={naming.name ?? ""}
          onSubmit={async (name) => {
            changed(await nameVersion(id, naming.id, name));
            setNaming(null);
            setNotice(t("docs.versionNamed", { name: name.trim() }));
          }}
          onClose={() => setNaming(null)}
        >
          <p class="hint">{t("docs.versionNameHint")}</p>
        </NameDialog>
      )}
      {copying && info && (
        <NameDialog
          title={t("docs.copyTitle")}
          submit={t("docs.copySubmit")}
          initial={t("docs.copyName", { name: info.name })}
          file
          onSubmit={async (name) => {
            await copyAndOpen(copyVersion(id, copying.id, name));
            setCopying(null);
          }}
          onClose={() => setCopying(null)}
        >
          <p class="hint">{t("docs.versionCopyHint")}</p>
        </NameDialog>
      )}
    </div>
  );
}

/** Opens a copy in a new tab, as Google Docs does. The tab opens at once,
 * while the press still lets a page open one. */
async function copyAndOpen(making: Promise<DocumentInfo>) {
  const tab = window.open("", "_blank");
  if (tab) tab.opener = null;
  try {
    const made = await making;
    if (tab) tab.location.href = documentPath(made.id);
    else navigate(documentPath(made.id));
  } catch (problem) {
    tab?.close();
    throw problem;
  }
}

/** The versions under day headings, newest first. */
function VersionList({
  versions,
  current,
  shown,
  menuFor,
  onChoose,
  onMenu,
}: {
  versions: DocVersion[];
  current: string | null;
  shown: string | null;
  menuFor: string | null;
  onChoose: (version: DocVersion) => void;
  onMenu: (version: DocVersion, place: MenuPlace, byKeyboard: boolean) => void;
}) {
  const days: { day: string; versions: DocVersion[] }[] = [];
  for (const version of versions) {
    const day = dayName(version.created_at);
    if (days.at(-1)?.day === day) days.at(-1)!.versions.push(version);
    else days.push({ day, versions: [version] });
  }
  return (
    <ol class="docs-history-days">
      {days.map(({ day, versions }) => (
        <li key={day}>
          <h3>{day}</h3>
          <ul class="docs-history-versions">
            {versions.map((version) => (
              <li key={version.id} class={version.id === shown ? "docs-history-version shown" : "docs-history-version"}>
                <button
                  type="button"
                  class="docs-history-pick"
                  aria-current={version.id === shown ? "true" : undefined}
                  onClick={() => onChoose(version)}
                >
                  {version.name && <span class="docs-history-name">{version.name}</span>}
                  <span class="docs-history-date">{formatDate(version.created_at)}</span>
                  {version.id === current && <span class="docs-history-current">{t("docs.currentVersion")}</span>}
                  {version.people.length > 0 && (
                    <span class="docs-history-people" title={formatList(version.people.map((person) => person.display_name))}>
                      {version.people.map((person) => (
                        <span key={person.user} class="docs-history-person">
                          <span
                            class="docs-history-dot"
                            aria-hidden="true"
                            ref={(element) => element?.style.setProperty("--caret", caretColor(person.display_name))}
                          />
                          {person.display_name}
                        </span>
                      ))}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  class="icon-button docs-history-more"
                  title={t("docs.more")}
                  aria-label={t("docs.versionActions", { name: versionTitle(version) })}
                  aria-haspopup="menu"
                  aria-expanded={menuFor === version.id}
                  onClick={(event) => onMenu(version, { under: event.currentTarget }, event.detail === 0)}
                >
                  <MoreIcon />
                </button>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}

/** **Today**, **Yesterday**, or the date, for a version's day heading. */
function dayName(iso: string): string {
  const day = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (day.toDateString() === today.toDateString()) return t("docs.historyToday");
  if (day.toDateString() === yesterday.toDateString()) return t("docs.historyYesterday");
  return formatDay(iso);
}

/** A version on its pages, as the editor lays them out, but read-only and
 * without comments or carets. */
function VersionPage({
  id,
  version,
  narrow,
  onError,
}: {
  id: string;
  version: string;
  narrow: boolean;
  onError: (problem: string) => void;
}) {
  const mount = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<Y.Doc | null>(null);

  useEffect(() => {
    let current = true;
    setDoc(null);
    versionState(id, version).then(
      (state) => {
        if (!current) return;
        const loaded = new Y.Doc();
        Y.applyUpdate(loaded, state);
        setDoc(loaded);
      },
      (problem: unknown) => current && onError(t("docs.versionFailed", { problem: problemText(problem) })),
    );
    return () => {
      current = false;
    };
  }, [id, version]);

  useEffect(() => {
    const element = mount.current;
    if (!doc || !element) return;
    addFonts();
    const setup = readPage(doc.getMap<unknown>(PAGE));
    showPaper(element, setup);
    const view: EditorView = createPrintView(
      element,
      yXmlFragmentToProseMirrorRootNode(doc.getXmlFragment(FRAGMENT), schema),
      (hash) => pictureAddress(id, hash),
    );
    setPageGeometry(view, narrow ? null : geometryOf(setup ?? newPageSetup(defaultPageSize())));
    setPageParts(view, readParts(doc));
    return () => view.destroy();
  }, [doc, narrow]);

  return <div class="docs-page" ref={mount} aria-busy={doc === null} />;
}
