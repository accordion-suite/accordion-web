import assert from "node:assert/strict";
import { test } from "node:test";

import { ApiError } from "../api.ts";
import { t } from "../i18n.ts";
import type { Item } from "./item.ts";
import { PIECE_SIZE, type Transport, UploadQueue, type UploadState, type Wait, uploadFile } from "./uploads.ts";

const FOLDER = { id: "folder-1", name: "Photos" };

/** A pretend server. Each `fail` hook can make one call fail the way a real
 * connection or server does. */
class FakeServer implements Transport {
  uploads = new Map<string, { size: number; data: Uint8Array[] }>();
  saved: { folder: string; name: string; content: Uint8Array }[] = [];
  calls: string[] = [];
  next = 1;
  fail: {
    start?: () => ApiError | undefined;
    // Keeps `keep` bytes of the piece, then fails with `error`.
    send?: (offset: number) => { keep: number; error: ApiError } | undefined;
    progress?: () => ApiError | undefined;
    finish?: () => ApiError | undefined;
  } = {};

  received(id: string): number {
    return this.uploads.get(id)!.data.reduce((sum, part) => sum + part.length, 0);
  }

  async start(size: number): Promise<string> {
    this.calls.push(`start ${size}`);
    const error = this.fail.start?.();
    if (error) throw error;
    const id = `upload-${this.next++}`;
    this.uploads.set(id, { size, data: [] });
    return id;
  }

  async progress(id: string): Promise<number> {
    this.calls.push("progress");
    const error = this.fail.progress?.();
    if (error) throw error;
    return this.received(id);
  }

  async send(
    id: string,
    offset: number,
    piece: Blob,
    onSent: (bytes: number) => void,
    signal: AbortSignal,
  ): Promise<number> {
    this.calls.push(`send ${offset} ${piece.size}`);
    if (offset !== this.received(id)) throw new ApiError(409, "That piece starts in the wrong place.");
    const bytes = new Uint8Array(await piece.arrayBuffer());
    const failure = this.fail.send?.(offset);
    if (failure) {
      this.uploads.get(id)!.data.push(bytes.slice(0, failure.keep));
      throw failure.error;
    }
    onSent(bytes.length);
    signal.throwIfAborted();
    this.uploads.get(id)!.data.push(bytes);
    return this.received(id);
  }

  async finish(id: string, folder: string, name: string): Promise<Item> {
    this.calls.push("finish");
    const error = this.fail.finish?.();
    if (error) throw error;
    const upload = this.uploads.get(id)!;
    const content = new Uint8Array(await new Blob(upload.data as BlobPart[]).arrayBuffer());
    this.saved.push({ folder, name, content });
    this.uploads.delete(id);
    return {
      id: `file-${this.saved.length}`,
      parent: folder,
      name,
      kind: "file",
      size: content.length,
      created_at: "2026-10-29T00:00:00Z",
      modified_at: "2026-10-29T00:00:00Z",
    };
  }

  async cancel(id: string): Promise<void> {
    this.calls.push("cancel");
    this.uploads.delete(id);
  }
}

/** Records each pause instead of waiting. */
function pauses(): { pause: Wait; waited: number[] } {
  const waited: number[] = [];
  return {
    waited,
    pause: async (ms, signal) => {
      signal.throwIfAborted();
      waited.push(ms);
    },
  };
}

function file(size: number): Blob {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i++) bytes[i] = (i * 7) % 251;
  return new Blob([bytes]);
}

async function bytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

/** Runs one upload, keeping every state it reported. */
async function run(server: FakeServer, blob: Blob, signal = new AbortController().signal) {
  const { pause, waited } = pauses();
  const states: UploadState[] = [];
  const item = await uploadFile(
    { file: blob, name: "beach.mp4", folder: FOLDER },
    server,
    (state) => states.push(state),
    signal,
    pause,
  );
  return { item, states, waited };
}

test("sends a large file in pieces, then saves it in its folder", async () => {
  const server = new FakeServer();
  const blob = file(2 * PIECE_SIZE + 10);
  const { item } = await run(server, blob);
  assert.deepEqual(server.calls, [
    `start ${blob.size}`,
    `send 0 ${PIECE_SIZE}`,
    `send ${PIECE_SIZE} ${PIECE_SIZE}`,
    `send ${2 * PIECE_SIZE} 10`,
    "finish",
  ]);
  assert.equal(item.name, "beach.mp4");
  assert.equal(server.saved[0]!.folder, "folder-1");
  assert.deepEqual(server.saved[0]!.content, await bytes(blob));
});

test("an empty file needs no pieces", async () => {
  const server = new FakeServer();
  await run(server, new Blob([]));
  assert.deepEqual(server.calls, ["start 0", "finish"]);
});

test("after a dropped connection, sends only what didn't arrive", async () => {
  const server = new FakeServer();
  let dropped = false;
  server.fail.send = () => {
    if (dropped) return undefined;
    dropped = true;
    return { keep: 1000, error: new ApiError(0, t("error.offline")) };
  };
  const blob = file(5000);
  const { states, waited } = await run(server, blob);
  assert.deepEqual(server.calls, ["start 5000", "send 0 5000", "progress", "send 1000 4000", "finish"]);
  assert.deepEqual(server.saved[0]!.content, await bytes(blob));
  assert.deepEqual(waited, [1000]);
  assert.ok(states.some((state) => state.kind === "retrying"));
});

test("waits longer after each failure in a row, up to 30 seconds", async () => {
  const server = new FakeServer();
  let failures = 8;
  server.fail.start = () => (failures-- > 0 ? new ApiError(503, "Restarting.") : undefined);
  const { waited } = await run(server, file(10));
  assert.deepEqual(waited, [1000, 2000, 4000, 8000, 15000, 30000, 30000, 30000]);
});

test("a lost answer to a piece that arrived doesn't send it again", async () => {
  const server = new FakeServer();
  let lost = false;
  server.fail.send = () => {
    if (lost) return undefined;
    lost = true;
    return { keep: 3000, error: new ApiError(0, t("error.offline")) };
  };
  const blob = file(3000);
  await run(server, blob);
  assert.deepEqual(server.calls, ["start 3000", "send 0 3000", "progress", "finish"]);
  assert.deepEqual(server.saved[0]!.content, await bytes(blob));
});

test("a piece that starts in the wrong place starts again from the server's count", async () => {
  const server = new FakeServer();
  let refused = false;
  server.fail.send = () => {
    if (refused) return undefined;
    refused = true;
    return { keep: 0, error: new ApiError(409, "That piece starts in the wrong place.") };
  };
  const blob = file(3000);
  const { waited } = await run(server, blob);
  assert.deepEqual(server.calls, ["start 3000", "send 0 3000", "progress", "send 0 3000", "finish"]);
  assert.deepEqual(server.saved[0]!.content, await bytes(blob));
  assert.deepEqual(waited, [1000]);
});

test("a full disk stops the upload with the server's message", async () => {
  const server = new FakeServer();
  server.fail.start = () => new ApiError(507, "There isn't enough space left in your storage.");
  await assert.rejects(run(server, file(10)), { message: "There isn't enough space left in your storage." });
  assert.deepEqual(server.calls, ["start 10"]);
});

test("a name the folder already uses for a folder stops instead of trying forever", async () => {
  const server = new FakeServer();
  server.fail.finish = () => new ApiError(409, "Something with that name is already in this folder.");
  await assert.rejects(run(server, file(10)), { status: 409 });
  assert.deepEqual(server.calls, ["start 10", "send 0 10", "finish"]);
});

test("an upload the server removed explains what happened", async () => {
  const server = new FakeServer();
  server.fail.send = () => ({ keep: 0, error: new ApiError(0, "No answer.") });
  server.fail.progress = () => new ApiError(404, "Not found.");
  await assert.rejects(run(server, file(10)), { message: t("uploads.gone") });
});

test("canceling stops sending and removes what arrived", async () => {
  const server = new FakeServer();
  const controller = new AbortController();
  const blob = file(2 * PIECE_SIZE);
  server.fail.send = (offset) => {
    if (offset > 0) controller.abort();
    return undefined;
  };
  await assert.rejects(run(server, blob, controller.signal), { name: "AbortError" });
  assert.equal(server.calls.at(-1), "cancel");
  assert.equal(server.uploads.size, 0);
});

test("the queue uploads one file at a time, in order", async () => {
  const server = new FakeServer();
  const queue = new UploadQueue(server, pauses().pause);
  const saved: string[] = [];
  queue.onFinished((upload) => saved.push(upload.name));
  queue.add(
    [
      { file: file(10), name: "a.txt" },
      { file: file(20), name: "b.txt" },
    ],
    FOLDER,
  );
  assert.equal(queue.busy, true);
  await until(queue, () => !queue.busy);
  assert.deepEqual(saved, ["a.txt", "b.txt"]);
  assert.deepEqual(server.calls, ["start 10", "send 0 10", "finish", "start 20", "send 0 20", "finish"]);
  assert.deepEqual(
    queue.uploads.map((upload) => upload.state.kind),
    ["done", "done"],
  );
  queue.clearFinished();
  assert.equal(queue.uploads.length, 0);
});

test("canceling an upload that hasn't started skips it", async () => {
  const server = new FakeServer();
  const queue = new UploadQueue(server, pauses().pause);
  queue.add(
    [
      { file: file(10), name: "a.txt" },
      { file: file(20), name: "b.txt" },
    ],
    FOLDER,
  );
  queue.cancel(queue.uploads[1]!.key);
  await until(queue, () => !queue.busy);
  assert.deepEqual(
    queue.uploads.map((upload) => upload.state.kind),
    ["done", "canceled"],
  );
  assert.equal(server.saved.length, 1);
});

test("a failed upload shows why, and the next one still runs", async () => {
  const server = new FakeServer();
  let first = true;
  server.fail.finish = () => {
    if (!first) return undefined;
    first = false;
    return new ApiError(400, "Names can't contain a slash.");
  };
  const queue = new UploadQueue(server, pauses().pause);
  queue.add(
    [
      { file: file(10), name: "a.txt" },
      { file: file(20), name: "b.txt" },
    ],
    FOLDER,
  );
  await until(queue, () => !queue.busy);
  assert.deepEqual(queue.uploads[0]!.state, { kind: "failed", message: "Names can't contain a slash." });
  assert.equal(queue.uploads[1]!.state.kind, "done");
});

/** Resolves once `done` is true, checking after each change. */
function until(queue: UploadQueue, done: () => boolean): Promise<void> {
  return new Promise((resolve) => {
    if (done()) return resolve();
    const stop = queue.subscribe(() => {
      if (done()) {
        stop();
        resolve();
      }
    });
  });
}
