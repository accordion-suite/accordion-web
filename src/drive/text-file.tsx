// A text file in the viewer: a page of plain text, or formatted text for
// Markdown, neither of which can run anything. People who can change the
// file can edit it here. Each save says which contents it replaces, and the
// server refuses it if someone saved other changes in the meantime, so
// nobody's work is lost without them knowing.

import { useEffect, useRef, useState } from "preact/hooks";

import { ApiError, api, send } from "../api.ts";
import { formatSize, t } from "../i18n.ts";
import { problemText } from "../shell/dialog.tsx";
import { type Item, canEdit } from "./item.ts";
import { MarkdownView } from "./markdown-view.tsx";
import { announceChange } from "./store.ts";

/** The most of a text file the viewer shows, so a huge log doesn't freeze
 * the page, and the most it edits. The download has the rest. */
const TEXT_LIMIT = 1_000_000;

/** Names of text files that may not have a text thumbnail yet, such as a
 * new, empty one. */
const TEXT_NAME = /\.(?:txt|text|md|markdown|mdown|mkd|log|csv|tsv|json|ya?ml|toml|ini|conf|cfg)$/i;
const MARKDOWN_NAME = /\.(?:md|markdown|mdown|mkd)$/i;

/** Files shown as text once, which stay text while their new contents get
 * a thumbnail, so saving doesn't close the editor. */
const shownAsText = new Set<string>();

/** Whether the viewer shows `file` as text. The server found it's text when
 * it made its thumbnail. */
export function isText(file: Item): boolean {
  const text = shownAsText.has(file.id) || (file.preview === null && (file.thumbnail === "text" || TEXT_NAME.test(file.name)));
  if (text) shownAsText.add(file.id);
  return text;
}

/** Whether the reader can edit `file` in the viewer. */
export function canEditText(file: Item): boolean {
  return isText(file) && canEdit(file) && (file.size ?? 0) <= TEXT_LIMIT;
}

interface Loaded {
  text: string;
  /** The SHA-256 hash of the contents `text` came from, which a save
   * replaces. */
  base: string;
  /** Whether the file starts with a byte order mark, or ends lines with
   * CR LF, as Windows apps write them, which a save keeps. */
  bom: boolean;
  crlf: boolean;
  /** Whether the file is UTF-8, which is all the editor saves. */
  utf8: boolean;
  /** Whether the file goes on past `TEXT_LIMIT`. */
  cut: boolean;
}

async function load(file: Item): Promise<Loaded> {
  const cut = (file.size ?? 0) > TEXT_LIMIT;
  const response = await fetch(`/api/drive/items/${file.id}/content`, {
    headers: cut ? { Range: `bytes=0-${TEXT_LIMIT - 1}` } : {},
  });
  if (!response.ok) throw new Error(response.statusText);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const base = response.headers.get("ETag")?.replace(/"/g, "") ?? file.sha256 ?? "";
  const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  let text: string;
  let utf8 = true;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    // Cutting it off can split the last character.
    utf8 = cut;
    text = new TextDecoder().decode(bytes);
    if (cut) text = text.replace(/�$/, "");
  }
  // The editor's text box works in plain line ends, so the text does too.
  const crlf = text.includes("\r\n");
  return { text: crlf ? text.replace(/\r\n/g, "\n") : text, base, bom, crlf, utf8, cut };
}

export function TextFile({
  file,
  editing,
  onStop,
  onDirty,
}: {
  file: Item;
  /** Whether the reader asked to edit it. */
  editing: boolean;
  /** Asks to stop editing, which checks for changes that aren't saved. */
  onStop: () => void;
  onDirty: (dirty: boolean) => void;
}) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);
  const markdown = MARKDOWN_NAME.test(file.name);

  useEffect(() => {
    // Shows someone else's changes, but not while editing, and not the
    // reader's own save, which it already has.
    if (editing && loaded) return;
    if (loaded && loaded.base === file.sha256) return;
    let current = true;
    load(file).then(
      (next) => current && setLoaded(next),
      () => current && setFailed(true),
    );
    return () => {
      current = false;
    };
  }, [file.id, file.sha256, editing]);

  if (failed) {
    return (
      <div class="viewer-body">
        <p class="viewer-note error" role="alert">
          {t("viewer.failed", { name: file.name })}
        </p>
      </div>
    );
  }
  if (loaded === null) {
    return (
      <div class="viewer-body">
        <p class="loading">{t("shell.loading")}</p>
      </div>
    );
  }
  if (editing && loaded.utf8 && !loaded.cut) {
    return (
      <Editor
        file={file}
        loaded={loaded}
        markdown={markdown}
        onSaved={setLoaded}
        onStop={onStop}
        onDirty={onDirty}
      />
    );
  }
  return (
    <div class="viewer-body">
      <div class="viewer-text">
        {editing && <p class="viewer-text-cut" role="alert">{t("editor.notUtf8", { name: file.name })}</p>}
        {loaded.cut && <p class="viewer-text-cut">{t("viewer.textCut", { size: formatSize(TEXT_LIMIT) })}</p>}
        {markdown ? (
          <div class="text-page">
            <MarkdownView source={loaded.text} />
          </div>
        ) : (
          <pre class="text-page">{loaded.text}</pre>
        )}
      </div>
    </div>
  );
}

type Status = { kind: "idle" } | { kind: "saving" } | { kind: "saved" } | { kind: "changed" } | { kind: "failed"; message: string };

function Editor({
  file,
  loaded,
  markdown,
  onSaved,
  onStop,
  onDirty,
}: {
  file: Item;
  loaded: Loaded;
  markdown: boolean;
  onSaved: (loaded: Loaded) => void;
  onStop: () => void;
  onDirty: (dirty: boolean) => void;
}) {
  const [draft, setDraft] = useState(loaded.text);
  const [preview, setPreview] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const area = useRef<HTMLTextAreaElement>(null);
  const dirty = draft !== loaded.text;
  const saving = status.kind === "saving";

  useEffect(() => area.current?.focus(), []);

  useEffect(() => {
    onDirty(dirty);
    if (!dirty) return;
    // Asks before a reload or a closed tab loses the changes.
    const ask = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", ask);
    return () => window.removeEventListener("beforeunload", ask);
  }, [dirty]);

  useEffect(() => () => onDirty(false), []);

  async function save(anyway = false) {
    if (saving) return;
    setStatus({ kind: "saving" });
    const text = draft;
    try {
      // Saving anyway replaces whatever the file holds now. What it held
      // stays in its versions.
      const base = anyway ? (await api<Item>("GET", `/api/drive/items/${file.id}`)).sha256 : loaded.base;
      const contents = (loaded.bom ? "﻿" : "") + (loaded.crlf ? text.replace(/\n/g, "\r\n") : text);
      const saved = await send<Item>("PUT", `/api/drive/items/${file.id}/content`, {
        headers: { "Content-Type": "text/plain; charset=utf-8", "If-Match": `"${base}"` },
        body: new TextEncoder().encode(contents),
      });
      onSaved({ ...loaded, text, base: saved.sha256 ?? "" });
      setStatus({ kind: "saved" });
      announceChange();
    } catch (problem) {
      setStatus(
        problem instanceof ApiError && problem.status === 412
          ? { kind: "changed" }
          : { kind: "failed", message: problemText(problem) },
      );
    }
  }

  function keys(event: KeyboardEvent) {
    if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "s") {
      event.preventDefault();
      void save();
    }
  }

  return (
    <div class="viewer-body">
      <div class="text-editor" onKeyDown={keys}>
        <div class="text-editor-bar">
          {markdown && (
            <div class="view-toggle" role="group" aria-label={t("editor.show")}>
              <button type="button" aria-pressed={!preview} onClick={() => setPreview(false)}>
                {t("editor.write")}
              </button>
              <button type="button" aria-pressed={preview} onClick={() => setPreview(true)}>
                {t("editor.preview")}
              </button>
            </div>
          )}
          <p class="text-editor-status" role="status">
            {status.kind === "saving"
              ? t("editor.saving")
              : dirty
                ? t("editor.unsaved")
                : status.kind === "saved"
                  ? t("editor.saved")
                  : ""}
          </p>
          <button type="button" disabled={saving || !dirty} onClick={() => void save()}>
            {t("editor.save")}
          </button>
          <button type="button" class="secondary" onClick={onStop}>
            {t("editor.stop")}
          </button>
        </div>
        {status.kind === "changed" && (
          <div class="text-editor-problem" role="alert">
            <p>{t("editor.changed")}</p>
            <button type="button" class="secondary" disabled={saving} onClick={() => void save(true)}>
              {t("editor.saveAnyway")}
            </button>
          </div>
        )}
        {status.kind === "failed" && (
          <div class="text-editor-problem" role="alert">
            <p>{status.message}</p>
          </div>
        )}
        <div class="viewer-text">
          {preview ? (
            <div class="text-page">
              <MarkdownView source={draft} />
            </div>
          ) : (
            <textarea
              ref={area}
              class="text-page"
              value={draft}
              spellcheck={markdown || /\.(?:txt|text)$/i.test(file.name)}
              aria-label={t("editor.label", { name: file.name })}
              onInput={(event) => setDraft(event.currentTarget.value)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
