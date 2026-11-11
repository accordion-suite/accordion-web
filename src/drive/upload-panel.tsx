// The list of uploads, at the bottom of every page while there are any, so
// uploads stay in view while the reader moves between folders.

import { useEffect, useRef, useState } from "preact/hooks";

import { formatSize, t } from "../i18n.ts";
import { followLink } from "../shell/router.ts";
import { uploads } from "./http-transport.ts";
import { finished, type Upload, type UploadQueue } from "./uploads.ts";

/** The queue's uploads, updated as they change. */
export function useUploads(queue: UploadQueue = uploads): readonly Upload[] {
  const [list, setList] = useState(queue.uploads);
  useEffect(() => {
    setList(queue.uploads);
    return queue.subscribe(() => setList(queue.uploads));
  }, [queue]);
  return list;
}

function status(upload: Upload): string {
  const { state } = upload;
  const size = formatSize(upload.file.size);
  switch (state.kind) {
    case "waiting":
      return t("uploads.waiting");
    case "sending":
      return t("uploads.sent", { sent: formatSize(state.sent), size });
    case "retrying":
      return t("uploads.retrying");
    case "saving":
      return t("uploads.saving");
    case "done":
      return t("uploads.done", { folder: upload.folder.name });
    case "failed":
      return state.message;
    case "canceled":
      return t("uploads.canceled");
  }
}

/** The page of the folder the upload went to. */
function locationPath(upload: Upload): string {
  return upload.folder.top ? "/drive/my-drive" : `/drive/folder/${upload.folder.id}`;
}

/** The folder's page with the uploaded file open in the viewer. Without the
 * viewer's history mark, closing the file stays in the folder rather than
 * going back to where the upload started. */
function openPath(upload: Upload, id: string): string {
  return `${locationPath(upload)}?${new URLSearchParams({ file: id })}`;
}

function sentSoFar(upload: Upload): number {
  const { state } = upload;
  if (state.kind === "sending" || state.kind === "retrying") return state.sent;
  if (state.kind === "saving" || state.kind === "done") return upload.file.size;
  return 0;
}

const SHOW = "accordion:show-uploads";

/** Opens the upload panel's list and moves the focus to the panel, for
 * Alt+G then U, as Google Drive's upload status. Says whether there was a
 * panel, which shows only while there are uploads. */
export function goToUploads(): boolean {
  if (!document.querySelector(".upload-panel")) return false;
  window.dispatchEvent(new Event(SHOW));
  return true;
}

export function UploadPanel() {
  const list = useUploads();
  const [open, setOpen] = useState(true);
  const panel = useRef<HTMLElement>(null);

  useEffect(() => {
    const show = () => {
      setOpen(true);
      panel.current?.focus();
    };
    window.addEventListener(SHOW, show);
    return () => window.removeEventListener(SHOW, show);
  }, []);
  // What screen readers announce: a file finishing or failing, not every
  // step of its progress.
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    let last = new Map(uploads.uploads.map((upload) => [upload.key, upload.state.kind]));
    return uploads.subscribe(() => {
      for (const upload of uploads.uploads) {
        const before = last.get(upload.key);
        if (before !== upload.state.kind && upload.state.kind === "done") {
          setAnnouncement(t("uploads.announceDone", { name: upload.name }));
        } else if (before !== upload.state.kind && upload.state.kind === "failed") {
          setAnnouncement(
            t("uploads.announceFailed", { name: upload.name, problem: upload.state.message }),
          );
        }
      }
      last = new Map(uploads.uploads.map((upload) => [upload.key, upload.state.kind]));
    });
  }, []);

  const active = list.filter((upload) => !finished(upload.state)).length;
  const done = list.filter((upload) => upload.state.kind === "done").length;

  return (
    <>
      <p class="visually-hidden" role="status">
        {announcement}
      </p>
      {list.length > 0 && (
        <section class="upload-panel" aria-labelledby="upload-panel-title" tabIndex={-1} ref={panel}>
          <div class="upload-panel-head">
            <h2 id="upload-panel-title">
              {active > 0
                ? t("uploads.uploading", { count: active })
                : done > 0
                  ? t("uploads.uploaded", { count: done })
                  : t("uploads.title")}
            </h2>
            <div class="upload-panel-actions">
              {active < list.length && (
                <button type="button" class="secondary" onClick={() => uploads.clearFinished()}>
                  {t("uploads.clear")}
                </button>
              )}
              <button
                type="button"
                class="secondary"
                aria-controls="upload-list"
                onClick={() => setOpen(!open)}
              >
                {open ? t("uploads.hide") : t("uploads.show")}
              </button>
            </div>
          </div>
          <div id="upload-list" hidden={!open}>
            <ul>
              {list.map((upload) => (
                <li key={upload.key} class={`upload ${upload.state.kind}`}>
                  {upload.state.kind === "done" ? (
                    <a class="upload-name" href={openPath(upload, upload.state.item.id)} onClick={followLink}>
                      {upload.name}
                    </a>
                  ) : (
                    <span class="upload-name">{upload.name}</span>
                  )}
                  {!finished(upload.state) && (
                    <progress
                      max={upload.file.size || 1}
                      value={sentSoFar(upload)}
                      aria-label={t("uploads.progressOf", { name: upload.name })}
                    />
                  )}
                  <span class={upload.state.kind === "failed" ? "upload-status error" : "upload-status"}>
                    {status(upload)}
                  </span>
                  {upload.state.kind === "done" && (
                    <a
                      class="button secondary"
                      href={locationPath(upload)}
                      aria-label={t("uploads.openLocationNamed", { name: upload.name })}
                      onClick={followLink}
                    >
                      {t("uploads.openLocation")}
                    </a>
                  )}
                  {!finished(upload.state) && (
                    <button
                      type="button"
                      class="secondary"
                      aria-label={t("uploads.cancelNamed", { name: upload.name })}
                      onClick={() => uploads.cancel(upload.key)}
                    >
                      {t("uploads.cancel")}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
    </>
  );
}
