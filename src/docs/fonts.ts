// The fonts Docs offers. Each comes with the app, from Fontsource's copies
// of open fonts, so showing one never tells another site who's reading.
//
// Six are made to match the fonts Word and Google Docs use most, letter for
// letter, and go by those fonts' names: a document set in "Arial" shows in
// Arimo here, and in Arial itself in Word or wherever Arial is installed,
// with its lines breaking in the same places. The build bundles each
// font's regular, bold, italic, and bold italic in every language it has
// (scripts/build.ts), and the browser only downloads the ones a page uses.

export type FontKind = "sans-serif" | "serif" | "monospace" | "display" | "handwriting";

export interface FontChoice {
  /** The name documents use, and the menu shows. */
  name: string;
  /** Fontsource's package for it, under `@fontsource/`. */
  package: string;
  kind: FontKind;
}

/** The menu's fonts, in its order. */
export const FONTS: readonly FontChoice[] = [
  { name: "Amatic SC", package: "amatic-sc", kind: "handwriting" },
  { name: "Arial", package: "arimo", kind: "sans-serif" },
  { name: "Calibri", package: "carlito", kind: "sans-serif" },
  { name: "Cambria", package: "caladea", kind: "serif" },
  { name: "Caveat", package: "caveat", kind: "handwriting" },
  { name: "Comfortaa", package: "comfortaa", kind: "display" },
  { name: "Comic Neue", package: "comic-neue", kind: "handwriting" },
  { name: "Courier New", package: "cousine", kind: "monospace" },
  { name: "EB Garamond", package: "eb-garamond", kind: "serif" },
  { name: "Georgia", package: "gelasio", kind: "serif" },
  { name: "Inter", package: "inter", kind: "sans-serif" },
  { name: "Lato", package: "lato", kind: "sans-serif" },
  { name: "Lexend", package: "lexend", kind: "sans-serif" },
  { name: "Libre Baskerville", package: "libre-baskerville", kind: "serif" },
  { name: "Lobster", package: "lobster", kind: "display" },
  { name: "Lora", package: "lora", kind: "serif" },
  { name: "Merriweather", package: "merriweather", kind: "serif" },
  { name: "Montserrat", package: "montserrat", kind: "sans-serif" },
  { name: "Noto Sans", package: "noto-sans", kind: "sans-serif" },
  { name: "Noto Serif", package: "noto-serif", kind: "serif" },
  { name: "Nunito", package: "nunito", kind: "sans-serif" },
  { name: "Open Sans", package: "open-sans", kind: "sans-serif" },
  { name: "Oswald", package: "oswald", kind: "sans-serif" },
  { name: "Pacifico", package: "pacifico", kind: "handwriting" },
  { name: "Playfair Display", package: "playfair-display", kind: "serif" },
  { name: "Raleway", package: "raleway", kind: "sans-serif" },
  { name: "Roboto", package: "roboto", kind: "sans-serif" },
  { name: "Roboto Mono", package: "roboto-mono", kind: "monospace" },
  { name: "Roboto Serif", package: "roboto-serif", kind: "serif" },
  { name: "Source Code Pro", package: "source-code-pro", kind: "monospace" },
  { name: "Source Sans 3", package: "source-sans-3", kind: "sans-serif" },
  { name: "Spectral", package: "spectral", kind: "serif" },
  { name: "Times New Roman", package: "tinos", kind: "serif" },
];

/** Text with no font of its own: Arial at 11 points, as in Google Docs and
 * the Word download. */
export const DEFAULT_FONT = "Arial";
export const DEFAULT_SIZE = 11;

/** The sizes the size menu offers, in points, as Google Docs's. */
export const SIZES = [8, 9, 10, 11, 12, 14, 18, 24, 30, 36, 48, 60, 72, 96] as const;

/** The smallest and largest sizes, as the server keeps them
 * (accordion-docs' `style.rs`). */
export const MIN_SIZE = 1;
export const MAX_SIZE = 400;

/** A size someone typed or stepped to, as one the document keeps: within
 * the limits, to the nearest half point. */
export function fitSize(points: number): number | null {
  if (!Number.isFinite(points)) return null;
  return Math.min(MAX_SIZE, Math.max(MIN_SIZE, Math.round(points * 2) / 2));
}

/** The next size up or down from `points`, a point at a time, as Google
 * Docs steps. */
export function stepSize(points: number, by: 1 | -1): number {
  return fitSize(by > 0 ? Math.floor(points) + 1 : Math.ceil(points) - 1) ?? points;
}

const GENERIC: Record<FontKind, string> = {
  "sans-serif": "sans-serif",
  serif: "serif",
  monospace: "monospace",
  display: "sans-serif",
  handwriting: "cursive",
};

/** The CSS `font-family` for a document's font: the font, then a family
 * like it for a name Docs doesn't have, such as one from an opened file. */
export function fontStack(name: string): string {
  const kind = FONTS.find((font) => font.name === name)?.kind ?? "sans-serif";
  return `"${name.replace(/["\\]/g, "")}", ${GENERIC[kind]}`;
}

/** A font's name as the server keeps it (accordion-docs' `style.rs`):
 * letters, digits, spaces, and a few marks. */
export function safeFontName(name: string): string | null {
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (!trimmed || [...trimmed].length > 64 || !/^[\p{L}\p{N} ._&-]+$/u.test(trimmed)) return null;
  return trimmed;
}
