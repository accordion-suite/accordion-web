// Drive's resumable uploads API over HTTP, and the tab's upload queue.

import { ApiError, api } from "../api.ts";
import { t } from "../i18n.ts";
import type { Item } from "./item.ts";
import { type Transport, UploadQueue } from "./uploads.ts";

const UPLOADS = "/api/drive/uploads";

export const httpTransport: Transport = {
  async start(size) {
    return (await api<{ id: string }>("POST", UPLOADS, { size })).id;
  },

  async progress(id) {
    return (await api<{ received: number }>("GET", `${UPLOADS}/${id}`)).received;
  },

  // XMLHttpRequest rather than fetch, because only it reports how much of a
  // request has gone out.
  send(id, offset, piece, onSent, signal) {
    return new Promise((resolve, reject) => {
      const request = new XMLHttpRequest();
      request.open("PATCH", `${UPLOADS}/${id}`);
      request.setRequestHeader("Upload-Offset", String(offset));
      request.setRequestHeader("Content-Type", "application/octet-stream");
      request.responseType = "json";
      request.upload.onprogress = (event) => onSent(event.loaded);
      request.onload = () => {
        const body = request.response as { received?: unknown; error?: unknown } | null;
        if (request.status === 200 && typeof body?.received === "number") {
          resolve(body.received);
        } else {
          const error = body?.error;
          reject(new ApiError(request.status, typeof error === "string" ? error : t("error.problem")));
        }
      };
      request.onerror = () => reject(new ApiError(0, t("error.offline")));
      request.ontimeout = request.onerror;
      request.onabort = () => reject(signal.reason);
      signal.addEventListener("abort", () => request.abort(), { once: true });
      request.send(piece);
    });
  },

  finish(id, folder, name) {
    return api<Item>("POST", `${UPLOADS}/${id}/finish`, { parent: folder, name });
  },

  cancel(id) {
    return api<void>("DELETE", `${UPLOADS}/${id}`);
  },
};

/** The uploads in this tab. They carry on while the reader moves between
 * folders. */
export const uploads = new UploadQueue(httpTransport);
