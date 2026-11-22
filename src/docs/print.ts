// Printing a document (decision 30): its pages are laid out again in a
// frame the reader doesn't see, as wide as the paper whatever the window's
// width, by the same code and styles as the editor's, so what prints is what
// the editor shows. Browsers offer Save as PDF in the same window.

import type { Node } from "prosemirror-model";
import type { EditorView } from "prosemirror-view";

import { createPrintView } from "./editor.ts";
import { addFonts } from "./font-faces.ts";
import { type PageSetup, pagePoints } from "./page-setup.ts";
import { geometryOf, layOutNow, type PageParts, setPageGeometry, setPageParts, showPaper } from "./pages.ts";

/** Prints `doc` on `setup`'s paper, with its headers and footers, as
 * `title`, which browsers offer as a PDF's name. Resolves once the
 * browser's print window has closed. */
export async function printDocument(
  doc: Node,
  parts: PageParts,
  setup: PageSetup,
  title: string,
  pictureAddress: (hash: string) => string,
): Promise<void> {
  const frame = document.createElement("iframe");
  frame.className = "docs-print-frame";
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  document.body.append(frame);
  let view: EditorView | null = null;
  const done = () => {
    view?.destroy();
    frame.remove();
  };
  try {
    const page = frame.contentDocument;
    const window = frame.contentWindow;
    if (!page || !window) throw new Error("no frame");
    page.open();
    page.write('<!doctype html><html lang=""><head><meta charset="utf-8"></head><body class="docs-print"></body></html>');
    page.close();
    page.documentElement.lang = document.documentElement.lang;
    page.title = title;
    // The app's own style sheets, which its security policy allows.
    const loading: Promise<unknown>[] = [];
    for (const link of document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')) {
      const copy = page.createElement("link");
      copy.rel = "stylesheet";
      copy.href = link.href;
      loading.push(
        new Promise((resolve) => {
          copy.addEventListener("load", resolve, { once: true });
          copy.addEventListener("error", resolve, { once: true });
        }),
      );
      page.head.append(copy);
    }
    const [width, height] = pagePoints(setup);
    const paper = new (window as unknown as typeof globalThis).CSSStyleSheet();
    paper.replaceSync(`@page { size: ${width}pt ${height}pt; margin: 0; }`);
    page.adoptedStyleSheets = [paper];
    await Promise.all(loading);
    addFonts(page);
    const mount = page.createElement("div");
    mount.className = "docs-page";
    page.body.append(mount);
    showPaper(mount, setup);
    view = createPrintView(mount, doc, pictureAddress);
    setPageGeometry(view, geometryOf(setup));
    setPageParts(view, parts);
    // Text moves as fonts and pictures arrive, so pages break once they're
    // in.
    void page.body.offsetHeight;
    await page.fonts.ready;
    await Promise.all(
      [...page.images].map((image) => (image.complete ? Promise.resolve() : image.decode().catch(() => undefined))),
    );
    layOutNow(view);
    layOutNow(view);
    window.addEventListener("afterprint", () => setTimeout(done, 1000), { once: true });
    window.focus();
    window.print();
  } catch (problem) {
    done();
    throw problem;
  }
}
