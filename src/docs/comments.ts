// Comments on a document (decision 30, step 6). Each thread is about a
// stretch of text, which two Yjs relative positions mark: they name the
// characters themselves, so a thread stays with its text as people edit
// around it, in this browser and in everyone else's. The server keeps the
// threads and sends a live hint when they change. This plugin finds where
// each one's text is now, highlights it, and says which thread a click
// lands on.

import type { Node } from "prosemirror-model";
import { type EditorState, Plugin, PluginKey, type Transaction } from "prosemirror-state";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";
import { absolutePositionToRelativePosition, relativePositionToAbsolutePosition, ySyncPluginKey } from "y-prosemirror";
import * as Y from "yjs";

import { api } from "../api.ts";

/** Who did something, and when. */
export interface CommentMark {
  name: string;
  at: string;
}

export interface DocComment {
  id: string;
  /** The author's name. */
  name: string;
  /** Whether the reader wrote it, and so can change it. */
  mine: boolean;
  can_delete: boolean;
  text: string;
  /** The people it mentions, each as `@` and their name in the text. */
  mentions: Mention[];
  at: string;
  edited: string | null;
}

/** Someone a comment mentions. */
export interface Mention {
  user: string;
  /** Their name as the comment writes it, after `@`. */
  name: string;
}

/** Someone who can open the document, and so can be mentioned. */
export interface MentionPerson {
  id: string;
  name: string;
  username: string;
}

export interface CommentThread {
  id: string;
  /** Where the text starts and ends, as Yjs relative positions in base64. */
  start: string;
  end: string;
  /** The text as it was when the thread started. */
  quote: string;
  resolved: CommentMark | null;
  can_delete: boolean;
  /** The first comment, then the replies. */
  comments: DocComment[];
}

export interface CommentsView {
  /** Whether the reader can start threads, reply, and resolve them. */
  can_comment: boolean;
  threads: CommentThread[];
}

const base = (document: string) => `/api/docs/documents/${document}/comments`;

export function listComments(document: string): Promise<CommentsView> {
  return api("GET", base(document));
}

export function startThread(
  document: string,
  anchors: Anchors,
  quote: string,
  text: string,
  mentions: string[],
): Promise<CommentsView> {
  return api("POST", base(document), { start: anchors.start, end: anchors.end, quote, text, mentions });
}

export function replyTo(document: string, thread: string, text: string, mentions: string[]): Promise<CommentsView> {
  return api("POST", `${base(document)}/${thread}`, { text, mentions });
}

export function resolveThread(document: string, thread: string, resolved: boolean): Promise<CommentsView> {
  return api("PATCH", `${base(document)}/${thread}`, { resolved });
}

export function deleteThread(document: string, thread: string): Promise<CommentsView> {
  return api("DELETE", `${base(document)}/${thread}`);
}

export function editComment(
  document: string,
  thread: string,
  comment: string,
  text: string,
  mentions: string[],
): Promise<CommentsView> {
  return api("PATCH", `${base(document)}/${thread}/${comment}`, { text, mentions });
}

/** Everyone else who can open the document, by name, whom a comment can
 * mention. */
export function listPeople(document: string): Promise<MentionPerson[]> {
  return api("GET", `/api/docs/documents/${document}/people`);
}

export function deleteComment(document: string, thread: string, comment: string): Promise<CommentsView> {
  return api("DELETE", `${base(document)}/${thread}/${comment}`);
}

/** The kind of live hint the server sends when a document's comments
 * change, naming the document. */
export const COMMENTS_HINT = "docs.comments";

/** Where a thread's text starts and ends, as the server keeps them. */
export interface Anchors {
  start: string;
  end: string;
}

/** Where some text is in the document now. */
export interface Range {
  from: number;
  to: number;
}

/** The thread being written, before it's sent: where its text is, and the
 * text. */
export interface Draft extends Anchors, Range {
  quote: string;
}

/** The ID the draft's highlight and card go by. */
export const DRAFT = "new";

interface CommentsState {
  threads: readonly CommentThread[];
  /** Where each open thread's text is, for the ones whose text is still
   * there. */
  ranges: ReadonlyMap<string, Range>;
  draft: Draft | null;
  active: string | null;
  decorations: DecorationSet;
}

interface Change {
  threads?: readonly CommentThread[];
  draft?: Draft | null;
  active?: string | null;
}

const key = new PluginKey<CommentsState>("comments");

interface Binding {
  doc: Y.Doc;
  type: Y.XmlFragment;
  mapping: Map<Y.AbstractType<unknown>, Node>;
}

function bindingOf(state: EditorState): Binding | null {
  return (ySyncPluginKey.getState(state) as { binding?: Binding | null } | undefined)?.binding ?? null;
}

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function fromBase64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (character) => character.charCodeAt(0));
}

/** Where `position` is in the document now, or null if Yjs can't place
 * it, such as before the document has arrived. */
function place(state: EditorState, binding: Binding, anchor: string): number | null {
  try {
    const relative = Y.decodeRelativePosition(fromBase64(anchor));
    const at = relativePositionToAbsolutePosition(binding.doc, binding.type, relative, binding.mapping);
    return at === null ? null : Math.max(0, Math.min(at, state.doc.content.size));
  } catch {
    return null;
  }
}

/** Where `anchors`' text is now, or null if it's all gone. */
function locate(state: EditorState, binding: Binding, anchors: Anchors): Range | null {
  const from = place(state, binding, anchors.start);
  const to = place(state, binding, anchors.end);
  if (from === null || to === null || to <= from) return null;
  return state.doc.textBetween(from, to, "\n", "\n").trim() ? { from, to } : null;
}

/** The positions of `range` for the server, or null before the document
 * has arrived. */
export function anchorsOf(state: EditorState, range: Range): Anchors | null {
  const binding = bindingOf(state);
  if (!binding) return null;
  try {
    const at = (pos: number) =>
      toBase64(Y.encodeRelativePosition(absolutePositionToRelativePosition(pos, binding.type, binding.mapping)));
    return { start: at(range.from), end: at(range.to) };
  } catch {
    return null;
  }
}

function locateAll(state: EditorState, threads: readonly CommentThread[]): Map<string, Range> {
  const ranges = new Map<string, Range>();
  const binding = bindingOf(state);
  if (!binding) return ranges;
  for (const thread of threads) {
    if (thread.resolved) continue;
    const range = locate(state, binding, thread);
    if (range) ranges.set(thread.id, range);
  }
  return ranges;
}

function decorate(doc: Node, ranges: ReadonlyMap<string, Range>, draft: Draft | null, active: string | null): DecorationSet {
  const decorations: Decoration[] = [];
  for (const [id, range] of ranges) {
    decorations.push(Decoration.inline(range.from, range.to, { class: id === active ? "docs-comment active" : "docs-comment" }));
  }
  if (draft) decorations.push(Decoration.inline(draft.from, draft.to, { class: "docs-comment active" }));
  return DecorationSet.create(doc, decorations);
}

function mapRange(range: Range, tr: Transaction): Range | null {
  const from = tr.mapping.map(range.from, 1);
  const to = tr.mapping.map(range.to, -1);
  return to > from ? { from, to } : null;
}

/** The plugin that highlights each open thread's text. `onClick` gets the
 * thread a click lands in, or null for a click outside every thread. */
export function commentsPlugin(onClick: (thread: string | null) => void): Plugin<CommentsState> {
  return new Plugin<CommentsState>({
    key,
    state: {
      init: () => ({ threads: [], ranges: new Map(), draft: null, active: null, decorations: DecorationSet.empty }),
      apply(tr, before, _old, state) {
        const change = tr.getMeta(key) as Change | undefined;
        // An edit that came through Yjs, from someone else or an undo,
        // can move text anywhere, so each thread is placed again from its
        // positions. A change made here moves text predictably.
        const remote = (tr.getMeta(ySyncPluginKey) as { isChangeOrigin?: boolean } | undefined)?.isChangeOrigin === true;
        if (!change && !tr.docChanged && !remote) return before;
        const threads = change?.threads ?? before.threads;
        const active = change && "active" in change ? (change.active ?? null) : before.active;
        let draft = change && "draft" in change ? (change.draft ?? null) : before.draft;
        let ranges: ReadonlyMap<string, Range>;
        if (change?.threads || remote) {
          ranges = locateAll(state, threads);
          if (draft && remote && !change?.draft) {
            const binding = bindingOf(state);
            const range = binding ? locate(state, binding, draft) : null;
            draft = range ? { ...draft, ...range } : null;
          }
        } else if (tr.docChanged) {
          const mapped = new Map<string, Range>();
          for (const [id, range] of before.ranges) {
            const moved = mapRange(range, tr);
            if (moved) mapped.set(id, moved);
          }
          ranges = mapped;
          if (draft && !change?.draft) {
            const moved = mapRange(draft, tr);
            draft = moved ? { ...draft, ...moved } : null;
          }
        } else {
          ranges = before.ranges;
        }
        return { threads, ranges, draft, active, decorations: decorate(state.doc, ranges, draft, active) };
      },
    },
    props: {
      decorations: (state) => key.getState(state)?.decorations,
      handleClick(view, pos) {
        onClick(threadAt(view.state, pos));
        return false;
      },
    },
  });
}

/** The open thread whose text is at `pos`, the shortest if there are
 * several. */
export function threadAt(state: EditorState, pos: number): string | null {
  const ranges = key.getState(state)?.ranges;
  let found: string | null = null;
  let length = Infinity;
  for (const [id, range] of ranges ?? []) {
    if (pos >= range.from && pos <= range.to && range.to - range.from < length) {
      found = id;
      length = range.to - range.from;
    }
  }
  return found;
}

/** Where each open thread's text is now, in the order of the text, and the
 * draft's, as `DRAFT`. */
export function commentRanges(state: EditorState): { id: string; range: Range }[] {
  const plugin = key.getState(state);
  if (!plugin) return [];
  const all = [...plugin.ranges].map(([id, range]) => ({ id, range }));
  if (plugin.draft) all.push({ id: DRAFT, range: { from: plugin.draft.from, to: plugin.draft.to } });
  return all.sort((a, b) => a.range.from - b.range.from || a.range.to - b.range.to);
}

/** The thread being written, if there is one. */
export function draftOf(state: EditorState): Draft | null {
  return key.getState(state)?.draft ?? null;
}

/** Shows the server's threads. */
export function showThreads(view: EditorView, threads: readonly CommentThread[]): void {
  view.dispatch(view.state.tr.setMeta(key, { threads } satisfies Change));
}

/** Marks the thread someone's looking at, which its highlight shows. */
export function setActiveThread(view: EditorView, active: string | null): void {
  if ((key.getState(view.state)?.active ?? null) === active) return;
  view.dispatch(view.state.tr.setMeta(key, { active } satisfies Change));
}

/** Starts a thread on the selected text. Returns false if nothing's
 * selected, or the document hasn't arrived. */
export function startDraft(view: EditorView): boolean {
  const { from, to, empty } = view.state.selection;
  const quote = view.state.doc.textBetween(from, to, " ", " ").trim();
  if (empty || !quote) return false;
  const anchors = anchorsOf(view.state, { from, to });
  if (!anchors) return false;
  view.dispatch(view.state.tr.setMeta(key, { draft: { ...anchors, from, to, quote }, active: null } satisfies Change));
  return true;
}

export function clearDraft(view: EditorView): void {
  if (!draftOf(view.state)) return;
  view.dispatch(view.state.tr.setMeta(key, { draft: null } satisfies Change));
}

/** Threads in the order of their text, then the ones whose text is gone,
 * oldest first. */
export function inTextOrder(state: EditorState, threads: readonly CommentThread[]): CommentThread[] {
  const ranges = key.getState(state)?.ranges ?? new Map<string, Range>();
  const binding = bindingOf(state);
  const at = (thread: CommentThread) =>
    ranges.get(thread.id)?.from ?? (binding && locate(state, binding, thread)?.from) ?? Infinity;
  const placed = threads.map((thread, index) => ({ thread, index, at: at(thread) }));
  return placed.sort((a, b) => a.at - b.at || a.index - b.index).map(({ thread }) => thread);
}

/** Where an open thread's text is now, or null if it's resolved or its
 * text is gone. */
export function rangeOf(state: EditorState, thread: string): Range | null {
  return key.getState(state)?.ranges.get(thread) ?? null;
}
