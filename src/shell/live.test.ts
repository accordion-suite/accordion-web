import assert from "node:assert/strict";
import { test } from "node:test";

import { hintIds, LiveStream, onLive, SILENCE_MS, type Source } from "./live.ts";

/** Stands in for `EventSource`, and lets a test send it events. */
class FakeSource implements Source {
  onopen: ((event: Event) => void) | null = null;
  closed = false;
  private readonly listeners = new Map<string, ((event: MessageEvent<string>) => void)[]>();

  addEventListener(kind: string, listener: (event: MessageEvent<string>) => void): void {
    this.listeners.set(kind, [...(this.listeners.get(kind) ?? []), listener]);
  }

  close(): void {
    this.closed = true;
  }

  send(kind: string, data: string): void {
    for (const listener of this.listeners.get(kind) ?? []) listener({ data } as MessageEvent<string>);
  }
}

function setUp() {
  let now = 0;
  const sources: FakeSource[] = [];
  const stream = new LiveStream(
    () => {
      const source = new FakeSource();
      sources.push(source);
      return source;
    },
    () => now,
  );
  return { stream, sources, wait: (ms: number) => (now += ms) };
}

test("hints reach the listeners for their kind", (t) => {
  const { stream, sources } = setUp();
  const heard: (string[] | null)[] = [];
  t.after(onLive("test.items", (ids) => heard.push(ids)));
  stream.start();
  t.after(() => stream.stop());
  const source = sources[0]!;
  source.onopen?.(new Event("open"));
  source.send("test.items", '{"ids":["a","b"]}');
  source.send("test.other", '{"ids":["c"]}');
  assert.deepEqual(heard, [["a", "b"]]);
});

test("reconnecting loads everything again, but opening the first time doesn't", (t) => {
  const { stream, sources } = setUp();
  const heard: (string[] | null)[] = [];
  t.after(onLive("test.items", (ids) => heard.push(ids)));
  stream.start();
  t.after(() => stream.stop());
  sources[0]!.onopen?.(new Event("open"));
  assert.deepEqual(heard, []);
  // The browser reconnects the same stream after a drop.
  sources[0]!.onopen?.(new Event("open"));
  assert.deepEqual(heard, [null]);
});

test("a stream that goes quiet is opened again", (t) => {
  const { stream, sources, wait } = setUp();
  const heard: (string[] | null)[] = [];
  t.after(onLive("test.items", (ids) => heard.push(ids)));
  stream.start();
  t.after(() => stream.stop());
  sources[0]!.onopen?.(new Event("open"));

  // Pings keep it open.
  wait(SILENCE_MS - 1000);
  sources[0]!.send("ping", "{}");
  wait(SILENCE_MS - 1000);
  stream.check();
  assert.equal(sources.length, 1);

  wait(2000);
  stream.check();
  assert.equal(sources.length, 2);
  assert.ok(sources[0]!.closed);
  // The old stream is ignored, and the new one reloads when it opens.
  sources[0]!.send("test.items", '{"ids":["old"]}');
  sources[1]!.onopen?.(new Event("open"));
  sources[1]!.send("test.items", '{"ids":["new"]}');
  assert.deepEqual(heard, [null, ["new"]]);
});

test("kinds listened for later reach an open stream", (t) => {
  const { stream, sources } = setUp();
  stream.start();
  t.after(() => stream.stop());
  const heard: (string[] | null)[] = [];
  t.after(onLive("test.later", (ids) => heard.push(ids)));
  sources[0]!.send("test.later", '{"ids":["x"]}');
  assert.deepEqual(heard, [["x"]]);
});

test("hints without IDs, or with data that isn't JSON, name nothing", () => {
  assert.deepEqual(hintIds("{}"), []);
  assert.deepEqual(hintIds("not json"), []);
  assert.deepEqual(hintIds('{"ids":["a",5]}'), ["a"]);
});
