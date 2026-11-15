// Editing a shared note together (decisions 30 and 31): a Yjs document
// kept in step with the server's over a WebSocket, using Yjs's standard
// sync and awareness messages, as y-websocket sends them.
//
// The server closes the connection with a code that says why. It reconnects
// after a dropped connection, a restart, or a change of access, and stops
// when the note is gone or the reader signed out.

import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as awarenessProtocol from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";

import { textChange } from "./text-change.ts";

const SYNC = 0;
const AWARENESS = 1;

/** The server's close codes (accordion-module's `coedit`). */
const SIGNED_OUT = 4001;
const GONE = 4004;
const NOT_FOUND_TRIES = 3;

/** How long to wait before reconnecting, growing with each failure. */
const RETRY_MS = [500, 1000, 2000, 5000, 10000];

export type LiveStatus =
  /** Connecting, before the note's text has arrived. */
  | "connecting"
  /** In step with everyone else. */
  | "live"
  /** The connection dropped. Typing is kept and sent once it's back. */
  | "reconnecting"
  /** The note was deleted, or the reader can't open it any more. */
  | "gone"
  /** The reader's session ended. */
  | "signedOut";

/** Someone else with the note open. */
export interface Visitor {
  name: string;
  color: string;
}

/** Someone else's caret, as an offset in the body. */
export interface RemoteCaret extends Visitor {
  /** Their awareness client, which tells carets apart. */
  client: number;
  at: number;
}

/** Colors for people's carets, readable on every note color in light and
 * dark. */
const CARET_COLORS = ["#d93025", "#1967d2", "#188038", "#e37400", "#9334e6", "#c2185b", "#00796b", "#5f6368"];

/** A person's caret color, the same in every browser. */
export function caretColor(name: string): string {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
  return CARET_COLORS[hash % CARET_COLORS.length]!;
}

/** A shared note's document, live while it's open. */
export class LiveNote {
  readonly doc = new Y.Doc();
  readonly body = this.doc.getText("body");
  /** What everyone sees the note as, which only the browsers use: the
   * server writes only the front matter and the body. `checkboxes` is
   * set once someone shows or hides checkboxes, so everyone switches. */
  readonly view = this.doc.getMap<boolean>("view");
  readonly awareness = new awarenessProtocol.Awareness(this.doc);
  private socket: WebSocket | null = null;
  private tries = 0;
  private stopped = false;
  private synced = false;
  private timer: number | undefined;

  constructor(
    private readonly id: string,
    me: { name: string },
    private readonly onStatus: (status: LiveStatus) => void,
  ) {
    this.awareness.setLocalState({ user: { name: me.name, color: caretColor(me.name) } });
    this.doc.on("update", (update: Uint8Array, origin: unknown) => {
      if (origin === this) return;
      this.send((encoder) => {
        encoding.writeVarUint(encoder, SYNC);
        syncProtocol.writeUpdate(encoder, update);
      });
    });
    this.awareness.on("update", ({ added, updated, removed }: AwarenessChange, origin: unknown) => {
      if (origin === this) return;
      const changed = [...added, ...updated, ...removed];
      this.send((encoder) => {
        encoding.writeVarUint(encoder, AWARENESS);
        encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed));
      });
    });
    this.connect();
  }

  /** The other people here. Someone with the note open in two tabs
   * counts once. */
  visitors(): Visitor[] {
    const visitors = new Map<string, Visitor>();
    this.awareness.getStates().forEach((state, client) => {
      const user = userOf(state);
      if (client !== this.doc.clientID && user) visitors.set(user.name, user);
    });
    return [...visitors.values()];
  }

  /** Where the others' carets are, as offsets in the body. */
  carets(): RemoteCaret[] {
    const carets: RemoteCaret[] = [];
    this.awareness.getStates().forEach((state, client) => {
      const user = userOf(state);
      const head = (state as { cursor?: { head?: unknown } }).cursor?.head;
      if (client === this.doc.clientID || !user || !head) return;
      try {
        const at = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(head), this.doc);
        if (at && at.type === this.body) carets.push({ ...user, client, at: at.index });
      } catch {
        // Someone else's state that doesn't read as a position.
      }
    });
    return carets;
  }

  /** Tells the others where the reader's caret is, as an offset in the
   * body, or that it's not in the note. */
  setCaret(at: { start: number; end: number } | null): void {
    const position = (index: number) =>
      Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(this.body, index)) as unknown;
    const cursor = at && { anchor: position(at.start), head: position(at.end) };
    const current = (this.awareness.getLocalState() as { cursor?: unknown } | null)?.cursor ?? null;
    if (JSON.stringify(current) === JSON.stringify(cursor)) return;
    this.awareness.setLocalStateField("cursor", cursor);
  }

  /** Whether everyone sees checkboxes, once someone chose. */
  checkboxes(): boolean | undefined {
    return this.view.get("checkboxes");
  }

  /** Changes the body to `text` with the fewest edits, so others' typing
   * elsewhere in it stays. */
  setBody(text: string, checkboxes?: boolean): void {
    const change = textChange(this.body.toString(), text);
    const switched = checkboxes !== undefined && this.view.get("checkboxes") !== checkboxes;
    if (!change && !switched) return;
    // One change, so the others get the new text and the switch together.
    this.doc.transact(() => {
      if (change && change.removed > 0) this.body.delete(change.start, change.removed);
      if (change?.inserted) this.body.insert(change.start, change.inserted);
      if (switched) this.view.set("checkboxes", checkboxes);
    });
  }

  /** Leaves the note. The server saves it once everyone has. */
  close(): void {
    this.stopped = true;
    window.clearTimeout(this.timer);
    awarenessProtocol.removeAwarenessStates(this.awareness, [this.doc.clientID], this);
    this.socket?.close(1000);
    this.socket = null;
    this.awareness.destroy();
    this.doc.destroy();
  }

  private connect(): void {
    if (this.stopped) return;
    const scheme = location.protocol === "https:" ? "wss" : "ws";
    const socket = new WebSocket(`${scheme}://${location.host}/api/notes/notes/${this.id}/live`);
    socket.binaryType = "arraybuffer";
    this.socket = socket;
    this.synced = false;
    this.onStatus(this.tries === 0 ? "connecting" : "reconnecting");

    socket.onopen = () => {
      this.send((encoder) => {
        encoding.writeVarUint(encoder, SYNC);
        syncProtocol.writeSyncStep1(encoder, this.doc);
      });
      this.send((encoder) => {
        encoding.writeVarUint(encoder, AWARENESS);
        encoding.writeVarUint8Array(
          encoder,
          awarenessProtocol.encodeAwarenessUpdate(this.awareness, [this.doc.clientID]),
        );
      });
    };
    socket.onmessage = (event: MessageEvent<ArrayBuffer>) => this.receive(new Uint8Array(event.data));
    socket.onclose = (event) => {
      if (this.socket !== socket) return;
      this.socket = null;
      // Others' cursors are stale until they say again.
      const others = [...this.awareness.getStates().keys()].filter((client) => client !== this.doc.clientID);
      awarenessProtocol.removeAwarenessStates(this.awareness, others, this);
      if (this.stopped) return;
      if (event.code === SIGNED_OUT) {
        this.onStatus("signedOut");
        return;
      }
      if (event.code === GONE) {
        this.onStatus("gone");
        return;
      }
      // A refused upgrade, such as for a note that's no longer shared,
      // reaches the browser as a plain failure without a code. After a few,
      // the note counts as gone.
      if (!this.synced && this.tries >= NOT_FOUND_TRIES && event.code === 1006) {
        void this.stillThere().then((there) => (there ? this.retry() : this.onStatus("gone")));
        return;
      }
      this.retry();
    };
  }

  private retry(): void {
    this.onStatus("reconnecting");
    const wait = RETRY_MS[Math.min(this.tries, RETRY_MS.length - 1)]!;
    this.tries++;
    this.timer = window.setTimeout(() => this.connect(), wait);
  }

  /** Whether the reader can still open the note. */
  private async stillThere(): Promise<boolean> {
    try {
      const response = await fetch(`/api/notes/notes/${this.id}`, { credentials: "same-origin" });
      return response.status !== 404 && response.status !== 401;
    } catch {
      return true;
    }
  }

  private receive(bytes: Uint8Array): void {
    const decoder = decoding.createDecoder(bytes);
    const encoder = encoding.createEncoder();
    const kind = decoding.readVarUint(decoder);
    if (kind === SYNC) {
      encoding.writeVarUint(encoder, SYNC);
      const step = syncProtocol.readSyncMessage(decoder, encoder, this.doc, this);
      if (step === syncProtocol.messageYjsSyncStep2 && !this.synced) {
        this.synced = true;
        this.tries = 0;
        this.onStatus("live");
      }
      if (encoding.length(encoder) > 1) this.socket?.send(encoding.toUint8Array(encoder));
    } else if (kind === AWARENESS) {
      awarenessProtocol.applyAwarenessUpdate(this.awareness, decoding.readVarUint8Array(decoder), this);
    }
  }

  private send(write: (encoder: encoding.Encoder) => void): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    const encoder = encoding.createEncoder();
    write(encoder);
    this.socket.send(encoding.toUint8Array(encoder));
  }
}

function userOf(state: unknown): Visitor | null {
  const user = (state as { user?: { name?: unknown; color?: unknown } } | null)?.user;
  if (typeof user?.name !== "string") return null;
  const color = typeof user.color === "string" && /^#[0-9a-f]{6}$/i.test(user.color) ? user.color : caretColor(user.name);
  return { name: user.name, color };
}

interface AwarenessChange {
  added: number[];
  updated: number[];
  removed: number[];
}
