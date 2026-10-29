// Uploads files to Drive with its resumable uploads, which keep what has
// arrived when a connection drops. After a drop, an upload asks the server
// how much arrived and sends the rest, so a phone that loses signal partway
// through a video doesn't start over.
//
// Uploads run one at a time, in the order they were added, which keeps a
// Raspberry Pi's disk and a home connection from being swamped.

import { ApiError } from "../api.ts";
import { t } from "../i18n.ts";
import type { Item } from "./item.ts";

/** Each request sends at most this much. The server keeps part of a piece
 * when the connection drops, so the size only limits how long one request
 * runs. */
export const PIECE_SIZE = 16 * 1024 * 1024;

/** Seconds to wait after each failed try in a row. The last repeats, so an
 * upload keeps trying for as long as the server keeps it: a day without
 * progress. */
const RETRY_DELAYS = [1, 2, 4, 8, 15, 30];

/** The server's resumable uploads API, `/api/drive/uploads`. Tests use a
 * fake one. */
export interface Transport {
  /** Starts an upload of `size` bytes, and returns its ID. */
  start(size: number): Promise<string>;
  /** How much of the upload has arrived. */
  progress(id: string): Promise<number>;
  /** Sends `piece`, starting at `offset`, and returns how much has arrived
   * since the start of the file. Calls `onSent` as bytes go out. */
  send(
    id: string,
    offset: number,
    piece: Blob,
    onSent: (bytes: number) => void,
    signal: AbortSignal,
  ): Promise<number>;
  /** Saves the upload as the file `name` in `folder`. */
  finish(id: string, folder: string, name: string): Promise<Item>;
  cancel(id: string): Promise<void>;
}

export type UploadState =
  | { kind: "waiting" }
  | { kind: "sending"; sent: number }
  | { kind: "retrying"; sent: number }
  | { kind: "saving" }
  | { kind: "done"; item: Item }
  | { kind: "failed"; message: string }
  | { kind: "canceled" };

export interface Upload {
  /** Tells uploads apart, including two of the same file. */
  readonly key: number;
  readonly file: Blob;
  readonly name: string;
  readonly folder: { readonly id: string; readonly name: string };
  readonly state: UploadState;
}

export type Wait = (ms: number, signal: AbortSignal) => Promise<void>;

/** Waits `ms`, or less if `signal` aborts. */
export const wait: Wait = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });

/** Statuses that trying again could fix: the server's own failure, the
 * gateway not reaching it (such as while it restarts after an update), a
 * timeout, and too many requests. A full disk (507) isn't one of them. */
const TEMPORARY = new Set([408, 429, 500, 502, 503, 504]);

/** A failure that trying again could fix: no answer, a temporary status,
 * or, while sending, a piece that started in the wrong place. */
function worthRetrying(error: unknown, sending: boolean): boolean {
  if (!(error instanceof ApiError)) return false;
  const { status } = error;
  return status === 0 || TEMPORARY.has(status) || (sending && status === 409);
}

/** Uploads one file and returns it as saved. Throws an ApiError the page
 * can show, or `signal`'s reason when it's canceled. */
export async function uploadFile(
  upload: Pick<Upload, "file" | "name" | "folder">,
  transport: Transport,
  report: (state: UploadState) => void,
  signal: AbortSignal,
  pause: Wait = wait,
): Promise<Item> {
  const size = upload.file.size;
  let id: string | null = null;
  // Null when unknown, such as after a failed piece.
  let received: number | null = 0;
  let sent = 0;
  let failures = 0;
  try {
    for (;;) {
      signal.throwIfAborted();
      let sending = false;
      try {
        if (id === null) {
          id = await transport.start(size);
        } else if (received === null) {
          received = await transport.progress(id);
          sent = received;
        } else if (received < size) {
          sending = true;
          const offset = received;
          const piece = upload.file.slice(offset, Math.min(offset + PIECE_SIZE, size));
          report({ kind: "sending", sent });
          received = await transport.send(
            id,
            offset,
            piece,
            (bytes) => {
              sent = offset + bytes;
              report({ kind: "sending", sent });
            },
            signal,
          );
          sent = received;
        } else {
          report({ kind: "saving" });
          return await transport.finish(id, upload.folder.id, upload.name);
        }
        failures = 0;
      } catch (error) {
        signal.throwIfAborted();
        if (error instanceof ApiError && error.status === 404 && id !== null) {
          throw new ApiError(404, t("uploads.gone"));
        }
        if (!worthRetrying(error, sending)) throw error;
        if (id !== null) received = null;
        report({ kind: "retrying", sent });
        await pause(1000 * RETRY_DELAYS[Math.min(failures, RETRY_DELAYS.length - 1)]!, signal);
        failures += 1;
      }
    }
  } catch (error) {
    // A canceled upload's pieces would otherwise wait on the server for a
    // day before it removed them.
    if (signal.aborted && id !== null) {
      await transport.cancel(id).catch(() => undefined);
    }
    throw error;
  }
}

/** The uploads in this browser tab, which pages show and add to. */
export class UploadQueue {
  #uploads: readonly Upload[] = [];
  #listeners = new Set<() => void>();
  #finished = new Set<(upload: Upload) => void>();
  #controllers = new Map<number, AbortController>();
  #nextKey = 1;
  #running = false;
  readonly #transport: Transport;
  readonly #pause: Wait;

  constructor(transport: Transport, pause: Wait = wait) {
    this.#transport = transport;
    this.#pause = pause;
  }

  /** Every upload, oldest first. The list is replaced on each change. */
  get uploads(): readonly Upload[] {
    return this.#uploads;
  }

  /** Whether an upload is waiting or under way. */
  get busy(): boolean {
    return this.#uploads.some((upload) => !finished(upload.state));
  }

  /** Calls `listener` after every change. Returns a function that stops. */
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Calls `listener` each time a file is saved. */
  onFinished(listener: (upload: Upload) => void): () => void {
    this.#finished.add(listener);
    return () => this.#finished.delete(listener);
  }

  add(files: readonly { file: Blob; name: string }[], folder: Upload["folder"]): void {
    const added = files.map(({ file, name }) => ({
      key: this.#nextKey++,
      file,
      name,
      folder,
      state: { kind: "waiting" } as const,
    }));
    this.#uploads = [...this.#uploads, ...added];
    this.#changed();
    void this.#run();
  }

  cancel(key: number): void {
    const controller = this.#controllers.get(key);
    if (controller) {
      controller.abort();
    } else {
      this.#set(key, { kind: "canceled" });
    }
  }

  /** Cancels everything, such as before signing out, and waits until the
   * server has removed what arrived. */
  async cancelAll(): Promise<void> {
    for (const upload of this.#uploads) {
      if (!finished(upload.state)) this.cancel(upload.key);
    }
    while (this.#running) {
      await new Promise<void>((resolve) => {
        const stop = this.subscribe(() => {
          stop();
          resolve();
        });
      });
    }
  }

  /** Removes the uploads that are done, failed, or canceled. */
  clearFinished(): void {
    this.#uploads = this.#uploads.filter((upload) => !finished(upload.state));
    this.#changed();
  }

  async #run(): Promise<void> {
    if (this.#running) return;
    this.#running = true;
    try {
      for (;;) {
        const next = this.#uploads.find((upload) => upload.state.kind === "waiting");
        if (!next) break;
        const controller = new AbortController();
        this.#controllers.set(next.key, controller);
        try {
          const item = await uploadFile(
            next,
            this.#transport,
            (state) => this.#set(next.key, state),
            controller.signal,
            this.#pause,
          );
          this.#set(next.key, { kind: "done", item });
          const done = this.#uploads.find((upload) => upload.key === next.key);
          for (const listener of this.#finished) listener(done!);
        } catch (error) {
          this.#set(
            next.key,
            controller.signal.aborted
              ? { kind: "canceled" }
              : { kind: "failed", message: error instanceof Error ? error.message : t("error.problem") },
          );
        } finally {
          this.#controllers.delete(next.key);
        }
      }
    } finally {
      this.#running = false;
      this.#changed();
    }
  }

  #set(key: number, state: UploadState): void {
    this.#uploads = this.#uploads.map((upload) => (upload.key === key ? { ...upload, state } : upload));
    this.#changed();
  }

  #changed(): void {
    for (const listener of this.#listeners) listener();
  }
}

export function finished(state: UploadState): boolean {
  return state.kind === "done" || state.kind === "failed" || state.kind === "canceled";
}
