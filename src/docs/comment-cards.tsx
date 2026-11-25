// Comments on a document, as Google Docs shows them (decision 30, step 6):
// cards beside the page, each level with its text where the window is wide
// enough, and a panel at the side that lists every thread, resolved ones
// too, and holds the cards on narrower screens.

import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import type { EditorView } from "prosemirror-view";

import { CheckIcon, CloseIcon, MoreIcon } from "../drive/icons.tsx";
import { t } from "../i18n.ts";
import { ConfirmDialog, problemText } from "../shell/dialog.tsx";
import { when } from "../shell/events.ts";
import { Menu, type MenuEntry, type MenuPlace } from "../shell/menu.tsx";
import { type CommentThread, commentRanges, type DocComment, DRAFT, type Draft, inTextOrder, rangeOf } from "./comments.ts";

/** What can be done to threads. Each answers once the server has it. */
export interface ThreadActions {
  reply(thread: string, text: string): Promise<void>;
  resolve(thread: string, resolved: boolean): Promise<void>;
  edit(thread: string, comment: string, text: string): Promise<void>;
  /** Deletes a comment, or the whole thread for `null`. */
  remove(thread: string, comment: string | null): Promise<void>;
}

/** The longest comment, as the server takes it. */
const MAX_TEXT = 4000;

/** The space between cards beside the page. */
const GAP = 8;

/** A box to write a comment in, which grows with what's typed. Ctrl+Enter
 * sends it and Escape gives up, as in Google Docs. */
function CommentBox({
  initial = "",
  placeholder,
  submit,
  autofocus = true,
  onSubmit,
  onCancel,
}: {
  initial?: string;
  placeholder: string;
  submit: string;
  autofocus?: boolean;
  onSubmit: (text: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (autofocus) field.current?.focus({ preventScroll: true });
  }, []);
  useLayoutEffect(() => {
    const element = field.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight + 2}px`;
  }, [text]);

  async function send() {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      await onSubmit(text);
      setText("");
    } catch (problem) {
      setError(problemText(problem));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      class="docs-comment-box"
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
      onClick={(event) => event.stopPropagation()}
    >
      <textarea
        ref={field}
        rows={1}
        value={text}
        maxLength={MAX_TEXT}
        placeholder={placeholder}
        aria-label={placeholder}
        onInput={(event) => setText(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            void send();
          } else if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onCancel();
          }
        }}
      />
      {error && (
        <p class="error" role="alert">
          {error}
        </p>
      )}
      <div class="docs-comment-buttons">
        <button type="submit" disabled={busy || !text.trim()}>
          {submit}
        </button>
        <button type="button" class="secondary" onClick={onCancel}>
          {t("dialog.cancel")}
        </button>
      </div>
    </form>
  );
}

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => [...word][0]!.toUpperCase())
      .join("") || "?"
  );
}

/** One comment in a thread: who wrote it and when, and what it says, or a
 * box to change it in. */
function CommentItem({
  thread,
  comment,
  first,
  canComment,
  actions,
  onError,
}: {
  thread: CommentThread;
  comment: DocComment;
  first: boolean;
  canComment: boolean;
  actions: ThreadActions;
  onError: (problem: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [menu, setMenu] = useState<{ place: MenuPlace; byKeyboard: boolean } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const name = comment.name || t("docs.commentSomeone");
  const canDelete = first ? thread.can_delete : comment.can_delete;
  const entries: MenuEntry[] = [
    ...(comment.mine && canComment ? [{ label: t("docs.commentEdit"), onSelect: () => setEditing(true) }] : []),
    ...(canDelete && canComment ? [{ label: t("docs.commentDelete"), onSelect: () => setDeleting(true) }] : []),
  ];

  async function act(action: () => Promise<void>) {
    try {
      await action();
    } catch (problem) {
      onError(problemText(problem));
    }
  }

  return (
    <div class="docs-comment-item">
      <div class="docs-comment-head">
        <span class="docs-comment-avatar" aria-hidden="true">
          {initials(name)}
        </span>
        <span class="docs-comment-who">
          <strong>{name}</strong>
          <span class="docs-comment-when">
            {when(comment.at)}
            {comment.edited && ` ${t("docs.commentEdited")}`}
          </span>
        </span>
        {first && canComment && !thread.resolved && (
          <button
            type="button"
            class="icon-button"
            title={t("docs.commentResolve")}
            aria-label={t("docs.commentResolve")}
            onClick={(event) => {
              event.stopPropagation();
              void act(() => actions.resolve(thread.id, true));
            }}
          >
            <CheckIcon />
          </button>
        )}
        {entries.length > 0 && (
          <button
            type="button"
            class="icon-button"
            title={t("docs.commentMore")}
            aria-label={t("docs.commentMore")}
            aria-haspopup="menu"
            aria-expanded={menu !== null}
            onClick={(event) => {
              event.stopPropagation();
              setMenu({ place: { under: event.currentTarget }, byKeyboard: event.detail === 0 });
            }}
          >
            <MoreIcon />
          </button>
        )}
      </div>
      {editing ? (
        <CommentBox
          initial={comment.text}
          placeholder={t("docs.commentEditLabel")}
          submit={t("docs.commentSave")}
          onSubmit={async (text) => {
            await actions.edit(thread.id, comment.id, text);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <p class="docs-comment-text">{comment.text}</p>
      )}
      {menu && (
        <Menu
          label={t("docs.commentMore")}
          entries={entries}
          place={menu.place}
          byKeyboard={menu.byKeyboard}
          align="end"
          onClose={() => setMenu(null)}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title={first ? t("docs.commentDeleteThreadTitle") : t("docs.commentDeleteTitle")}
          body={first ? t("docs.commentDeleteThreadBody") : t("docs.commentDeleteBody")}
          confirm={t("docs.commentDelete")}
          onConfirm={async () => {
            await actions.remove(thread.id, first ? null : comment.id);
            setDeleting(false);
          }}
          onClose={() => setDeleting(false)}
        />
      )}
    </div>
  );
}

/** A thread: its comments, and a box to reply while it's the one being
 * looked at. In the panel, it also shows the text it's about. */
export function ThreadCard({
  thread,
  active,
  canComment,
  inPanel = false,
  gone = false,
  actions,
  onActivate,
  cardRef,
  style,
}: {
  thread: CommentThread;
  active: boolean;
  canComment: boolean;
  inPanel?: boolean;
  /** Whether the text it's about has been deleted. */
  gone?: boolean;
  actions: ThreadActions;
  onActivate: () => void;
  cardRef?: (element: HTMLElement | null) => void;
  style?: string;
}) {
  const [error, setError] = useState("");
  const [replying, setReplying] = useState(false);
  useEffect(() => {
    if (!active) setReplying(false);
  }, [active]);
  const classes = ["docs-thread", active && "active", thread.resolved && "resolved"].filter(Boolean).join(" ");
  return (
    <article
      ref={cardRef}
      class={classes}
      style={style}
      aria-label={t("docs.commentThread", { name: thread.comments[0]?.name ?? "" })}
      onClick={() => {
        if (!active) onActivate();
      }}
    >
      {inPanel && thread.quote && <blockquote class="docs-thread-quote">{thread.quote}</blockquote>}
      {inPanel && gone && <p class="docs-thread-gone">{t("docs.commentNoQuote")}</p>}
      {thread.resolved && (
        <p class="docs-thread-resolved">
          {t("docs.commentResolvedBy", {
            name: thread.resolved.name || t("docs.commentSomeone"),
            when: when(thread.resolved.at),
          })}
        </p>
      )}
      {thread.comments.map((comment, index) => (
        <CommentItem
          key={comment.id}
          thread={thread}
          comment={comment}
          first={index === 0}
          canComment={canComment}
          actions={actions}
          onError={setError}
        />
      ))}
      {error && (
        <p class="error" role="alert">
          {error}
        </p>
      )}
      {canComment && thread.resolved && (
        <button
          type="button"
          class="secondary docs-thread-reopen"
          onClick={(event) => {
            event.stopPropagation();
            setError("");
            actions.resolve(thread.id, false).catch((problem: unknown) => setError(problemText(problem)));
          }}
        >
          {t("docs.commentReopen")}
        </button>
      )}
      {canComment &&
        !thread.resolved &&
        active &&
        (replying ? (
          <CommentBox
            placeholder={t("docs.commentReply")}
            submit={t("docs.commentReplySubmit")}
            onSubmit={(text) => actions.reply(thread.id, text)}
            onCancel={() => setReplying(false)}
          />
        ) : (
          <button
            type="button"
            class="docs-thread-reply"
            onClick={(event) => {
              event.stopPropagation();
              setReplying(true);
            }}
          >
            {t("docs.commentReply")}
          </button>
        ))}
    </article>
  );
}

/** The card for a new thread, with the text it's about selected. */
function DraftCard({
  draft,
  inPanel,
  onSubmit,
  onCancel,
  cardRef,
  style,
}: {
  draft: Draft;
  inPanel: boolean;
  onSubmit: (text: string) => Promise<void>;
  onCancel: () => void;
  cardRef?: (element: HTMLElement | null) => void;
  style?: string;
}) {
  return (
    <article ref={cardRef} class="docs-thread active" style={style} aria-label={t("docs.commentNew")}>
      {inPanel && <blockquote class="docs-thread-quote">{draft.quote}</blockquote>}
      <CommentBox
        placeholder={t("docs.commentPlaceholder")}
        submit={t("docs.commentSubmit")}
        onSubmit={onSubmit}
        onCancel={onCancel}
      />
    </article>
  );
}

/** The cards beside the page, each level with its text, the one being
 * looked at exactly so, and the others moved up or down to make room. */
export function CommentsMargin({
  view,
  canvas,
  page,
  threads,
  draft,
  active,
  canComment,
  actions,
  onActivate,
  onDraftSubmit,
  onDraftCancel,
}: {
  view: EditorView;
  canvas: HTMLElement;
  page: HTMLElement;
  threads: readonly CommentThread[];
  draft: Draft | null;
  active: string | null;
  canComment: boolean;
  actions: ThreadActions;
  onActivate: (thread: string) => void;
  onDraftSubmit: (text: string) => Promise<void>;
  onDraftCancel: () => void;
}) {
  const cards = useRef(new Map<string, HTMLElement>());
  const refs = useRef(new Map<string, (element: HTMLElement | null) => void>());
  const [tops, setTops] = useState<Record<string, number>>({});
  const [left, setLeft] = useState(0);
  // Laying out again whenever the page or a card changes size, such as
  // when pages are laid out after an edit, or a reply box opens.
  const [, setResized] = useState(0);
  const watcher = useRef<ResizeObserver | null>(null);
  useEffect(() => {
    const observer = new ResizeObserver(() => setResized((count) => count + 1));
    observer.observe(page);
    for (const card of cards.current.values()) observer.observe(card);
    watcher.current = observer;
    return () => {
      observer.disconnect();
      watcher.current = null;
    };
  }, [page]);

  const byId = new Map(threads.map((thread) => [thread.id, thread]));
  const placed = commentRanges(view.state).filter(({ id }) => id === DRAFT || byId.has(id));

  useLayoutEffect(() => {
    const box = canvas.getBoundingClientRect();
    const wanted = placed.map(({ id, range }) => {
      let top = 0;
      try {
        top = view.coordsAtPos(range.from).top - box.top;
      } catch {
        // A position the view can't place yet.
      }
      return { id, top, height: cards.current.get(id)?.offsetHeight ?? 0 };
    });
    const focus = draft ? DRAFT : active;
    const fixed = Math.max(
      0,
      wanted.findIndex(({ id }) => id === focus),
    );
    const next: Record<string, number> = {};
    // The card being looked at sits level with its text, those after it
    // go down to make room, and those before it go up.
    if (wanted.length) {
      next[wanted[fixed]!.id] = wanted[fixed]!.top;
      for (let index = fixed + 1; index < wanted.length; index++) {
        const before = wanted[index - 1]!;
        next[wanted[index]!.id] = Math.max(wanted[index]!.top, next[before.id]! + before.height + GAP);
      }
      for (let index = fixed - 1; index >= 0; index--) {
        const after = wanted[index + 1]!;
        next[wanted[index]!.id] = Math.min(wanted[index]!.top, next[after.id]! - wanted[index]!.height - GAP);
      }
      // Cards pushed up past the top of the page come down again, and the
      // rest with them.
      let floor = page.getBoundingClientRect().top - box.top;
      for (const { id, height } of wanted) {
        next[id] = Math.max(next[id]!, floor);
        floor = next[id]! + height + GAP;
      }
    }
    const nextLeft = page.getBoundingClientRect().right - box.left + 16;
    if (nextLeft !== left) setLeft(nextLeft);
    const changed =
      Object.keys(next).length !== Object.keys(tops).length ||
      Object.entries(next).some(([id, top]) => Math.abs((tops[id] ?? -1) - top) > 0.5);
    if (changed) setTops(next);
  });

  // Each card keeps one ref callback, so it's watched once.
  const ref = (id: string) => {
    let callback = refs.current.get(id);
    if (!callback) {
      callback = (element) => {
        const before = cards.current.get(id);
        if (before && before !== element) watcher.current?.unobserve(before);
        if (element) {
          cards.current.set(id, element);
          watcher.current?.observe(element);
        } else {
          cards.current.delete(id);
          refs.current.delete(id);
        }
      };
      refs.current.set(id, callback);
    }
    return callback;
  };
  // Cards are hidden until they're placed, so they never jump into place.
  const style = (id: string) => (tops[id] === undefined ? "visibility:hidden;top:0" : `top:${tops[id]}px`);

  return (
    <div class="docs-comments" style={`left:${left}px`}>
      {placed.map(({ id }) => {
        if (id === DRAFT) {
          return draft ? (
            <DraftCard
              key={DRAFT}
              draft={draft}
              inPanel={false}
              onSubmit={onDraftSubmit}
              onCancel={onDraftCancel}
              cardRef={ref(DRAFT)}
              style={style(DRAFT)}
            />
          ) : null;
        }
        const thread = byId.get(id)!;
        return (
          <ThreadCard
            key={id}
            thread={thread}
            active={id === active}
            canComment={canComment}
            actions={actions}
            onActivate={() => onActivate(id)}
            cardRef={ref(id)}
            style={style(id)}
          />
        );
      })}
    </div>
  );
}

/** The panel at the side listing every thread, open or resolved, in the
 * order of their text. On narrower screens it also holds the new thread's
 * card. */
export function CommentsPanel({
  view,
  threads,
  draft,
  active,
  canComment,
  actions,
  onActivate,
  onDraftSubmit,
  onDraftCancel,
  onClose,
}: {
  view: EditorView;
  threads: readonly CommentThread[];
  draft: Draft | null;
  active: string | null;
  canComment: boolean;
  actions: ThreadActions;
  onActivate: (thread: string) => void;
  onDraftSubmit: (text: string) => Promise<void>;
  onDraftCancel: () => void;
  onClose: () => void;
}) {
  const [showing, setShowing] = useState<"open" | "resolved">(() =>
    threads.find((thread) => thread.id === active)?.resolved ? "resolved" : "open",
  );
  const list = useRef<HTMLDivElement>(null);
  const shown = inTextOrder(
    view.state,
    threads.filter((thread) => (showing === "open" ? !thread.resolved : thread.resolved)),
  );
  // The thread being looked at comes into view in the list.
  useEffect(() => {
    if (!active) return;
    list.current?.querySelector(".docs-thread.active")?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <aside
      class="docs-comments-panel"
      aria-label={t("docs.comments")}
      onKeyDown={(event) => event.key === "Escape" && !draft && onClose()}
    >
      <div class="docs-comments-head">
        <h2>{t("docs.comments")}</h2>
        <button
          type="button"
          class="icon-button"
          title={t("docs.commentsClose")}
          aria-label={t("docs.commentsClose")}
          onClick={onClose}
        >
          <CloseIcon />
        </button>
      </div>
      <div class="docs-comments-tabs" role="tablist">
        {(["open", "resolved"] as const).map((which) => (
          <button
            key={which}
            type="button"
            role="tab"
            class="secondary"
            aria-selected={showing === which}
            onClick={() => setShowing(which)}
          >
            {which === "open" ? t("docs.commentsOpen") : t("docs.commentsResolved")}
          </button>
        ))}
      </div>
      <div class="docs-comments-list" ref={list}>
        {draft && <DraftCard draft={draft} inPanel onSubmit={onDraftSubmit} onCancel={onDraftCancel} />}
        {shown.map((thread) => (
          <ThreadCard
            key={thread.id}
            thread={thread}
            active={thread.id === active}
            canComment={canComment}
            inPanel
            gone={!thread.resolved && rangeOf(view.state, thread.id) === null}
            actions={actions}
            onActivate={() => onActivate(thread.id)}
          />
        ))}
        {!draft && !shown.length && (
          <p class="hint">
            {showing === "open"
              ? canComment
                ? t("docs.commentsNoneCanComment")
                : t("docs.commentsNone")
              : t("docs.commentsNoneResolved")}
          </p>
        )}
      </div>
    </aside>
  );
}

/** Scrolls the text of an open thread into view, under the header. */
export function showThreadText(view: EditorView, thread: string): void {
  const range = rangeOf(view.state, thread);
  if (!range) return;
  try {
    const { node } = view.domAtPos(range.from);
    const element = node instanceof Element ? node : node.parentElement;
    element?.scrollIntoView({ block: "center", behavior: "smooth" });
  } catch {
    // The text isn't drawn yet.
  }
}
