// Shows a file from a folder over the folder's page, with the folder's other
// files a step away. The browser shows photos, PDFs, and videos itself, from
// Drive's preview address. Other files, and videos the browser can't play,
// show their thumbnail or icon and offer the download.

import { useEffect, useState } from "preact/hooks";

import { t } from "../i18n.ts";
import { Dialog } from "../shell/dialog.tsx";
import { ItemIcon } from "./icons.tsx";
import type { Item } from "./item.ts";

/** Small screens open PDFs in their own tab, because phones show a PDF in a
 * page badly or not at all. Matches the phone layout in app.css. */
const NARROW = "(max-width: 600px)";

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

  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if (files.length < 2 || event.altKey || event.ctrlKey || event.metaKey) return;
      // A video's controls skip back and ahead with the same keys.
      if (event.target instanceof HTMLMediaElement) return;
      if (event.key === "ArrowLeft") step(-1);
      if (event.key === "ArrowRight") step(1);
    };
    document.addEventListener("keydown", keys);
    return () => document.removeEventListener("keydown", keys);
  });

  return (
    <Dialog title={file.name} class="viewer" onClose={onClose}>
      <div class="viewer-actions">
        {files.length > 1 && (
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
        <a class="button secondary" href={`/api/drive/items/${file.id}/content`} download={file.name}>
          {t("viewer.download")}
        </a>
        <button type="button" onClick={onClose}>
          {t("viewer.close")}
        </button>
      </div>
      {/* Keyed, so each file starts out loading. */}
      <Shown key={file.id} file={file} />
    </Dialog>
  );
}

function Shown({ file }: { file: Item }) {
  const [state, setState] = useState<"loading" | "shown" | "failed">("loading");
  const narrow = useMedia(NARROW);
  const address = `/api/drive/items/${file.id}/preview`;

  if (file.preview === null) {
    return (
      <div class="viewer-body">
        <div class="viewer-note">
          {file.thumbnail === "picture" && file.sha256 ? (
            <img
              class="viewer-thumbnail"
              src={`/api/drive/items/${file.id}/thumbnail?v=${file.sha256}`}
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
                ? `/api/drive/items/${file.id}/thumbnail?v=${file.sha256}`
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
  if (file.preview === "pdf") {
    return (
      <div class="viewer-body">
        {narrow ? (
          <div class="viewer-note">
            <p>{t("viewer.pdfNarrow")}</p>
            <a class="button" href={address} target="_blank" rel="noopener">
              {t("viewer.openPdf")}
            </a>
          </div>
        ) : (
          <iframe src={address} title={file.name} />
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
