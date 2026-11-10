// Shows a file from a folder over the folder's page, with the folder's other
// files a step away. The browser shows photos, PDFs, videos, and audio itself,
// from Drive's preview address, Office documents as the PDF the server made
// of them, and songs it can't play as the AAC the server converted them to. The viewer shows text files as a page of text, which people
// who can change them can edit. Other files, and videos and songs the
// browser can't play, show their thumbnail or icon and offer the download.

import { useEffect, useRef, useState } from "preact/hooks";

import { t } from "../i18n.ts";
import { ConfirmDialog, Dialog } from "../shell/dialog.tsx";
import { ItemIcon } from "./icons.tsx";
import { type Item, thumbnailAddress } from "./item.ts";
import { TextFile, canEditText, isText } from "./text-file.tsx";

/** Small screens open PDFs in their own tab, because phones show a PDF in a
 * page badly or not at all. Matches the phone layout in app.css. */
const NARROW = "(max-width: 600px)";

/** The most pages a document's preview has, as the server makes them. */
const PREVIEW_PAGES = 50;

function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const list = matchMedia(query);
    const update = () => setMatches(list.matches);
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, [query]);
  return matches;
}

/** `files` are the folder's files, in the folder's order, and `file` is one
 * of them. `onShow` moves to another. */
export function Viewer({
  files,
  file,
  onShow,
  onClose,
}: {
  files: readonly Item[];
  file: Item;
  onShow: (file: Item) => void;
  onClose: () => void;
}) {
  const position = files.indexOf(file);
  // Steps wrap around, so the buttons never turn off under keyboard focus.
  const step = (by: number) => onShow(files[(position + by + files.length) % files.length]!);
  // A new text file opens ready to edit.
  const [editAsked, setEditing] = useState(() => (history.state as { edit?: boolean } | null)?.edit === true);
  const editing = editAsked && canEditText(file);
  const dirty = useRef(false);
  /** What to do once the reader agrees to lose their changes. */
  const [discarding, setDiscarding] = useState<(() => void) | null>(null);

  function leave(then: () => void) {
    if (dirty.current) setDiscarding(() => then);
    else then();
  }

  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if (editing || files.length < 2 || event.altKey || event.ctrlKey || event.metaKey) return;
      // A video's controls skip back and ahead with the same keys.
      if (event.target instanceof HTMLMediaElement) return;
      if (event.key === "ArrowLeft") step(-1);
      if (event.key === "ArrowRight") step(1);
    };
    document.addEventListener("keydown", keys);
    return () => document.removeEventListener("keydown", keys);
  });

  return (
    <Dialog title={file.name} class="viewer" onClose={() => leave(onClose)}>
      <div class="viewer-actions">
        {files.length > 1 && !editing && (
          <>
            <span class="viewer-position">
              {t("viewer.position", { position: position + 1, count: files.length })}
            </span>
            <button type="button" class="secondary" onClick={() => step(-1)}>
              {t("viewer.previous")}
            </button>
            <button type="button" class="secondary" onClick={() => step(1)}>
              {t("viewer.next")}
            </button>
          </>
        )}
        {!editing && canEditText(file) && (
          <button type="button" class="secondary" onClick={() => setEditing(true)}>
            {t("viewer.edit")}
          </button>
        )}
        <a class="button secondary" href={`/api/drive/items/${file.id}/content`} download={file.name}>
          {t("viewer.download")}
        </a>
        <button type="button" onClick={() => leave(onClose)}>
          {t("viewer.close")}
        </button>
      </div>
      {/* Keyed, so each file starts out loading. */}
      <Shown
        key={file.id}
        file={file}
        editing={editing}
        onStop={() => leave(() => setEditing(false))}
        onDirty={(changed) => (dirty.current = changed)}
      />
      {discarding && (
        <ConfirmDialog
          title={t("editor.discardTitle")}
          body={t("editor.discardBody", { name: file.name })}
          confirm={t("editor.discard")}
          onConfirm={async () => {
            dirty.current = false;
            setDiscarding(null);
            discarding();
          }}
          onClose={() => setDiscarding(null)}
        />
      )}
    </Dialog>
  );
}

function Shown({
  file,
  editing,
  onStop,
  onDirty,
}: {
  file: Item;
  editing: boolean;
  onStop: () => void;
  onDirty: (dirty: boolean) => void;
}) {
  const [state, setState] = useState<"loading" | "shown" | "failed">("loading");
  const narrow = useMedia(NARROW);
  const address = `/api/drive/items/${file.id}/preview`;
  // Browsers' PDF viewers take their title from the end of the address.
  const named = `${address}/${encodeURIComponent(file.name)}`;

  if (isText(file)) {
    return <TextFile file={file} editing={editing} onStop={onStop} onDirty={onDirty} />;
  }
  if (file.preview === null) {
    return (
      <div class="viewer-body">
        <div class="viewer-note">
          {file.thumbnail === "picture" && file.sha256 ? (
            <img
              class="viewer-thumbnail"
              src={thumbnailAddress(file)}
              alt=""
            />
          ) : (
            <ItemIcon item={file} />
          )}
          <p>{t("viewer.noPreview", { name: file.name })}</p>
          <a class="button" href={`/api/drive/items/${file.id}/content`} download={file.name}>
            {t("viewer.download")}
          </a>
        </div>
      </div>
    );
  }
  if (file.preview === "audio") {
    return (
      <div class="viewer-body">
        <div class="viewer-note viewer-audio">
          {/* A song's cover art, if it has some. */}
          {file.thumbnail === "picture" && file.sha256 ? (
            <img class="viewer-thumbnail" src={thumbnailAddress(file)} alt="" />
          ) : (
            <ItemIcon item={file} />
          )}
          {state === "failed" ? (
            <>
              <p role="alert">{t("viewer.audioFailed", { name: file.name })}</p>
              <a class="button" href={`/api/drive/items/${file.id}/content`} download={file.name}>
                {t("viewer.download")}
              </a>
            </>
          ) : (
            // Opening the viewer is a click, so browsers let it play right
            // away.
            <audio src={address} controls autoplay onError={() => setState("failed")} />
          )}
        </div>
      </div>
    );
  }
  if (file.preview === "video") {
    return (
      <div class="viewer-body">
        {state === "failed" ? (
          <div class="viewer-note" role="alert">
            <p>{t("viewer.videoFailed", { name: file.name })}</p>
            <a class="button" href={`/api/drive/items/${file.id}/content`} download={file.name}>
              {t("viewer.download")}
            </a>
          </div>
        ) : (
          // Opening the viewer is a click, so browsers let it play with
          // sound right away.
          <video
            src={address}
            poster={
              file.thumbnail === "picture" && file.sha256
                ? thumbnailAddress(file)
                : undefined
            }
            controls
            autoplay
            playsinline
            onError={() => setState("failed")}
            // A browser that can't decode the picture may play just the
            // sound, with no width or height.
            onLoadedMetadata={(event) => {
              if (event.currentTarget.videoWidth === 0) setState("failed");
            }}
          />
        )}
      </div>
    );
  }
  if (file.preview === "document") {
    return (
      <div class="viewer-body">
        {narrow ? (
          <div class="viewer-note">
            <p>{t("viewer.documentNarrow")}</p>
            <a class="button" href={named} target="_blank" rel="noopener">
              {t("viewer.openPreview")}
            </a>
          </div>
        ) : (
          <div class="viewer-document">
            <p class="viewer-document-note">
              {file.preview_partial ? t("viewer.documentCut", { pages: PREVIEW_PAGES }) : t("viewer.document")}
            </p>
            <iframe src={named} title={file.name} />
          </div>
        )}
      </div>
    );
  }
  if (file.preview === "pdf") {
    return (
      <div class="viewer-body">
        {narrow ? (
          <div class="viewer-note">
            <p>{t("viewer.pdfNarrow")}</p>
            <a class="button" href={named} target="_blank" rel="noopener">
              {t("viewer.openPdf")}
            </a>
          </div>
        ) : (
          <iframe src={named} title={file.name} />
        )}
      </div>
    );
  }
  return (
    <div class="viewer-body">
      {state === "failed" ? (
        <p class="viewer-note error" role="alert">
          {t("viewer.failed", { name: file.name })}
        </p>
      ) : (
        <>
          {state === "loading" && <p class="loading">{t("shell.loading")}</p>}
          <img
            src={address}
            alt={file.name}
            hidden={state === "loading"}
            onLoad={() => setState("shown")}
            onError={() => setState("failed")}
          />
        </>
      )}
    </div>
  );
}
