// Records voice memos in the browser (decision 33). The memo stays in the
// format the browser records: WebM with Opus in Chrome and Firefox, MP4
// with AAC in Safari. Obsidian plays both.

/** The longest memo, after which recording stops by itself. Transcripts
 * stop at the same length. */
export const MAX_MEMO_MS = 30 * 60 * 1000;

/** Small enough that 30 minutes is about 15 MB, and plenty for a voice. */
const BITS_PER_SECOND = 64_000;

/** A format the browser records, and the extension its file gets. */
export interface Format {
  type: string;
  extension: "webm" | "m4a" | "ogg";
}

const FORMATS: readonly Format[] = [
  { type: "audio/webm;codecs=opus", extension: "webm" },
  { type: "audio/mp4", extension: "m4a" },
  { type: "audio/ogg;codecs=opus", extension: "ogg" },
];

/** The first format the browser records, or null if it records none
 * Notes keeps. */
export function recordingFormat(supported: (type: string) => boolean): Format | null {
  return FORMATS.find((format) => supported(format.type)) ?? null;
}

/** Why recording couldn't start, as a message key. */
export type RecordingProblem = "notes.micBlocked" | "notes.noMic" | "notes.cantRecord";

export class RecordingError extends Error {
  constructor(readonly problem: RecordingProblem) {
    super(problem);
  }
}

/** A finished memo. */
export interface Memo {
  blob: Blob;
  extension: Format["extension"];
}

/** A memo being recorded from the microphone. */
export class Recording {
  private chunks: Blob[] = [];
  private readonly started = performance.now();
  private readonly stopped: Promise<void>;

  private constructor(
    private readonly recorder: MediaRecorder,
    private readonly stream: MediaStream,
    private readonly format: Format,
  ) {
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) this.chunks.push(event.data);
    });
    this.stopped = new Promise((done) => recorder.addEventListener("stop", () => done(), { once: true }));
    // Parts arrive each second, so a memo stopped by closing the page
    // keeps what was said.
    recorder.start(1000);
  }

  /** Asks for the microphone and starts recording. */
  static async start(): Promise<Recording> {
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      throw new RecordingError("notes.cantRecord");
    }
    const format = recordingFormat((type) => MediaRecorder.isTypeSupported(type));
    if (!format) throw new RecordingError("notes.cantRecord");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (problem) {
      const name = problem instanceof DOMException ? problem.name : "";
      if (name === "NotFoundError" || name === "OverconstrainedError") throw new RecordingError("notes.noMic");
      if (name === "NotAllowedError" || name === "SecurityError") throw new RecordingError("notes.micBlocked");
      throw new RecordingError("notes.cantRecord");
    }
    try {
      return new Recording(new MediaRecorder(stream, { mimeType: format.type, audioBitsPerSecond: BITS_PER_SECOND }), stream, format);
    } catch {
      stream.getTracks().forEach((track) => track.stop());
      throw new RecordingError("notes.cantRecord");
    }
  }

  /** How long it's been recording, in milliseconds. */
  elapsed(): number {
    return performance.now() - this.started;
  }

  /** Stops recording and gives the memo. */
  async finish(): Promise<Memo> {
    const length = this.elapsed();
    this.stop();
    await this.stopped;
    const type = this.recorder.mimeType || this.format.type;
    const blob = new Blob(this.chunks, { type });
    return { blob: this.format.extension === "webm" ? await withLength(blob, length) : blob, extension: this.format.extension };
  }

  /** Stops recording and throws the memo away. */
  cancel(): void {
    this.stop();
    this.chunks = [];
  }

  private stop() {
    if (this.recorder.state !== "inactive") this.recorder.stop();
    this.stream.getTracks().forEach((track) => track.stop());
  }
}

/** How much of the start of a WebM file holds its header. */
const HEAD_BYTES = 64 * 1024;

/** A WebM memo with its length written in, which Chrome leaves out, so
 * players show how long it is and can skip ahead. Anything this doesn't
 * expect stays as it was. */
async function withLength(blob: Blob, ms: number): Promise<Blob> {
  const head = new Uint8Array(await blob.slice(0, HEAD_BYTES).arrayBuffer());
  const fixed = webmWithDuration(head, ms);
  return fixed ? new Blob([fixed as BlobPart, blob.slice(HEAD_BYTES)], { type: blob.type }) : blob;
}

// Matroska element IDs, with their length marker, as they're written.
const EBML = 0x1a45dfa3;
const SEGMENT = 0x18538067;
const SEEK_HEAD = 0x114d9b74;
const INFO = 0x1549a966;
const TIMESTAMP_SCALE = 0x2ad7b1;
const DURATION = 0x4489;
const CLUSTER = 0x1f43b675;

/** An element's header: its ID, where its contents start, and their size,
 * or null for "unknown", as a recording still going writes. */
interface Header {
  id: number;
  idLength: number;
  start: number;
  size: number | null;
}

/** The variable-length number at `at` (EBML's "vint"): its length, and its
 * value with or without the length marker. */
function vint(bytes: Uint8Array, at: number): { length: number; raw: number; value: number; unknown: boolean } | null {
  const first = bytes[at];
  if (first === undefined || first === 0) return null;
  let length = 1;
  let marker = 0x80;
  while ((first & marker) === 0) {
    marker >>= 1;
    length++;
  }
  if (at + length > bytes.length) return null;
  let raw = first;
  let value = first & (marker - 1);
  let unknown = value === marker - 1;
  for (let index = 1; index < length; index++) {
    const byte = bytes[at + index]!;
    raw = raw * 256 + byte;
    value = value * 256 + byte;
    unknown &&= byte === 0xff;
  }
  return { length, raw, value, unknown };
}

function header(bytes: Uint8Array, at: number): Header | null {
  const id = vint(bytes, at);
  if (!id) return null;
  const size = vint(bytes, at + id.length);
  if (!size) return null;
  return { id: id.raw, idLength: id.length, start: at + id.length + size.length, size: size.unknown ? null : size.value };
}

/** The start of a WebM file, `head`, with a Duration of `ms` added to its
 * Info, or null if it has one already or isn't laid out as browsers
 * record. A file with a SeekHead is left alone, since adding bytes would
 * move what it points to. */
export function webmWithDuration(head: Uint8Array, ms: number): Uint8Array | null {
  const ebml = header(head, 0);
  if (!ebml || ebml.id !== EBML || ebml.size === null) return null;
  const segment = header(head, ebml.start + ebml.size);
  if (!segment || segment.id !== SEGMENT) return null;
  let at = segment.start;
  while (at < head.length) {
    const element = header(head, at);
    if (!element || element.id === SEEK_HEAD || element.id === CLUSTER) return null;
    if (element.size === null) return null;
    const end = element.start + element.size;
    if (element.id !== INFO) {
      at = end;
      continue;
    }
    if (end > head.length) return null;
    let scale = 1_000_000;
    for (let child = element.start; child < end; ) {
      const inner = header(head, child);
      if (!inner || inner.size === null) return null;
      if (inner.id === DURATION) return null;
      if (inner.id === TIMESTAMP_SCALE) {
        scale = 0;
        for (let index = 0; index < inner.size; index++) scale = scale * 256 + head[inner.start + index]!;
      }
      child = inner.start + inner.size;
    }
    if (scale === 0) return null;
    // Duration: its ID, a size of 8, and a 64-bit float in scale units.
    const duration = new Uint8Array(11);
    duration.set([0x44, 0x89, 0x88]);
    new DataView(duration.buffer).setFloat64(3, (ms * 1_000_000) / scale);
    // Info's new size, as an 8-byte vint, which fits any size.
    const size = new Uint8Array(8);
    let left = element.size + duration.length;
    for (let index = 7; index > 0; index--) {
      size[index] = left % 256;
      left = Math.floor(left / 256);
    }
    size[0] = 0x01;
    const out = new Uint8Array(head.length + duration.length + size.length - (element.start - at - element.idLength));
    let written = 0;
    const put = (part: Uint8Array) => {
      out.set(part, written);
      written += part.length;
    };
    put(head.subarray(0, at + element.idLength));
    put(size);
    put(head.subarray(element.start, end));
    put(duration);
    put(head.subarray(end));
    return out;
  }
  return null;
}
