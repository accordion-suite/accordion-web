// Pages (decision 30, step 4): the editor shows the document on sheets of
// its paper, broken where printing breaks it, and printing prints those
// same sheets.
//
// The text stays one ProseMirror document. Where a page ends, a spacer
// widget pushes what follows down to the top of the next sheet: a block
// between blocks, or, inside a paragraph, a float as wide as the line, so
// the line before keeps its own alignment. Sheets are drawn behind the
// text, and the margins of each sheet over it, so nothing that crosses a
// page's end, such as a table's borders, shows in the margins. Each pass
// measures where lines fall as though there were no spacers, picks where
// each page ends, and then sizes each spacer to reach the next sheet.

import { DOMSerializer, type Node } from "prosemirror-model";
import { type EditorState, Plugin, PluginKey, type Transaction } from "prosemirror-state";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";

import { type PageSetup, pagePoints } from "./page-setup.ts";
import { schema } from "./schema.ts";
import { styleMarkViews } from "./text-style.ts";

/** CSS pixels to a point. */
const PX = 96 / 72;

/** A sheet and its margins, in CSS pixels. */
export interface Geometry {
  width: number;
  height: number;
  /** Top, right, bottom, and left. */
  margins: [number, number, number, number];
}

/** Makes `element` as wide as the paper, with its margins, or takes the
 * paper away. */
export function showPaper(element: HTMLElement, setup: PageSetup | null) {
  const properties = ["--page-width", "--page-height", "--margin-top", "--margin-right", "--margin-bottom", "--margin-left"];
  if (!setup) {
    properties.forEach((property) => element.style.removeProperty(property));
    return;
  }
  const [width, height] = pagePoints(setup);
  [width, height, ...setup.margins].forEach((points, index) => element.style.setProperty(properties[index]!, `${points}pt`));
}

export function geometryOf(setup: PageSetup): Geometry {
  const [width, height] = pagePoints(setup);
  return {
    width: width * PX,
    height: height * PX,
    margins: setup.margins.map((margin) => margin * PX) as Geometry["margins"],
  };
}

/** Where a spacer goes: a block at a position between blocks, or a float
 * at a position inside a paragraph. */
export interface Anchor {
  kind: "block" | "inline";
  pos: number;
}

/** Where a page starts: one spacer, or one in each cell of a table row. */
export type Break = Anchor[];

export type PartKind = "header" | "footer";

/** The headers and footers, each a document of its own, or null for none. */
export interface PageParts {
  header: Node | null;
  footer: Node | null;
  firstHeader: Node | null;
  firstFooter: Node | null;
  /** Whether the first page shows its own, rather than the others'. */
  differentFirst: boolean;
}

/** A header or footer someone is editing: the element with its editor, and
 * the sheet whose margin shows it. */
export interface PartEditing {
  kind: PartKind;
  sheet: number;
  element: HTMLElement;
}

interface PagesState {
  geometry: Geometry | null;
  parts: PageParts | null;
  editing: PartEditing | null;
  breaks: Break[];
  decorations: DecorationSet;
}

type Meta =
  | { geometry: Geometry | null }
  | { breaks: Break[] }
  | { parts: PageParts | null }
  | { editing: PartEditing | null };

const key = new PluginKey<PagesState>("pages");

/** What each editor's pages keep between passes. */
interface Runtime {
  /** Each spacer's last height, so a spacer drawn again starts there. */
  heights: Map<string, Height>;
  layOut: () => void;
  mount: HTMLElement;
}

/** A spacer's height: what it takes on paper, and how many gaps between
 * sheets it also spans on screen. */
interface Height {
  base: number;
  bands: number;
}

const runtimes = new WeakMap<EditorView, Runtime>();

/** Lays the document out on pages of `geometry`'s paper, or as one long
 * page when it's null, as on phones. */
export function setPageGeometry(view: EditorView, geometry: Geometry | null) {
  const current = key.getState(view.state)?.geometry ?? null;
  if (sameGeometry(current, geometry)) return;
  view.dispatch(view.state.tr.setMeta(key, { geometry } satisfies Meta).setMeta("addToHistory", false));
}

/** Shows `parts` in each sheet's margins. */
export function setPageParts(view: EditorView, parts: PageParts | null) {
  view.dispatch(view.state.tr.setMeta(key, { parts } satisfies Meta).setMeta("addToHistory", false));
}

/** Shows a header's or footer's editor in its sheet's margin, in place of
 * the part, or closes it. */
export function setPartEditing(view: EditorView, editing: PartEditing | null) {
  view.dispatch(view.state.tr.setMeta(key, { editing } satisfies Meta).setMeta("addToHistory", false));
}

function sameGeometry(a: Geometry | null, b: Geometry | null): boolean {
  if (!a || !b) return a === b;
  return a.width === b.width && a.height === b.height && a.margins.every((margin, index) => margin === b.margins[index]);
}

/** The plugin that breaks the document into pages. `mount` is the editor's
 * page, where the sheets and margins are drawn. */
export function pagesPlugin(mount: HTMLElement, onOpenPart?: (kind: PartKind, sheet: number) => void): Plugin<PagesState> {
  return new Plugin<PagesState>({
    key,
    state: {
      init: () => ({ geometry: null, parts: null, editing: null, breaks: [], decorations: DecorationSet.empty }),
      apply(tr: Transaction, before: PagesState, _old: EditorState, state: EditorState): PagesState {
        const meta = tr.getMeta(key) as Meta | undefined;
        if (meta && "geometry" in meta) {
          return meta.geometry ? { ...before, geometry: meta.geometry } : { ...before, geometry: null, breaks: [], decorations: DecorationSet.empty };
        }
        if (meta && "parts" in meta) return { ...before, parts: meta.parts };
        if (meta && "editing" in meta) return { ...before, editing: meta.editing };
        if (meta && "breaks" in meta) {
          return { ...before, breaks: meta.breaks, decorations: decorate(state.doc, meta.breaks) };
        }
        if (!tr.docChanged || !before.breaks.length) return before;
        const breaks = before.breaks.map((anchors) =>
          anchors.map((anchor) => ({ ...anchor, pos: tr.mapping.map(anchor.pos, -1) })),
        );
        return { ...before, breaks, decorations: before.decorations.map(tr.mapping, tr.doc) };
      },
    },
    props: {
      decorations: (state) => key.getState(state)?.decorations,
    },
    view: (view) => new PagesView(view, mount, onOpenPart),
  });
}

function decorate(doc: Node, breaks: readonly Break[]): DecorationSet {
  const decorations: Decoration[] = [];
  breaks.forEach((anchors, index) => {
    anchors.forEach((anchor, cell) => {
      const name = `${index}-${cell}-${anchor.kind}`;
      decorations.push(
        Decoration.widget(anchor.pos, (view) => spacer(view, anchor.kind, index, name), {
          side: -1,
          key: `docs-spacer-${name}`,
          ignoreSelection: true,
        }),
      );
    });
  });
  return DecorationSet.create(doc, decorations);
}

function spacer(view: EditorView, kind: Anchor["kind"], index: number, name: string): HTMLElement {
  const element = view.dom.ownerDocument.createElement(kind === "inline" ? "span" : "div");
  element.className = `docs-spacer ${kind}`;
  element.dataset["break"] = String(index);
  element.dataset["name"] = name;
  setHeight(element, runtimes.get(view)?.heights.get(name) ?? { base: 0, bands: 1 });
  return element;
}

/** Spacers include the gap between sheets on screen, which is nothing on
 * paper, so their height leaves it to the style sheet. */
function setHeight(element: HTMLElement, { base, bands }: Height) {
  element.style.height = `calc(${Math.max(0, base).toFixed(3)}px + ${bands} * var(--docs-band, 0px))`;
}

function band(mount: HTMLElement): number {
  const value = parseFloat(getComputedStyle(mount).getPropertyValue("--docs-band"));
  return Number.isFinite(value) ? value : 0;
}

/** Where each sheet's text starts and ends: how far from its top, and from
 * its bottom, in CSS pixels. */
interface Frame {
  top: (sheet: number) => number;
  bottom: (sheet: number) => number;
}

/** How far headers and footers are from the paper's edge: half an inch, as
 * in Google Docs and Word. */
const PART_FROM = 48;

/** The least room between a header or footer and the text. */
const PART_GAP = 12;

/** Each part's node, by a number, so a sheet redraws a part only when it
 * changes. */
const partIds = new WeakMap<Node, number>();
let nextPartId = 1;
function partId(node: Node | null): number {
  if (!node) return 0;
  let id = partIds.get(node);
  if (!id) {
    id = nextPartId++;
    partIds.set(node, id);
  }
  return id;
}

interface Zone {
  paper: HTMLElement;
  head: HTMLElement;
  foot: HTMLElement;
  gap: HTMLElement;
  /** What each margin shows now, so it's drawn again only on a change. */
  drawn: [string, string];
}

class PagesView {
  private frame = 0;
  private sheets: HTMLElement;
  private margins: HTMLElement;
  /** Borders closed where pages cut table rows. */
  private cuts: HTMLElement;
  private watcher: ResizeObserver;
  private zones: Zone[] = [];
  /** The height of each header and footer: the first page's, then the
   * others'. */
  private measured = { first: [0, 0], other: [0, 0] };

  constructor(
    private view: EditorView,
    private mount: HTMLElement,
    private onOpenPart: ((kind: PartKind, sheet: number) => void) | undefined,
  ) {
    runtimes.set(view, { heights: new Map(), layOut: () => this.layOut(), mount });
    const document = mount.ownerDocument;
    this.sheets = document.createElement("div");
    this.sheets.className = "docs-sheets";
    this.sheets.setAttribute("aria-hidden", "true");
    this.margins = document.createElement("div");
    this.margins.className = "docs-margins";
    this.cuts = document.createElement("div");
    this.cuts.className = "docs-cuts";
    this.cuts.setAttribute("aria-hidden", "true");
    mount.prepend(this.sheets);
    mount.append(this.margins, this.cuts);
    // Fonts and pictures that arrive later move the text, and so does a
    // change of width.
    const window = document.defaultView!;
    this.watcher = new window.ResizeObserver(() => this.schedule());
    this.watcher.observe(view.dom);
    document.fonts.addEventListener("loadingdone", this.schedule);
    view.dom.addEventListener("load", this.schedule, true);
    this.margins.addEventListener("load", this.schedule, true);
    this.margins.addEventListener("dblclick", this.open);
    this.schedule();
  }

  update(view: EditorView, previous: EditorState) {
    this.view = view;
    const now = key.getState(view.state);
    const before = key.getState(previous);
    if (
      view.state.doc !== previous.doc ||
      now?.geometry !== before?.geometry ||
      now?.parts !== before?.parts ||
      now?.editing !== before?.editing
    ) {
      this.schedule();
    }
  }

  schedule = () => {
    if (this.frame) return;
    const window = this.mount.ownerDocument.defaultView!;
    this.frame = window.requestAnimationFrame(() => {
      this.frame = 0;
      this.layOut();
    });
  };

  /** Double-clicking a sheet's top or bottom margin opens its header or
   * footer, as in Google Docs. */
  private open = (event: MouseEvent) => {
    const zone = (event.target as HTMLElement).closest<HTMLElement>(".docs-margin");
    if (!zone || !this.onOpenPart || !this.view.editable) return;
    const sheet = Number(zone.dataset["sheet"]);
    this.onOpenPart(zone.classList.contains("top") ? "header" : "footer", sheet);
  };

  private parts(): PageParts | null {
    return key.getState(this.view.state)?.parts ?? null;
  }

  /** Where each sheet's text goes: inside the margins, or below a header
   * or above a footer that doesn't fit in them. */
  private frameFor(geometry: Geometry): Frame {
    const parts = this.parts();
    const first = parts?.differentFirst ?? false;
    const room = (sheet: number, side: 0 | 1) => {
      const [header, footer] = sheet === 0 && first ? this.measured.first : this.measured.other;
      const height = side === 0 ? header! : footer!;
      const margin = geometry.margins[side === 0 ? 0 : 2];
      return height > 0 ? Math.max(margin, PART_FROM + height + PART_GAP) : margin;
    };
    return { top: (sheet) => room(sheet, 0), bottom: (sheet) => room(sheet, 1) };
  }

  /** Breaks the pages now, as printing does once the fonts are in. */
  layOut() {
    const state = key.getState(this.view.state);
    const geometry = state?.geometry ?? null;
    this.mount.classList.toggle("paged", geometry !== null);
    if (!geometry) {
      this.clear();
      return;
    }
    const frame = this.frameFor(geometry);
    this.mount.style.paddingTop = `${frame.top(0)}px`;
    const breaks = paginate(this.view, geometry, frame);
    if (!sameBreaks(breaks, state!.breaks)) {
      this.view.dispatch(this.view.state.tr.setMeta(key, { breaks } satisfies Meta).setMeta("addToHistory", false));
    }
    const gap = band(this.mount);
    const { count, cuts } = fitSpacers(this.view, this.mount, geometry, gap, frame);
    this.draw(geometry, count, frame);
    drawCuts(this.cuts, this.mount, geometry, gap, frame, cuts);
  }

  private clear() {
    for (const zone of this.zones) zone.paper.remove();
    this.zones = [];
    this.sheets.replaceChildren();
    this.margins.replaceChildren();
    this.cuts.replaceChildren();
    this.mount.style.removeProperty("min-height");
    this.mount.style.removeProperty("padding-top");
  }

  /** Draws `count` sheets, and their margins over the text, with each
   * one's header and footer. */
  private draw(geometry: Geometry, count: number, frame: Frame) {
    const document = this.mount.ownerDocument;
    const { height } = geometry;
    while (this.zones.length > count) {
      const zone = this.zones.pop()!;
      zone.paper.remove();
      zone.head.remove();
      zone.foot.remove();
      zone.gap.remove();
    }
    while (this.zones.length < count) {
      const sheet = this.zones.length;
      const make = (className: string) => {
        const element = document.createElement("div");
        element.className = className;
        element.dataset["sheet"] = String(sheet);
        return element;
      };
      const zone: Zone = {
        paper: make("docs-sheet"),
        head: make("docs-margin top"),
        foot: make("docs-margin bottom"),
        gap: make("docs-sheet-gap"),
        drawn: ["", ""],
      };
      this.sheets.append(zone.paper);
      // The gaps between sheets go first, so the margins are drawn over
      // them.
      this.margins.prepend(zone.gap);
      this.margins.append(zone.head, zone.foot);
      this.zones.push(zone);
    }
    const at = (element: HTMLElement, sheet: number, offset: number, size: string) => {
      element.style.top = `calc(${sheet} * (${height}px + var(--docs-band, 0px)) + ${offset}px)`;
      element.style.height = size;
    };
    const parts = this.parts();
    const editing = key.getState(this.view.state)?.editing ?? null;
    this.mount.classList.toggle("editing-part", editing !== null);
    this.zones.forEach((zone, sheet) => {
      at(zone.paper, sheet, 0, `${height}px`);
      at(zone.head, sheet, 0, `${frame.top(sheet)}px`);
      at(zone.foot, sheet, height - frame.bottom(sheet), `${frame.bottom(sheet)}px`);
      at(zone.gap, sheet, height, "var(--docs-band, 0px)");
      zone.gap.hidden = sheet + 1 >= count;
      (["header", "footer"] as const).forEach((kind, side) => {
        const margin = side === 0 ? zone.head : zone.foot;
        const first = parts?.differentFirst && sheet === 0;
        const node = !parts ? null : kind === "header" ? (first ? parts.firstHeader : parts.header) : first ? parts.firstFooter : parts.footer;
        const open = editing?.kind === kind && editing.sheet === sheet;
        margin.classList.toggle("editing", open);
        margin.style.setProperty("--docs-part-left", `${geometry.margins[3]}px`);
        margin.style.setProperty("--docs-part-right", `${geometry.margins[1]}px`);
        if (open) {
          if (editing.element.parentNode !== margin) {
            margin.replaceChildren(editing.element);
            zone.drawn[side] = "editing";
          }
          return;
        }
        const drawn = `${partId(node)}:${sheet + 1}:${count}`;
        if (zone.drawn[side] === drawn) return;
        zone.drawn[side] = drawn;
        margin.replaceChildren(...(node ? [renderPart(document, node, sheet + 1, count)] : []));
      });
    });
    this.mount.style.minHeight = `calc(${count} * (${height}px + var(--docs-band, 0px)) - var(--docs-band, 0px))`;
    // A header or footer that grew or shrank moves the text.
    const size = (zone: Zone | undefined, side: 0 | 1) => {
      const content = (side === 0 ? zone?.head : zone?.foot)?.querySelector<HTMLElement>(".docs-part");
      return content ? content.offsetHeight : 0;
    };
    const measured = {
      first: [size(this.zones[0], 0), size(this.zones[0], 1)],
      other: this.zones.length > 1 ? [size(this.zones[1], 0), size(this.zones[1], 1)] : parts?.differentFirst ? this.measured.other : [size(this.zones[0], 0), size(this.zones[0], 1)],
    };
    const moved = [...measured.first, ...measured.other].some(
      (value, index) => Math.abs(value - [...this.measured.first, ...this.measured.other][index]!) > 0.5,
    );
    if (moved) {
      this.measured = measured;
      this.schedule();
    }
  }

  destroy() {
    const window = this.mount.ownerDocument.defaultView;
    if (this.frame) window?.cancelAnimationFrame(this.frame);
    this.watcher.disconnect();
    this.mount.ownerDocument.fonts.removeEventListener("loadingdone", this.schedule);
    this.view.dom.removeEventListener("load", this.schedule, true);
    this.clear();
    this.sheets.remove();
    this.margins.remove();
    this.cuts.remove();
    this.mount.classList.remove("paged", "editing-part");
  }
}

/** A header or footer as it shows on page `number` of `count`. */
function renderPart(document: Document, node: Node, number: number, count: number): HTMLElement {
  const element = document.createElement("div");
  element.className = "docs-text docs-part";
  element.append(partSerializer().serializeFragment(node.content, { document }));
  for (const field of element.querySelectorAll<HTMLElement>("[data-field]")) {
    field.textContent = String(field.dataset["field"] === "pages" ? count : number);
  }
  return element;
}

let serializer: DOMSerializer | null = null;

/** The schema's own HTML, with styles set as style properties, which the
 * page's security policy allows where style attributes aren't. */
function partSerializer(): DOMSerializer {
  if (serializer) return serializer;
  const base = DOMSerializer.fromSchema(schema);
  const marks = { ...base.marks };
  for (const [name, view] of Object.entries(styleMarkViews)) {
    marks[name] = (mark) => {
      const { dom } = view(mark, null as unknown as EditorView, true) as { dom: HTMLElement };
      return { dom };
    };
  }
  serializer = new DOMSerializer(base.nodes, marks);
  return serializer;
}

/** The sheet that shows the document's position `pos`. */
export function sheetAt(view: EditorView, pos: number): number {
  const geometry = key.getState(view.state)?.geometry;
  const runtime = runtimes.get(view);
  if (!geometry || !runtime) return 0;
  const top = view.coordsAtPos(pos).top - runtime.mount.getBoundingClientRect().top;
  return Math.max(0, Math.floor(top / (geometry.height + band(runtime.mount))));
}

/** Lays out `view`'s pages at once, as printing needs before it starts. */
export function layOutNow(view: EditorView) {
  runtimes.get(view)?.layOut();
}

function sameBreaks(a: readonly Break[], b: readonly Break[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (anchors, index) =>
        anchors.length === b[index]!.length &&
        anchors.every((anchor, cell) => anchor.kind === b[index]![cell]!.kind && anchor.pos === b[index]![cell]!.pos),
    )
  );
}

/** A spacer on screen, and the table cell it's in, if any. */
interface SpacerMark {
  top: number;
  height: number;
  cell: HTMLElement | null;
}

function spacerMarks(root: HTMLElement): SpacerMark[] {
  return [...root.querySelectorAll<HTMLElement>(".docs-spacer")].map((element) => {
    const rect = element.getBoundingClientRect();
    return { top: rect.top, height: rect.height, cell: cellOf(element) };
  });
}

/** The table cell `element` is in, or null for the document's own flow. */
function cellOf(element: HTMLElement): HTMLElement | null {
  return element.closest<HTMLElement>("td, th");
}

/** Something in a cell that a page can't break: a line, a picture, or a
 * table of its own. */
interface CellUnit {
  top: number;
  bottom: number;
  anchor: Anchor;
}

/** A row's cell, as pages break it. */
interface CellFlow {
  dom: HTMLElement;
  units: CellUnit[];
  /** Room above its text on a page it continues on, as at its top, and
   * below it on a page it goes on from. */
  padding: number;
  paddingBottom: number;
  /** Where its text ends, on screen and without spacers. */
  screenBottom: number;
  bottom: number;
}

const CONTAINERS = new Set(["blockquote", "bullet_list", "ordered_list", "check_list", "list_item", "check_item"]);

/** Where each page after the first starts, measuring the text as though no
 * spacers pushed it down. */
function paginate(view: EditorView, geometry: Geometry, frame: Frame): Break[] {
  const doc = view.state.doc;
  const marks = spacerMarks(view.dom);
  const origin = view.dom.getBoundingClientRect().top;
  /** How far each row with spacers in its cells pushed what follows it. */
  const rowShifts: { bottom: number; shift: number }[] = [];
  /** A place on screen, as it would be without the spacers above it. */
  const free = (y: number) => {
    let at = y - origin;
    for (const mark of marks) if (!mark.cell && mark.top < y - 0.5) at -= mark.height;
    for (const row of rowShifts) if (row.bottom <= y + 0.5) at -= row.shift;
    return at;
  };
  /** The same, inside a cell of a row that starts at `rowTop`: each cell's
   * text flows on its own, pushed down by its own spacers. */
  const freeIn = (cell: HTMLElement, rowScreenTop: number, rowTop: number) => (y: number) => {
    let at = rowTop + (y - rowScreenTop);
    for (const mark of marks) if (mark.cell === cell && mark.top < y - 0.5) at -= mark.height;
    return at;
  };
  const room = (page: number) => geometry.height - frame.top(page) - frame.bottom(page);

  const breaks: Break[] = [];
  let limit = room(0);
  let placed = false;
  let forced = false;
  // A heading at the end of a page goes to the next with the text after it.
  let heading: { anchors: Break; top: number; first: boolean } | null = null;

  const newPage = (anchors: Break, top: number) => {
    if (heading && !heading.first && !forced) {
      anchors = heading.anchors;
      top = heading.top;
    }
    heading = null;
    forced = false;
    breaks.push(anchors);
    limit = top + room(breaks.length);
    placed = false;
  };

  /** Something that can't be broken. It goes on the page if it fits, or
   * if it's the first thing on the page, and starts the next otherwise. */
  const unit = (bottom: number, start: () => { anchors: Break; top: number }) => {
    if (forced || (placed && bottom > limit + 0.5)) {
      const { anchors, top } = start();
      newPage(anchors, top);
    }
    placed = true;
  };

  const visit = (node: Node, pos: number) => {
    const name = node.type.name;
    if (name === "page_break") {
      forced = true;
      heading = null;
      return;
    }
    const dom = view.nodeDOM(pos);
    if (!dom || dom.nodeType !== 1) return;
    const element = dom as HTMLElement;
    const rect = element.getBoundingClientRect();
    const top = free(rect.top) - marginTop(element);
    const bottom = free(rect.bottom);
    if (!forced && bottom <= limit + 0.5) {
      heading = isHeading(node) ? { anchors: [hoist(doc, pos)], top, first: !placed } : null;
      placed = true;
      return;
    }
    if (node.isTextblock) {
      const lines = textLines(element, free);
      lines.forEach((line, index) => {
        unit(line.bottom, () =>
          index === 0 ? { anchors: [hoist(doc, pos)], top } : { anchors: [{ kind: "inline", pos: lineStart(view, line) }], top: line.top },
        );
      });
      heading = null;
      return;
    }
    if (name === "table") {
      node.forEach((row, offset, index) => {
        const rowPos = pos + 1 + offset;
        const rowDom = view.nodeDOM(rowPos);
        if (!rowDom || rowDom.nodeType !== 1) return;
        visitRow(row, rowPos, rowDom as HTMLElement, index === 0 ? { anchors: [hoist(doc, pos)], top } : null);
      });
      heading = null;
      return;
    }
    if (CONTAINERS.has(name)) {
      node.forEach((child, offset) => visit(child, pos + 1 + offset));
      return;
    }
    unit(bottom, () => ({ anchors: [hoist(doc, pos)], top }));
    heading = null;
  };

  /** A table row breaks between the lines of its cells, as Word and Google
   * Docs break rows by default. Each cell's text goes on where it left off,
   * at the top of the next page. A row whose first lines don't fit starts
   * the next page whole; the table's first row takes the table with it. */
  const visitRow = (row: Node, rowPos: number, rowDom: HTMLElement, tableStart: { anchors: Break; top: number } | null) => {
    const rect = rowDom.getBoundingClientRect();
    const rowTop = free(rect.top);
    const cellDoms: { cell: Node; pos: number; dom: HTMLElement }[] = [];
    row.forEach((cell, offset) => {
      const pos = rowPos + 1 + offset;
      const dom = view.nodeDOM(pos);
      // A cell over more than one row stays whole, with its first row.
      if (!dom || dom.nodeType !== 1 || ((cell.attrs["rowspan"] as number | undefined) ?? 1) > 1) return;
      cellDoms.push({ cell, pos, dom: dom as HTMLElement });
    });
    const spaced = marks.some((mark) => mark.cell && cellDoms.some(({ dom }) => dom === mark.cell));
    // Most rows fit, and measuring their lines would only take time.
    if (!spaced && !forced && free(rect.bottom) <= limit + 0.5) {
      heading = null;
      placed = true;
      return;
    }
    const flows = cellDoms.map(({ cell, pos, dom }) => cellFlow(view, cell, pos, dom, freeIn(dom, rect.top, rowTop)));
    // The room under the cells' text, their padding and border.
    const under = flows.length ? rect.bottom - Math.max(...flows.map((flow) => flow.screenBottom)) : 0;
    const rowBottom = spaced && flows.length ? Math.max(...flows.map((flow) => flow.bottom)) + under : free(rect.bottom);
    const done = () => {
      if (spaced) rowShifts.push({ bottom: rect.bottom, shift: free(rect.bottom) - rowBottom });
      placed = true;
    };
    if (!forced && rowBottom <= limit + 0.5) {
      heading = null;
      done();
      return;
    }
    const cells = flows.filter((flow) => flow.units.length);
    if (!cells.length) {
      unit(rowBottom, () => tableStart ?? rowStart(view, row, rowPos, free));
      heading = null;
      done();
      return;
    }
    const startPage = breaks.length;
    /** Where the page each cell is on starts, as the cell sees it, and
     * which page that is. */
    const origins = cells.map(() => limit - room(startPage));
    const pages = cells.map(() => startPage);
    const firstBottom = Math.max(...cells.map((flow) => flow.units[0]!.bottom + flow.paddingBottom));
    if (forced || (placed && firstBottom > limit + 0.5)) {
      const starts = cells.map((flow) => (tableStart ? tableStart.top : flow.units[0]!.top - flow.padding));
      if (tableStart) newPage(tableStart.anchors, tableStart.top);
      else newPage(cells.map((flow) => flow.units[0]!.anchor), Math.min(...starts));
      // A heading kept with the table moves the page's start up to it.
      const shift = limit - room(breaks.length) - Math.min(...starts);
      starts.forEach((start, index) => {
        origins[index] = start + Math.min(0, shift);
        pages[index] = breaks.length;
      });
    }
    heading = null;
    placed = true;
    const next = cells.map(() => 1);
    for (;;) {
      const page = breaks.length;
      const cuts = cells.map((flow, index) => {
        for (let at = next[index]!; at < flow.units.length; at++) {
          if (flow.units[at]!.bottom + flow.paddingBottom > origins[index]! + room(page) + 0.5) return at;
        }
        return -1;
      });
      if (cuts.every((cut) => cut < 0)) break;
      const moved = cells.flatMap((flow, index) => (cuts[index]! < 0 ? [] : [{ flow, unit: flow.units[cuts[index]!]! }]));
      newPage(
        moved.map(({ unit }) => unit.anchor),
        Math.min(...moved.map(({ flow, unit }) => unit.top - flow.padding)),
      );
      cells.forEach((flow, index) => {
        const cut = cuts[index]!;
        next[index] = cut < 0 ? flow.units.length : cut + 1;
        if (cut < 0) return;
        origins[index] = flow.units[cut]!.top - flow.padding;
        pages[index] = breaks.length;
      });
    }
    // What follows the row goes on under the cells' text on its last page.
    const last = breaks.length;
    if (last > startPage) {
      const ends = cells.flatMap((flow, index) => (pages[index] === last ? [flow.bottom + under - origins[index]!] : []));
      limit = rowBottom - Math.max(...ends) + room(last);
    }
    done();
  };

  doc.forEach((child, offset) => visit(child, offset));
  // A page break at the end starts an empty page.
  if (forced) newPage([{ kind: "block", pos: doc.content.size }], free(view.dom.getBoundingClientRect().bottom));
  return breaks;
}

function isHeading(node: Node): boolean {
  return node.type.name === "heading" || (node.type.name === "paragraph" && (node.attrs["kind"] === "title" || node.attrs["kind"] === "subtitle"));
}

function marginTop(element: HTMLElement): number {
  return parseFloat(getComputedStyle(element).marginTop) || 0;
}

/** A spacer before the block at `pos`, moved out of each list, item, or
 * quote it starts, so the whole of it moves to the next page, its bullet or
 * checkbox too. */
function hoist(doc: Node, pos: number): Anchor {
  const $pos = doc.resolve(pos);
  let at = pos;
  for (let depth = $pos.depth; depth > 0; depth--) {
    if ($pos.index(depth) !== 0 || !CONTAINERS.has($pos.node(depth).type.name)) break;
    at = $pos.before(depth);
  }
  return { kind: "block", pos: at };
}

/** What a page can break between in a table cell: each line of its text,
 * and each picture or table of its own whole. `free` measures inside the
 * cell as though no spacers pushed its text down. */
function cellFlow(view: EditorView, cell: Node, cellPos: number, dom: HTMLElement, free: (y: number) => number): CellFlow {
  const doc = view.state.doc;
  const units: CellUnit[] = [];
  const style = getComputedStyle(dom);
  const padding = parseFloat(style.paddingTop) || 0;
  let screenBottom = dom.getBoundingClientRect().top + (parseFloat(style.borderTopWidth) || 0) + padding;
  const visit = (node: Node, pos: number) => {
    const element = view.nodeDOM(pos);
    if (!element || element.nodeType !== 1) return;
    const box = element as HTMLElement;
    if (CONTAINERS.has(node.type.name) && !node.isTextblock) {
      node.forEach((child, offset) => visit(child, pos + 1 + offset));
      return;
    }
    const rect = box.getBoundingClientRect();
    screenBottom = Math.max(screenBottom, rect.bottom + (parseFloat(getComputedStyle(box).marginBottom) || 0));
    // The cell's first paragraph moves with a spacer inside it, as a row's
    // does when it starts a page. A list moves whole, with its bullets.
    const hoisted = hoist(doc, pos);
    const inside = units.length === 0 && node.isTextblock && hoisted.pos === pos;
    const start: Anchor = inside ? { kind: "inline", pos: pos + 1 } : hoisted;
    const top = inside ? null : free(rect.top) - marginTop(box);
    if (!node.isTextblock) {
      units.push({ top: top!, bottom: free(rect.bottom), anchor: start });
      return;
    }
    textLines(box, free).forEach((line, index) => {
      units.push({
        top: index === 0 ? (top ?? line.top) : line.top,
        bottom: line.bottom,
        anchor: index === 0 ? start : { kind: "inline", pos: lineStart(view, line) },
      });
    });
  };
  cell.forEach((child, offset) => visit(child, cellPos + 1 + offset));
  const paddingBottom = parseFloat(style.paddingBottom) || 0;
  return { dom, units, padding, paddingBottom, screenBottom, bottom: free(screenBottom) };
}

/** A row after a table's first starts a page with a spacer at the start of
 * each cell. */
function rowStart(view: EditorView, row: Node, rowPos: number, free: (y: number) => number): { anchors: Break; top: number } {
  const anchors: Break = [];
  let top = Infinity;
  row.forEach((cell, offset) => {
    const cellPos = rowPos + 1 + offset;
    let first: number | null = null;
    cell.descendants((child, at) => {
      if (first !== null) return false;
      if (child.isTextblock) {
        first = cellPos + 1 + at;
        return false;
      }
      return true;
    });
    if (first === null) return;
    anchors.push({ kind: "inline", pos: first + 1 });
    const dom = view.nodeDOM(first);
    if (dom && dom.nodeType === 1) top = Math.min(top, free((dom as HTMLElement).getBoundingClientRect().top));
  });
  if (top === Infinity) {
    const dom = view.nodeDOM(rowPos) as HTMLElement | null;
    top = dom ? free(dom.getBoundingClientRect().top) : 0;
  }
  return { anchors, top };
}

interface Line {
  top: number;
  bottom: number;
  /** Where the line starts: a text node, or a line break. */
  node: globalThis.Node;
  /** The top of its text on screen. */
  screenTop: number;
}

/** The lines of a paragraph, heading, or code block, in order, each from
 * halfway to the line above to halfway to the line below. */
function textLines(element: HTMLElement, free: (y: number) => number): Line[] {
  const document = element.ownerDocument;
  const range = document.createRange();
  const raw: { top: number; bottom: number; node: globalThis.Node }[] = [];
  const add = (rect: DOMRect, node: globalThis.Node) => {
    if (rect.height <= 0) return;
    const last = raw[raw.length - 1];
    const overlap = last ? Math.min(last.bottom, rect.bottom) - Math.max(last.top, rect.top) : 0;
    if (last && overlap > Math.min(last.bottom - last.top, rect.height) / 2) {
      last.top = Math.min(last.top, rect.top);
      last.bottom = Math.max(last.bottom, rect.bottom);
    } else raw.push({ top: rect.top, bottom: rect.bottom, node });
  };
  const walker = document.createTreeWalker(element, 5 /* elements and text */, {
    acceptNode(node) {
      if (node.nodeType === 1) {
        const child = node as HTMLElement;
        // Spacers, others' carets, and widgets aren't the text.
        const skip = child.classList.contains("docs-spacer") || child.classList.contains("docs-caret") || child.contentEditable === "false";
        if (skip) return 2; // rejected, with what's in it
        return 1;
      }
      return 1;
    },
  });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === 3) {
      if (!node.nodeValue) continue;
      range.selectNodeContents(node);
      for (const rect of range.getClientRects()) add(rect, node);
    } else if ((node as Element).tagName === "BR") {
      add((node as Element).getBoundingClientRect(), node);
    }
  }
  const box = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  const contentTop = free(box.top + (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.paddingTop) || 0));
  const contentBottom = free(box.bottom - (parseFloat(style.borderBottomWidth) || 0) - (parseFloat(style.paddingBottom) || 0));
  if (!raw.length) return [{ top: contentTop, bottom: contentBottom, node: element, screenTop: box.top }];
  const lines = raw.map((line) => ({ top: free(line.top), bottom: free(line.bottom), node: line.node, screenTop: line.top }));
  return lines.map((line, index) => ({
    ...line,
    top: index === 0 ? Math.min(contentTop, line.top) : (lines[index - 1]!.bottom + line.top) / 2,
    bottom: index === lines.length - 1 ? Math.max(contentBottom, line.bottom) : (line.bottom + lines[index + 1]!.top) / 2,
  }));
}

/** The document position where `line` starts. */
function lineStart(view: EditorView, line: Line): number {
  const node = line.node;
  if (node.nodeType !== 3) {
    const parent = node.parentNode!;
    return view.posAtDOM(parent, Array.prototype.indexOf.call(parent.childNodes, node) as number);
  }
  // The first character on the line: characters' tops only grow along the
  // text, so a binary search finds it.
  const text = node.nodeValue ?? "";
  const range = node.ownerDocument!.createRange();
  const topOf = (offset: number) => {
    range.setStart(node, offset);
    range.setEnd(node, offset + 1);
    const rects = range.getClientRects();
    return rects.length ? rects[rects.length - 1]!.top : -Infinity;
  };
  let low = 0;
  let high = text.length - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (topOf(middle) >= line.screenTop - 1) high = middle;
    else low = middle + 1;
  }
  return view.posAtDOM(node, low);
}

/** Where a page break cuts a table row: the row, and the sheet its cells
 * go on to. */
interface RowCut {
  row: HTMLElement;
  sheet: number;
}

/** Sizes each spacer to reach the top of the next sheet's text, and
 * returns how many sheets the document takes, and where it cuts rows. */
function fitSpacers(
  view: EditorView,
  mount: HTMLElement,
  geometry: Geometry,
  gap: number,
  frame: Frame,
): { count: number; cuts: RowCut[] } {
  const runtime = runtimes.get(view);
  const stride = geometry.height + gap;
  const pageTop = mount.getBoundingClientRect().top;
  const byBreak = new Map<number, HTMLElement[]>();
  for (const element of view.dom.querySelectorAll<HTMLElement>(".docs-spacer")) {
    const index = Number(element.dataset["break"]);
    const list = byBreak.get(index);
    if (list) list.push(element);
    else byBreak.set(index, [element]);
  }
  const ordered = [...byBreak.entries()].sort((a, b) => a[0] - b[0]);
  let rects = new Map<HTMLElement, DOMRect>();
  const measureAll = () => {
    rects = new Map();
    for (const [, elements] of ordered) for (const element of elements) rects.set(element, element.getBoundingClientRect());
  };
  measureAll();
  // How far what follows has moved since the measuring.
  let shift = 0;
  let stale = false;
  let sheet = 0;
  const cuts: RowCut[] = [];
  for (const [, elements] of ordered) {
    if (stale) {
      measureAll();
      shift = 0;
      stale = false;
    }
    const top = Math.min(...elements.map((element) => rects.get(element)!.top)) + shift - pageTop;
    const previous = sheet;
    sheet++;
    // Something taller than a page pushes what follows past a whole sheet.
    while (sheet * stride + frame.top(sheet) - top < 0) sheet++;
    const bands = sheet - previous;
    let row: HTMLElement | null = null;
    for (const element of elements) {
      const rect = rects.get(element)!;
      // A cell's text goes on under its padding, as at the cell's top.
      const cell = cellOf(element);
      const padding = cell ? parseFloat(getComputedStyle(cell).paddingTop) || 0 : 0;
      row ??= cell?.parentElement ?? null;
      const height = Math.max(0, sheet * stride + frame.top(sheet) + padding - (rect.top + shift - pageTop));
      const fitted = { base: height - bands * gap, bands };
      if (Math.abs(height - rect.height) > 0.01) setHeight(element, fitted);
      runtime?.heights.set(element.dataset["name"] ?? "", fitted);
      if (elements.length === 1 && !cell) shift += height - rect.height;
    }
    // Spacers in cells move what follows by as much as the row grows,
    // which only measuring again tells.
    if (row) {
      cuts.push({ row, sheet });
      stale = true;
    } else if (elements.length > 1) stale = true;
  }
  const bottom = view.dom.getBoundingClientRect().bottom - pageTop;
  return { count: Math.max(sheet + 1, Math.floor(Math.max(0, bottom - 1) / stride) + 1), cuts };
}

/** Closes a table's borders where a page cuts a row, as Word and Google
 * Docs do: the row's cells end under the last of their text on the page,
 * with their bottom borders, and go on at the next page's top with their
 * top borders. Drawn over the text, in `layer`, in `mount`'s coordinates. */
function drawCuts(layer: HTMLElement, mount: HTMLElement, geometry: Geometry, gap: number, frame: Frame, cuts: RowCut[]) {
  const document = layer.ownerDocument;
  const pageTop = mount.getBoundingClientRect().top;
  const pageLeft = mount.getBoundingClientRect().left;
  const stride = geometry.height + gap;
  const pieces: HTMLElement[] = [];
  const box = (className: string, left: number, top: number, width: number, height: number) => {
    const element = document.createElement("div");
    element.className = className;
    element.style.left = `${left - pageLeft}px`;
    element.style.top = `${top}px`;
    element.style.width = `${width}px`;
    element.style.height = `${height}px`;
    pieces.push(element);
    return element;
  };
  const line = (cell: HTMLElement, side: "Top" | "Bottom", y: number) => {
    const style = getComputedStyle(cell);
    const width = parseFloat(style.getPropertyValue(`border-${side.toLowerCase()}-width`)) || 0;
    const kind = style.getPropertyValue(`border-${side.toLowerCase()}-style`);
    if (width <= 0 || kind === "none" || kind === "hidden") return;
    const rect = cell.getBoundingClientRect();
    const element = box("docs-cut-line", rect.left, y - width / 2, rect.width, 0);
    element.style.borderTop = `${width}px ${kind} ${style.getPropertyValue(`border-${side.toLowerCase()}-color`)}`;
  };
  for (const { row, sheet } of cuts) {
    const cells = [...row.children].filter((child): child is HTMLElement => child.tagName === "TD" || child.tagName === "TH");
    if (!cells.length) continue;
    const before = sheet - 1;
    const textBottom = before * stride + geometry.height - frame.bottom(before);
    const textTop = sheet * stride + frame.top(sheet);
    // Where each cell's text on the page before ends: at its spacer, or at
    // its end when it ended there.
    let empty = true;
    let end = -Infinity;
    for (const cell of cells) {
      const style = getComputedStyle(cell);
      const rect = cell.getBoundingClientRect();
      const contentTop = rect.top + (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.paddingTop) || 0);
      const spacer = [...cell.querySelectorAll<HTMLElement>(".docs-spacer")].find(
        (element) => element.getBoundingClientRect().bottom - pageTop >= textTop - 1,
      );
      let bottom = contentTop;
      if (spacer) bottom = spacer.getBoundingClientRect().top;
      else {
        for (const child of cell.children) {
          if (child.classList.contains("docs-spacer")) continue;
          const margin = parseFloat(getComputedStyle(child).marginBottom) || 0;
          bottom = Math.max(bottom, child.getBoundingClientRect().bottom + margin);
        }
      }
      if (bottom - pageTop >= textTop - 1) continue;
      if (bottom > contentTop + 0.5) empty = false;
      end = Math.max(end, bottom + (parseFloat(style.paddingBottom) || 0) - pageTop);
    }
    const rowRect = row.getBoundingClientRect();
    const left = Math.min(...cells.map((cell) => cell.getBoundingClientRect().left)) - 4;
    const right = Math.max(...cells.map((cell) => cell.getBoundingClientRect().right)) + 4;
    // A row that starts the next page leaves nothing of itself behind but
    // the border it shares with the row above.
    const cutAt = Math.min(textBottom, empty ? rowRect.top - pageTop + 1 : end);
    if (cutAt < textBottom) box("docs-cut", left, cutAt + (empty ? 0 : 1), right - left, textBottom - cutAt);
    if (!empty) for (const cell of cells) line(cell, "Bottom", cutAt);
    for (const cell of cells) line(cell, "Top", textTop);
  }
  layer.replaceChildren(...pieces);
}
