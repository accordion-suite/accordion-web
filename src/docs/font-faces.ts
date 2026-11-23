// Docs' fonts, added to a page through the browser's FontFace API, since
// the app's security policy allows only its own style sheets. Adding one
// downloads nothing: the browser fetches a file the first time the page
// shows text in that font, style, and language.

import { FACES } from "docs-fonts";

const added = new WeakSet<Document>();

/** Adds every Docs font to `page`, such as the app's own page or the print
 * page in its frame, once. */
export function addFonts(page: Document = document): void {
  const window = page.defaultView;
  if (added.has(page) || !window) return;
  added.add(page);
  for (const [family, weights, italic, range, url] of FACES) {
    // The page's own FontFace, since a font set takes only its own.
    const face = new window.FontFace(family, `url(${url})`, {
      weight: weights,
      style: italic ? "italic" : "normal",
      unicodeRange: range,
      display: "swap",
    });
    page.fonts.add(face);
  }
}
