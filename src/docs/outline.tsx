// The document's outline (decision 30, step 3, part 3): its title and
// headings in a panel at the left, as in Google Docs. Selecting one moves
// the caret to it and scrolls it to the top.

import type { Node } from "prosemirror-model";
import { type EditorState, TextSelection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";

import { CloseIcon } from "../drive/icons.tsx";
import { t } from "../i18n.ts";

export interface OutlineEntry {
  /** Where the heading starts in the document. */
  pos: number;
  /** 0 for the title, 1 to 6 for headings. */
  level: number;
  text: string;
}

const outlines = new WeakMap<Node, OutlineEntry[]>();

/** The document's title and headings that have text, in order. Each
 * document's is kept, so it's found again only after the text changes. */
export function outlineOf(doc: Node): OutlineEntry[] {
  const known = outlines.get(doc);
  if (known) return known;
  const entries: OutlineEntry[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    const level =
      node.type.name === "heading"
        ? (node.attrs["level"] as number)
        : node.type.name === "paragraph" && node.attrs["kind"] === "title"
          ? 0
          : null;
    const text = node.textContent.trim();
    if (level !== null && text) entries.push({ pos, level, text });
    return false;
  });
  outlines.set(doc, entries);
  return entries;
}

/** Which entry the caret is under: the last one that starts before it, or
 * -1. */
export function currentEntry(entries: readonly OutlineEntry[], state: EditorState): number {
  const at = state.selection.from;
  return entries.findLastIndex((entry) => entry.pos < at);
}

const KEY = "accordion.docs.outline";

/** Whether this browser shows the outline beside the document. It's shown
 * unless someone closed it, and starts closed on narrow screens, where it
 * covers the page. */
export function readShowOutline(): boolean {
  if (matchMedia("(max-width: 1100px)").matches) return false;
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

export function saveShowOutline(show: boolean) {
  if (matchMedia("(max-width: 1100px)").matches) return;
  try {
    if (show) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, "off");
  } catch {
    // The choice lasts until the page closes.
  }
}

export function Outline({ view, onClose }: { view: EditorView; onClose: () => void }) {
  const state = view.state;
  const entries = outlineOf(state.doc);
  const current = currentEntry(entries, state);
  const go = (entry: OutlineEntry) => {
    view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, entry.pos + 1)));
    view.focus();
    (view.nodeDOM(entry.pos) as HTMLElement | null)?.scrollIntoView({ block: "start" });
    // On a narrow screen the outline covers the page, so it goes.
    if (matchMedia("(max-width: 1100px)").matches) onClose();
  };
  return (
    <nav class="docs-side docs-outline" aria-labelledby="docs-outline-title">
      <div class="docs-outline-inner">
        <div class="docs-outline-head">
          <h2 id="docs-outline-title">{t("docs.outline")}</h2>
          <button
            type="button"
            class="icon-button"
            aria-label={t("docs.outlineClose")}
            title={t("docs.outlineClose")}
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </div>
        {entries.length === 0 ? (
          <p class="hint">{t("docs.outlineEmpty")}</p>
        ) : (
          <ul>
            {entries.map((entry, index) => (
              <li key={entry.pos} class={`level-${entry.level}`}>
                <button type="button" aria-current={index === current ? "location" : undefined} onClick={() => go(entry)}>
                  {entry.text}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </nav>
  );
}
