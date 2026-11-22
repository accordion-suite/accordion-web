// Table cells' borders and padding, rows' least heights, and lines'
// thickness and color, as Google Docs and Word copy them. The server reads
// the same from files (accordion-docs' `src/html.rs`), and keeps them as
// these attributes, in points (`src/yjs.rs`).

import { type Attrs, Fragment, type Node, Slice } from "prosemirror-model";

import { lengthFromCss, twentieths } from "./layout.ts";
import { colorFromCss, declared } from "./schema.ts";

/** A cell's border attributes, top, right, bottom, and left. Null is the
 * usual thin gray line, and zero is none. */
export const BORDER_ATTRS = ["border_top", "border_right", "border_bottom", "border_left"] as const;

const SIDES = ["top", "right", "bottom", "left"] as const;

/** The thickest line or border kept, as the server keeps it. */
const MAX_LINE = 12;

/** The style words a border can have. Docs draws each as a solid line. */
const BORDER_STYLES = new Set(["solid", "dashed", "dotted", "double", "groove", "ridge", "inset", "outset"]);

/** A border's thickness in points and its color, from CSS such as
 * `solid #000000 1pt`, as Google Docs writes it, `1.0pt solid windowtext`,
 * as Word does, or `none`. A style with no thickness is CSS's medium, 3
 * pixels. */
export function borderFromCss(value: string): { width: number | null; color: string | null } {
  let width: number | null = null;
  let color: string | null = null;
  let styled = false;
  for (const word of value.trim().toLowerCase().split(/\s+/)) {
    if (word === "none" || word === "hidden") return { width: 0, color: null };
    if (BORDER_STYLES.has(word)) styled = true;
    else if (word === "thin") width = 0.75;
    else if (word === "medium") width = 2.25;
    else if (word === "thick") width = 3.75;
    else if (word === "windowtext") color = "#000000";
    else {
      const length = lengthFromCss(word);
      if (length !== null) width = Math.max(0, length);
      else color = colorFromCss(word) ?? color;
    }
  }
  if (width === null && styled) width = 2.25;
  return { width: width === null ? null : twentieths(Math.min(width, MAX_LINE)), color };
}

/** Each declaration in an element's style, in order. */
function declarations(dom: HTMLElement): [string, string][] {
  const found: [string, string][] = [];
  for (const declaration of (dom.getAttribute("data-style") ?? dom.getAttribute("style") ?? "").split(";")) {
    const colon = declaration.indexOf(":");
    if (colon < 0) continue;
    found.push([
      declaration.slice(0, colon).trim().toLowerCase(),
      declaration
        .slice(colon + 1)
        .replace(/!important\s*$/i, "")
        .trim(),
    ]);
  }
  return found;
}

/** A CSS shorthand's four sides, top, right, bottom, and left. */
function fourSides(value: string): string[] {
  const parts = value.trim().split(/\s+/);
  switch (parts.length) {
    case 1:
      return [parts[0]!, parts[0]!, parts[0]!, parts[0]!];
    case 2:
      return [parts[0]!, parts[1]!, parts[0]!, parts[1]!];
    case 3:
      return [parts[0]!, parts[1]!, parts[2]!, parts[1]!];
    case 4:
      return parts;
    default:
      return [];
  }
}

/** Whether a table is one Google Docs or Word laid out without lines,
 * which names its cells' borders only where they have one. */
function isLineless(table: HTMLElement | null): boolean {
  if (!table) return false;
  if (table.getAttribute("border")?.trim() === "0") return true;
  return declarations(table).some(([name, value]) => name === "border" && borderFromCss(value).width === 0);
}

/** A pasted cell's borders, their color, and its padding. A cell that names
 * any border has none on the sides it leaves out, as CSS draws it; one that
 * names none has the usual lines, or none in a table without lines. As
 * accordion-docs' `cell_box` reads them. */
export function cellBoxFromDom(dom: HTMLElement): Attrs {
  const borders: (number | null)[] = [null, null, null, null];
  const colors: (string | null)[] = [null, null, null, null];
  const padding: (number | null)[] = [null, null, null, null];
  let named = false;
  const side = (name: string) => SIDES.indexOf(name as (typeof SIDES)[number]);
  for (const [name, value] of declarations(dom)) {
    const part = /^(border|padding)(?:-(top|right|bottom|left))?(?:-(width|style|color))?$/.exec(name);
    if (!part) continue;
    const [, kind, at, detail] = part;
    const sides = at ? [side(at)] : [0, 1, 2, 3];
    const values = at ? sides.map(() => value) : detail || kind === "padding" ? fourSides(value) : sides.map(() => value);
    sides.forEach((index, offset) => {
      const text = values[offset];
      if (text === undefined) return;
      if (kind === "padding") {
        if (detail) return;
        const length = lengthFromCss(text);
        if (length !== null) padding[index] = twentieths(Math.max(0, length));
        return;
      }
      if (detail === "color") {
        colors[index] = borderFromCss(text).color ?? colors[index]!;
        return;
      }
      named = true;
      if (detail === "style") {
        const word = text.trim().toLowerCase();
        if (word === "none" || word === "hidden") borders[index] = 0;
        else if (borders[index] === null) borders[index] = 2.25;
        return;
      }
      const border = borderFromCss(text);
      if (detail === "width") {
        borders[index] = border.width ?? borders[index]!;
        return;
      }
      borders[index] = border.width ?? 0;
      colors[index] = border.color;
    });
  }
  const sides = named ? borders.map((border) => border ?? 0) : isLineless(dom.closest("table")) ? [0, 0, 0, 0] : borders;
  // One color for the cell: the first a visible border has. Black is the
  // borders' color anyway.
  const seen = sides.findIndex((border, index) => (border ?? 0) > 0 && colors[index]);
  const color = seen < 0 ? null : colors[seen]!;
  const attrs: Record<string, unknown> = {
    border_color: color === "#000000" ? null : color,
    padding: padding.some((side) => side !== null) ? padding.map((side) => side ?? 0) : null,
  };
  BORDER_ATTRS.forEach((name, index) => (attrs[name] = sides[index] ?? null));
  return attrs;
}

/** Shows a cell's borders and padding on `dom`, through its style
 * properties, which the page's security policy allows. Copied cells keep
 * them. */
export function showCellBox(dom: HTMLElement, node: Node) {
  const color = (node.attrs["border_color"] as string | null) ?? "#000000";
  BORDER_ATTRS.forEach((name, index) => {
    const border = node.attrs[name] as number | null;
    if (border === null) return;
    dom.style.setProperty(`border-${SIDES[index]}`, border > 0 ? `${border}pt solid ${color}` : "none");
  });
  const padding = node.attrs["padding"] as number[] | null;
  if (padding) dom.style.padding = padding.map((side) => `${side}pt`).join(" ");
}

/** A row's least height in points, from its style or `height`, or null. */
export function rowHeightFromDom(dom: HTMLElement): number | null {
  const style = declared(dom, "height");
  let height = style === null ? null : lengthFromCss(style);
  if (height === null) {
    const pixels = Number(dom.getAttribute("height"));
    if (pixels > 0) height = pixels * 0.75;
  }
  return height !== null && height > 0 ? twentieths(Math.min(height, 1440)) : null;
}

/** A line's thickness and color, from the style the editor and the server
 * write on it, or a pasted Google Docs line's. */
export function ruleFromDom(dom: HTMLElement): Attrs {
  let thickness: number | null = null;
  let color: string | null = null;
  for (const [name, value] of declarations(dom)) {
    if (name !== "border-top" && name !== "border") continue;
    const border = borderFromCss(value);
    if (border.width) thickness = border.width;
    color = border.color ?? color;
  }
  return { thickness, color };
}

/** A pasted cell's column widths in pixels, from its table's `<col>`s, as
 * Google Docs copies them, or its own width, as Word does, or null. */
export function columnWidthsFromDom(dom: HTMLElement): number[] | null {
  const colspan = Math.max(1, Number(dom.getAttribute("colspan")) || 1);
  const table = dom.closest("table");
  const columns = table ? tableColumns(table) : [];
  const at = table && columns.length ? columnOf(table, dom) : -1;
  if (at >= 0) {
    const widths = columns.slice(at, at + colspan);
    if (widths.length === colspan && widths.every((width) => width !== null)) return widths as number[];
  }
  if (colspan !== 1) return null;
  const width = widthOf(dom);
  return width === null ? null : [width];
}

/** An element's width in pixels, from its style or `width`, or null. */
function widthOf(dom: Element): number | null {
  const style = declared(dom as HTMLElement, "width");
  const points = style === null ? null : lengthFromCss(style);
  const pixels = points !== null ? points / 0.75 : Number(dom.getAttribute("width"));
  return Number.isFinite(pixels) && pixels >= 1 && pixels < 100_000 ? Math.round(pixels) : null;
}

/** Each column's width from a table's `<col>`s. */
function tableColumns(table: HTMLTableElement): (number | null)[] {
  const widths: (number | null)[] = [];
  for (const col of table.querySelectorAll(":scope > colgroup > col, :scope > col")) {
    const span = Math.min(1000, Math.max(1, Number(col.getAttribute("span")) || 1));
    for (let index = 0; index < span; index++) widths.push(widthOf(col));
  }
  return widths;
}

/** The column a cell starts in, counting cells from rows above that reach
 * down into its row. */
function columnOf(table: HTMLTableElement, cell: HTMLElement): number {
  const taken: number[] = [];
  for (const row of table.rows) {
    let column = 0;
    for (const each of row.cells) {
      while ((taken[column] ?? 0) > 0) column++;
      if (each === cell) return column;
      const span = Math.max(1, each.colSpan || 1);
      for (let index = column; index < column + span; index++) taken[index] = Math.max(1, each.rowSpan || 1);
      column += span;
    }
    for (let index = 0; index < taken.length; index++) taken[index] = Math.max(0, (taken[index] ?? 0) - 1);
  }
  return -1;
}

/** Pasted HTML with Google Docs' horizontal lines as lines. Google Docs
 * copies each as a picture named "horizontal line" in a paragraph of its
 * own, as thick as the picture is tall, in the color of the text around
 * it. */
export function googleLines(html: string): string {
  if (!/horizontal line/i.test(html)) return html;
  const doc = new DOMParser().parseFromString(html, "text/html");
  let changed = false;
  for (const img of doc.querySelectorAll("img[title]")) {
    if (img.getAttribute("title")?.trim().toLowerCase() !== "horizontal line") continue;
    const height = Number(img.getAttribute("height"));
    const thickness = height > 0 ? twentieths(Math.min(height * 0.75, MAX_LINE)) : 0.75;
    let color = "#000000";
    for (let at = img.parentElement; at && !at.matches("p, td, th, li, body"); at = at.parentElement) {
      const found = colorFromCss(declared(at, "color") ?? "");
      if (found) {
        color = found;
        break;
      }
    }
    const hr = doc.createElement("hr");
    hr.setAttribute("data-style", `border-top:${thickness}pt solid ${color}`);
    const block = img.closest("p, h1, h2, h3, h4, h5, h6");
    if (block && !block.textContent?.trim() && block.querySelectorAll("img").length === 1) block.replaceWith(hr);
    else img.replaceWith(hr);
    changed = true;
  }
  return changed ? doc.body.innerHTML : html;
}

/** A pasted slice with each table that's wider than `room` pixels made
 * narrower to fit, its columns keeping their shares. A table copied from a
 * page with narrower margins would otherwise run off the page. */
export function fitTables(slice: Slice, room: number): Slice {
  if (!(room > 0)) return slice;
  const fit = (fragment: Fragment): Fragment => {
    const nodes: Node[] = [];
    let changed = false;
    fragment.forEach((node) => {
      const fitted = node.type.name === "table" ? fitTable(node, room) : node.isLeaf ? node : node.copy(fit(node.content));
      if (fitted !== node) changed = true;
      nodes.push(fitted);
    });
    return changed ? Fragment.fromArray(nodes) : fragment;
  };
  const content = fit(slice.content);
  return content === slice.content ? slice : new Slice(content, slice.openStart, slice.openEnd);
}

function fitTable(table: Node, room: number): Node {
  const first = table.firstChild;
  let total = 0;
  first?.forEach((cell) => {
    const widths = cell.attrs["colwidth"] as number[] | null;
    total += widths ? widths.reduce((sum, width) => sum + width, 0) : NaN;
  });
  if (!(total > room)) return table;
  const scale = room / total;
  const rows: Node[] = [];
  table.forEach((row) => {
    const cells: Node[] = [];
    row.forEach((cell) => {
      const widths = cell.attrs["colwidth"] as number[] | null;
      cells.push(
        widths
          ? cell.type.create({ ...cell.attrs, colwidth: widths.map((width) => Math.max(24, Math.floor(width * scale))) }, cell.content, cell.marks)
          : cell,
      );
    });
    rows.push(row.copy(Fragment.fromArray(cells)));
  });
  return table.copy(Fragment.fromArray(rows));
}
