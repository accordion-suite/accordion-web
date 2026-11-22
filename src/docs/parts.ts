// Headers and footers (decision 30, step 4). Each is a Yjs fragment of its
// own beside the document's, edited together like the document, which the
// server writes into the file as <header> and <footer> (accordion-docs'
// `Parts`). The first page can have its own, as in Google Docs.

import { yXmlFragmentToProseMirrorRootNode } from "y-prosemirror";
import * as Y from "yjs";

import { PAGE } from "./page-setup.ts";
import type { PageParts, PartKind } from "./pages.ts";
import { schema } from "./schema.ts";

/** The page map's key for whether the first page has its own. */
const DIFFERENT_FIRST = "different_first";

/** The fragment that holds a part. */
export function partName(kind: PartKind, first: boolean): string {
  return `${first ? "first_" : ""}${kind}`;
}

const NAMES = ["header", "footer", "first_header", "first_footer"] as const;

/** Whether a fragment has nothing in it but empty paragraphs. */
export function blank(fragment: Y.XmlFragment): boolean {
  return fragment.toArray().every((child) => child instanceof Y.XmlElement && child.nodeName === "paragraph" && child.length === 0);
}

export function differentFirst(doc: Y.Doc): boolean {
  return doc.getMap<unknown>(PAGE).get(DIFFERENT_FIRST) === true;
}

/** The headers and footers, as the pages show them. */
export function readParts(doc: Y.Doc): PageParts {
  const node = (name: string) => {
    const fragment = doc.getXmlFragment(name);
    return blank(fragment) ? null : yXmlFragmentToProseMirrorRootNode(fragment, schema);
  };
  const first = differentFirst(doc);
  return {
    header: node("header"),
    footer: node("footer"),
    firstHeader: first ? node("first_header") : null,
    firstFooter: first ? node("first_footer") : null,
    differentFirst: first,
  };
}

/** Calls `onChange` with the parts now, and whenever they change. */
export function watchParts(doc: Y.Doc, onChange: (parts: PageParts) => void): () => void {
  const show = () => onChange(readParts(doc));
  const fragments = NAMES.map((name) => doc.getXmlFragment(name));
  const page = doc.getMap<unknown>(PAGE);
  const onPage = (event: Y.YMapEvent<unknown>) => {
    if (event.keysChanged.has(DIFFERENT_FIRST)) show();
  };
  fragments.forEach((fragment) => fragment.observeDeep(show));
  page.observe(onPage);
  show();
  return () => {
    fragments.forEach((fragment) => fragment.unobserveDeep(show));
    page.unobserve(onPage);
  };
}

export function setDifferentFirst(doc: Y.Doc, on: boolean) {
  const page = doc.getMap<unknown>(PAGE);
  if (on) page.set(DIFFERENT_FIRST, true);
  else page.delete(DIFFERENT_FIRST);
}

/** Empties a part, which removes it from every page. */
export function removePart(doc: Y.Doc, name: string) {
  const fragment = doc.getXmlFragment(name);
  if (fragment.length) fragment.delete(0, fragment.length);
}

/** A paragraph with a page number at its right, as Google Docs adds one. */
function numberParagraph(): Y.XmlElement {
  const paragraph = new Y.XmlElement("paragraph");
  paragraph.setAttribute("align", "right");
  const text = new Y.XmlText();
  text.insert(0, "#", { field: { kind: "page" } });
  paragraph.insert(0, [text]);
  return paragraph;
}

/** Puts page numbers at the right of each page's header or footer, or of
 * every page's but the first. */
export function addPageNumbers(doc: Y.Doc, kind: PartKind, fromSecond: boolean) {
  doc.transact(() => {
    setDifferentFirst(doc, fromSecond || (differentFirst(doc) && !blank(doc.getXmlFragment(partName(kind, true)))));
    if (fromSecond) removePart(doc, partName(kind, true));
    const fragment = doc.getXmlFragment(partName(kind, false));
    if (blank(fragment)) removePart(doc, partName(kind, false));
    fragment.insert(fragment.length, [numberParagraph()]);
  });
}
