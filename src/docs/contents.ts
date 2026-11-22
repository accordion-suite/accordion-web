// Tables of contents (decision 30, step 4): the document's headings, listed
// where the table is, as Google Docs' Insert > Table of contents makes one.
//
// A table keeps only its style (schema.ts). Its entries are the headings,
// found again after every change, so it's never out of date and needs no
// Update button, and two people editing at once never write two lists into
// the document. The server finds the same entries when it writes the file
// and the downloads (accordion-docs' `model::contents`). On pages, each
// entry shows its heading's page number, and a long table breaks between
// entries where a page ends (pages.ts).

import type { Node, NodeType } from "prosemirror-model";
import { type Command, Plugin, PluginKey, TextSelection } from "prosemirror-state";
import { Decoration, DecorationSet, type EditorView, type NodeView } from "prosemirror-view";

import { t } from "../i18n.ts";
import { pageSpacer } from "./pages.ts";
import { CONTENTS_STYLES, type ContentsStyle, schema } from "./schema.ts";

const nodes = schema.nodes as Record<string, NodeType>;

/** A heading a table of contents lists. */
export interface ContentsEntry {
  /** Where the heading starts in the document. */
  pos: number;
  /** 1 to 6. */
  level: number;
  text: string;
}

const found = new WeakMap<Node, ContentsEntry[]>();

/** The document's headings that have text, in order, inside lists, quotes,
 * and tables too, as the server finds them. The title and subtitle aren't
 * listed, as in Google Docs. Each document's is kept, so they're found again
 * only after it changes. */
export function contentsOf(doc: Node): ContentsEntry[] {
  const known = found.get(doc);
  if (known) return known;
  const entries: ContentsEntry[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    if (node.type.name === "heading") {
      const text = headingText(node);
      if (text) entries.push({ pos, level: node.attrs["level"] as number, text });
    }
    return false;
  });
  found.set(doc, entries);
  return entries;
}

/** A heading's text on one line, without its footnotes' notes. */
function headingText(node: Node): string {
  let text = "";
  node.forEach((child) => {
    if (child.isText) text += child.text;
    else if (child.type.name === "hard_break") text += " ";
  });
  return text.split(/\s+/u).filter(Boolean).join(" ");
}

/** Whether the document has a table of contents. */
export function hasContents(doc: Node): boolean {
  let has = false;
  doc.forEach((child) => {
    if (child.type.name === "table_of_contents") has = true;
  });
  return has;
}

/** Puts a table of contents in `style` where the caret is, between the
 * document's own blocks: before or after the paragraph the caret is at
 * the start or end of, or splitting it, as Google Docs does, and after the
 * list, quote, or table the caret is in. */
export function insertContents(style: ContentsStyle): Command {
  return (state, dispatch) => {
    const { $from, empty } = state.selection;
    let tr = state.tr;
    let at: number;
    const top = $from.depth >= 1 ? $from.node(1) : null;
    if (empty && top?.isTextblock && $from.depth === 1) {
      if ($from.parentOffset === 0) at = $from.before(1);
      else if ($from.parentOffset === top.content.size) at = $from.after(1);
      else {
        tr = tr.split($from.pos);
        at = $from.pos + 1;
      }
    } else {
      at = $from.depth >= 1 ? $from.after(1) : state.selection.to;
    }
    if (!dispatch) return true;
    const table = nodes["table_of_contents"]!.create({ style });
    tr.insert(at, table);
    const after = at + table.nodeSize;
    // The caret goes on after the table, so there's a line to go on in.
    if (after >= tr.doc.content.size) tr.insert(after, nodes["paragraph"]!.create());
    tr.setSelection(TextSelection.near(tr.doc.resolve(after + 1)));
    dispatch(tr.scrollIntoView());
    return true;
  };
}

/** Changes the style of the table of contents at `pos`. */
export function setContentsStyle(pos: number, style: ContentsStyle): Command {
  return (state, dispatch) => {
    const node = state.doc.nodeAt(pos);
    if (node?.type.name !== "table_of_contents") return false;
    dispatch?.(state.tr.setNodeAttribute(pos, "style", style));
    return true;
  };
}

/** Where a page ends inside a table of contents (pages.ts): before which
 * entry, and the spacer's break and name. Kept in a node decoration's spec
 * as a string, so the table is drawn again only once it changes. */
export function contentsGaps(gaps: readonly { entry: number; index: number; name: string }[]): string {
  return gaps.map((gap) => `${gap.entry}:${gap.index}:${gap.name}`).join("|");
}

function readGaps(decorations: readonly Decoration[]): Map<number, { index: number; name: string }> {
  const gaps = new Map<number, { index: number; name: string }>();
  for (const decoration of decorations) {
    const text = (decoration.spec as { contentsGaps?: string }).contentsGaps;
    if (!text) continue;
    for (const part of text.split("|")) {
      const [entry, index, name] = part.split(":");
      gaps.set(Number(entry), { index: Number(index), name: name! });
    }
  }
  return gaps;
}

const views = new WeakMap<EditorView, Set<ContentsView>>();
/** Each editor's last page numbers, for downloads. */
const numbers = new WeakMap<EditorView, number[] | null>();

/** Shows each entry's page number, in the order of `contentsOf`, or none
 * without pages, as on phones. */
export function showContentsPages(view: EditorView, pages: number[] | null) {
  numbers.set(view, pages);
  for (const each of views.get(view) ?? []) each.setPages(pages);
}

/** The page each entry is on, as the editor lays out the pages, or null
 * without pages. */
export function contentsPages(view: EditorView): number[] | null {
  return numbers.get(view) ?? null;
}

const key = new PluginKey<DecorationSet>("contents");

/** Draws the tables of contents again as headings change, and gives the
 * headings they list an ID, so printed PDFs link each entry to its
 * heading. */
export function contentsPlugin(): Plugin<DecorationSet> {
  const ids = (doc: Node) =>
    hasContents(doc)
      ? DecorationSet.create(
          doc,
          contentsOf(doc).map((entry, index) =>
            Decoration.node(entry.pos, entry.pos + doc.nodeAt(entry.pos)!.nodeSize, { id: headingId(index) }),
          ),
        )
      : DecorationSet.empty;
  return new Plugin<DecorationSet>({
    key,
    state: {
      init: (_config, state) => ids(state.doc),
      apply: (tr, before) => (tr.docChanged ? ids(tr.doc) : before),
    },
    props: { decorations: (state) => key.getState(state) },
    view: () => ({
      update(view, previous) {
        if (view.state.doc !== previous.doc) for (const each of views.get(view) ?? []) each.refresh();
      },
    }),
  });
}

function headingId(index: number): string {
  return `docs-heading-${index + 1}`;
}

const STYLE_LABELS: Record<ContentsStyle, () => string> = {
  plain: () => t("docs.contentsPlain"),
  dotted: () => t("docs.contentsDotted"),
  links: () => t("docs.contentsLinks"),
};

/** The menu entries that insert a table of contents, one for each style. */
export function contentsStyles(): { style: ContentsStyle; label: string }[] {
  return CONTENTS_STYLES.map((style) => ({ style, label: STYLE_LABELS[style]() }));
}

/** A table of contents: a link to each heading, indented by its level,
 * with its page number on pages unless it's blue links. Selecting an
 * entry's text goes to its heading. Selecting the table anywhere else
 * selects it, and an editor then has buttons for its style. */
export class ContentsView implements NodeView {
  dom: HTMLElement;
  private list: HTMLElement;
  private drawn = "";
  private pages: number[] | null;
  private gaps = new Map<number, { index: number; name: string }>();

  constructor(
    private node: Node,
    private view: EditorView,
    private getPos: () => number | undefined,
    decorations: readonly Decoration[],
    editable: boolean,
  ) {
    const document = view.dom.ownerDocument;
    this.dom = document.createElement("nav");
    this.dom.className = "docs-contents";
    this.dom.contentEditable = "false";
    this.dom.setAttribute("aria-label", t("docs.contents"));
    this.list = document.createElement("div");
    this.list.className = "docs-contents-list";
    this.dom.append(this.list);
    if (editable) {
      const bar = document.createElement("span");
      bar.className = "docs-picture-bar docs-contents-bar";
      for (const style of CONTENTS_STYLES) {
        const button = document.createElement("button");
        button.type = "button";
        button.tabIndex = -1;
        button.dataset["style"] = style;
        button.textContent = STYLE_LABELS[style]();
        button.addEventListener("mousedown", (event) => event.preventDefault());
        button.addEventListener("click", (event) => {
          event.preventDefault();
          this.setStyle(style);
        });
        bar.append(button);
      }
      this.dom.append(bar);
    }
    this.list.addEventListener("click", this.go);
    this.pages = contentsPages(view);
    this.gaps = readGaps(decorations);
    let set = views.get(view);
    if (!set) views.set(view, (set = new Set()));
    set.add(this);
    this.draw();
  }

  update(node: Node, decorations: readonly Decoration[]): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.gaps = readGaps(decorations);
    this.draw();
    return true;
  }

  refresh() {
    this.draw();
  }

  setPages(pages: number[] | null) {
    this.pages = pages;
    this.draw();
  }

  private style(): ContentsStyle {
    const style = this.node.attrs["style"] as ContentsStyle;
    return CONTENTS_STYLES.includes(style) ? style : "plain";
  }

  /** Draws the entries, only when something they show changed. */
  private draw() {
    const style = this.style();
    const entries = contentsOf(this.view.state.doc);
    const numbered = style !== "links" && this.pages !== null && this.pages.length === entries.length;
    const state = JSON.stringify([
      style,
      entries.map((entry) => [entry.level, entry.text]),
      numbered ? this.pages : null,
      [...this.gaps],
    ]);
    if (state === this.drawn) return;
    this.drawn = state;
    this.dom.dataset["style"] = style;
    for (const button of this.dom.querySelectorAll<HTMLButtonElement>(".docs-contents-bar button")) {
      button.setAttribute("aria-pressed", String(button.dataset["style"] === style));
    }
    const document = this.dom.ownerDocument;
    const children: HTMLElement[] = [];
    if (!entries.length) {
      const empty = document.createElement("p");
      empty.className = "docs-contents-empty";
      empty.textContent = t("docs.contentsEmpty");
      children.push(empty);
    }
    entries.forEach((entry, index) => {
      const gap = this.gaps.get(index);
      if (gap) children.push(pageSpacer(this.view, gap.index, gap.name));
      const row = document.createElement("div");
      row.className = `docs-contents-entry level-${entry.level}`;
      row.dataset["index"] = String(index);
      const link = document.createElement("a");
      link.className = "docs-contents-text";
      link.href = `#${headingId(index)}`;
      link.textContent = entry.text;
      link.title = t("docs.contentsGo", { heading: entry.text });
      row.append(link);
      // Without pages, as on phones, there's no number to lead to.
      if (numbered) {
        const leader = document.createElement("span");
        leader.className = "docs-contents-leader";
        const page = document.createElement("span");
        page.className = "docs-contents-page";
        page.textContent = String(this.pages![index]);
        row.append(leader, page);
      }
      children.push(row);
    });
    this.list.replaceChildren(...children);
  }

  /** Selecting an entry puts the caret at the start of its heading and
   * scrolls it to the top, as the outline does. */
  private go = (event: MouseEvent) => {
    const row = (event.target as HTMLElement).closest(".docs-contents-text")?.closest<HTMLElement>(".docs-contents-entry");
    if (!row) return;
    event.preventDefault();
    const entry = contentsOf(this.view.state.doc)[Number(row.dataset["index"])];
    if (!entry) return;
    const state = this.view.state;
    this.view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, entry.pos + 1)));
    this.view.focus();
    (this.view.nodeDOM(entry.pos) as HTMLElement | null)?.scrollIntoView({ block: "start" });
  };

  private setStyle(style: ContentsStyle) {
    const pos = this.getPos();
    if (pos === undefined) return;
    setContentsStyle(pos, style)(this.view.state, this.view.dispatch);
  }

  /** Clicks on an entry's text and the buttons are the table's own.
   * Anywhere else selects it, as a picture is selected. */
  stopEvent(event: Event): boolean {
    const target = event.target as HTMLElement | null;
    return !!target?.closest(".docs-contents-text, .docs-contents-bar");
  }

  ignoreMutation(): boolean {
    return true;
  }

  destroy() {
    views.get(this.view)?.delete(this);
  }
}
