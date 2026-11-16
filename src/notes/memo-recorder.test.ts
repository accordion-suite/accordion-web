import assert from "node:assert/strict";
import { test } from "node:test";

import { recordingFormat, webmWithDuration } from "./memo-recorder.ts";

test("records in the first format the browser has", () => {
  assert.equal(recordingFormat(() => true)?.extension, "webm");
  assert.equal(recordingFormat((type) => type === "audio/mp4")?.extension, "m4a");
  assert.equal(recordingFormat((type) => type.startsWith("audio/ogg"))?.extension, "ogg");
  assert.equal(recordingFormat(() => false), null);
});

/** The start of a WebM file laid out as Chrome records one: the EBML
 * header, then a Segment of unknown size holding Info, Tracks, and the
 * first Cluster. */
function chromeWebm(): Uint8Array {
  const ebml = [0x1a, 0x45, 0xdf, 0xa3, 0x84, 0x42, 0x86, 0x81, 0x01];
  const segment = [0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff];
  // Info: TimestampScale of 1,000,000, and a MuxingApp "A".
  const infoChildren = [0x2a, 0xd7, 0xb1, 0x83, 0x0f, 0x42, 0x40, 0x4d, 0x80, 0x81, 0x41];
  const info = [0x15, 0x49, 0xa9, 0x66, 0x80 | infoChildren.length];
  const tracks = [0x16, 0x54, 0xae, 0x6b, 0x81, 0x00];
  const cluster = [0x1f, 0x43, 0xb6, 0x75, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xe7, 0x81, 0x00];
  return new Uint8Array([...ebml, ...segment, ...info, ...infoChildren, ...tracks, ...cluster]);
}

test("writes a WebM memo's length into its Info", () => {
  const before = chromeWebm();
  const after = webmWithDuration(before, 2500)!;
  assert.ok(after);
  assert.equal(after.length, before.length + 11 + 7);
  // Info now has an 8-byte size of 11 + 11 bytes, and ends with Duration.
  const info = 9 + 12;
  assert.deepEqual([...after.subarray(info, info + 4)], [0x15, 0x49, 0xa9, 0x66]);
  assert.deepEqual([...after.subarray(info + 4, info + 12)], [0x01, 0, 0, 0, 0, 0, 0, 22]);
  const duration = info + 12 + 11;
  assert.deepEqual([...after.subarray(duration, duration + 3)], [0x44, 0x89, 0x88]);
  assert.equal(new DataView(after.buffer, after.byteOffset + duration + 3, 8).getFloat64(0), 2500);
  // Everything after Info is unchanged.
  assert.deepEqual([...after.subarray(duration + 11)], [...before.subarray(info + 5 + 11)]);
});

test("leaves a WebM file alone when it already has a length or isn't as expected", () => {
  const once = webmWithDuration(chromeWebm(), 1000)!;
  assert.equal(webmWithDuration(once, 1000), null);
  assert.equal(webmWithDuration(new Uint8Array([1, 2, 3]), 1000), null);
  assert.equal(webmWithDuration(new Uint8Array(), 1000), null);
});
