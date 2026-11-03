// Live updates (decision 19): one stream from the server in each tab, with
// hints about what changed, such as "the list of this folder changed", for
// the page to load again. Hints can be missed while the stream is down, so
// after it reconnects, everything listening loads what it shows again.

import { useEffect, useRef } from "preact/hooks";

/** Called with the IDs a hint names, or with null after reconnecting, to
 * load everything again. */
export type LiveListener = (ids: string[] | null) => void;

/** How long the stream can stay quiet before it counts as stopped. The
 * server sends a ping every 30 seconds. */
export const SILENCE_MS = 75_000;

/** How often the stream is checked for silence. */
const CHECK_EVERY_MS = 15_000;

/** The server's sign of life, which isn't a hint. */
const PING = "ping";

/** What the stream needs from `EventSource`, so tests can stand in for it. */
export interface Source {
  onopen: ((event: Event) => void) | null;
  addEventListener(kind: string, listener: (event: MessageEvent<string>) => void): void;
  close(): void;
}

const listeners = new Map<string, Set<LiveListener>>();
let current: LiveStream | null = null;

/** Calls `listener` for each hint of `kind`, and after reconnecting.
 * Returns a function that stops it. */
export function onLive(kind: string, listener: LiveListener): () => void {
  let forKind = listeners.get(kind);
  if (!forKind) {
    forKind = new Set();
    listeners.set(kind, forKind);
  }
  forKind.add(listener);
  current?.listen(kind);
  return () => forKind.delete(listener);
}

/** Calls the latest `listener` for each hint of `kind`, while the component
 * is shown. */
export function useLive(kind: string, listener: LiveListener): void {
  const latest = useRef(listener);
  latest.current = listener;
  useEffect(() => onLive(kind, (ids) => latest.current(ids)), [kind]);
}

function deliver(kind: string, ids: string[] | null): void {
  for (const listener of [...(listeners.get(kind) ?? [])]) listener(ids);
}

/** The IDs in a hint's data, `{"ids": [...]}`. */
export function hintIds(data: string): string[] {
  try {
    const parsed: unknown = JSON.parse(data);
    const ids = (parsed as { ids?: unknown } | null)?.ids;
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

/** One tab's stream, opened again when it goes quiet. */
export class LiveStream {
  private source: Source | null = null;
  private listening = new Set<string>();
  private opened = false;
  private heard = 0;

  constructor(
    private readonly connect: () => Source,
    private readonly now: () => number = Date.now,
  ) {}

  start(): void {
    current = this;
    this.open();
  }

  stop(): void {
    this.source?.close();
    this.source = null;
    if (current === this) current = null;
  }

  /** Opens a new stream if this one has been quiet too long, such as after
   * a network held messages back, or the server turned the browser away. */
  check(): void {
    if (this.source && this.now() - this.heard > SILENCE_MS) {
      this.source.close();
      this.open();
    }
  }

  /** Passes on hints of `kind` from now on. */
  listen(kind: string): void {
    const source = this.source;
    if (!source || this.listening.has(kind)) return;
    this.listening.add(kind);
    source.addEventListener(kind, (event) => {
      if (source !== this.source) return;
      this.heard = this.now();
      if (kind !== PING) deliver(kind, hintIds(event.data));
    });
  }

  private open(): void {
    const source = this.connect();
    this.source = source;
    this.listening = new Set();
    this.heard = this.now();
    source.onopen = () => {
      if (source !== this.source) return;
      this.heard = this.now();
      // The browser reconnects on its own after a drop, and this opens a
      // new stream after silence. Either way, hints may have been missed.
      if (this.opened) for (const kind of listeners.keys()) deliver(kind, null);
      this.opened = true;
    };
    this.listen(PING);
    for (const kind of listeners.keys()) this.listen(kind);
  }
}

/** Opens this tab's stream, for someone signed in. Returns a function that
 * closes it. */
export function startLive(): () => void {
  const stream = new LiveStream(() => new EventSource("/api/live"));
  stream.start();
  const timer = setInterval(() => stream.check(), CHECK_EVERY_MS);
  // Phones often close connections while a page is hidden, and timers
  // pause, so the stream is checked as soon as the page is back.
  const shown = () => {
    if (document.visibilityState === "visible") stream.check();
  };
  document.addEventListener("visibilitychange", shown);
  return () => {
    clearInterval(timer);
    document.removeEventListener("visibilitychange", shown);
    stream.stop();
  };
}
