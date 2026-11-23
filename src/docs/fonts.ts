// The fonts Docs offers. Each comes with the app, from Fontsource's copies
// of open fonts, so showing one never tells another site who's reading.
//
// Docs always names the font it shows. A document, a paste, or an opened
// file that names a font Docs doesn't have gets one Docs has in its place
// (`resolveFont`), and the editor says which (font-notice.ts). Six fonts
// are made to match the fonts Word and Google Docs use most, letter width
// for letter width: Arimo for Arial, Carlito for Calibri, Caladea for
// Cambria, Cousine for Courier New, Gelasio for Georgia, and Tinos for
// Times New Roman. Comic Relief matches Comic Sans MS the same way. Text
// set in them breaks into lines in the same places in Word.
//
// The build bundles every weight of each font in every language it has
// (scripts/build.ts): one variable file for each style where Fontsource has
// one, else a file for each weight. The browser only downloads the files a
// page uses. accordion-docs' `fonts.rs` keeps the same list, stand-ins,
// and weights.

export type FontKind = "sans-serif" | "serif" | "monospace" | "display" | "handwriting";

export interface FontChoice {
  /** The font's own name, which documents use and the menu shows. */
  name: string;
  /** Fontsource's package for it, such as `@fontsource-variable/arimo`. */
  package: string;
  kind: FontKind;
  /** The weights it has, from 100 to 900. */
  weights: readonly number[];
}

const ALL = [100, 200, 300, 400, 500, 600, 700, 800, 900] as const;
const REGULAR = [400] as const;
const REGULAR_BOLD = [400, 700] as const;
const from = (low: number, high: number) => ALL.filter((weight) => weight >= low && weight <= high);

const variable = (name: string, id: string, kind: FontKind, weights: readonly number[]): FontChoice => ({
  name,
  package: `@fontsource-variable/${id}`,
  kind,
  weights,
});
const fixed = (name: string, id: string, kind: FontKind, weights: readonly number[]): FontChoice => ({
  name,
  package: `@fontsource/${id}`,
  kind,
  weights,
});

/** The menu's fonts, in its order. */
export const FONTS: readonly FontChoice[] = [
  variable("Alegreya", "alegreya", "serif", from(400, 900)),
  fixed("Amatic SC", "amatic-sc", "handwriting", REGULAR_BOLD),
  variable("Arimo", "arimo", "sans-serif", from(400, 700)),
  fixed("Bree Serif", "bree-serif", "serif", REGULAR),
  fixed("Caladea", "caladea", "serif", REGULAR_BOLD),
  fixed("Carlito", "carlito", "sans-serif", REGULAR_BOLD),
  variable("Caveat", "caveat", "handwriting", from(400, 700)),
  variable("Comfortaa", "comfortaa", "display", from(300, 700)),
  fixed("Comic Neue", "comic-neue", "handwriting", [300, 400, 700]),
  fixed("Comic Relief", "comic-relief", "handwriting", REGULAR_BOLD),
  fixed("Cousine", "cousine", "monospace", REGULAR_BOLD),
  variable("EB Garamond", "eb-garamond", "serif", from(400, 800)),
  variable("Gelasio", "gelasio", "serif", from(400, 700)),
  variable("Inter", "inter", "sans-serif", ALL),
  fixed("Lato", "lato", "sans-serif", [100, 300, 400, 700, 900]),
  variable("Lexend", "lexend", "sans-serif", ALL),
  variable("Libre Baskerville", "libre-baskerville", "serif", from(400, 700)),
  fixed("Lobster", "lobster", "display", REGULAR),
  variable("Lora", "lora", "serif", from(400, 700)),
  variable("Merriweather", "merriweather", "serif", from(300, 900)),
  variable("Montserrat", "montserrat", "sans-serif", ALL),
  variable("Noto Sans", "noto-sans", "sans-serif", ALL),
  variable("Noto Serif", "noto-serif", "serif", ALL),
  variable("Nunito", "nunito", "sans-serif", from(200, 900)),
  variable("Open Sans", "open-sans", "sans-serif", from(300, 800)),
  variable("Oswald", "oswald", "sans-serif", from(200, 700)),
  fixed("Pacifico", "pacifico", "handwriting", REGULAR),
  fixed("Permanent Marker", "permanent-marker", "handwriting", REGULAR),
  fixed("Pinyon Script", "pinyon-script", "handwriting", REGULAR),
  variable("Playfair Display", "playfair-display", "serif", from(400, 900)),
  variable("Raleway", "raleway", "sans-serif", ALL),
  variable("Roboto", "roboto", "sans-serif", ALL),
  variable("Roboto Mono", "roboto-mono", "monospace", from(100, 700)),
  variable("Roboto Serif", "roboto-serif", "serif", ALL),
  variable("Source Code Pro", "source-code-pro", "monospace", from(200, 900)),
  variable("Source Sans 3", "source-sans-3", "sans-serif", from(200, 900)),
  fixed("Spectral", "spectral", "serif", from(200, 800)),
  fixed("Tinos", "tinos", "serif", REGULAR_BOLD),
  fixed("Ultra", "ultra", "serif", REGULAR),
  fixed("Varela Round", "varela-round", "sans-serif", REGULAR),
];

/** Text with no font of its own: Arimo at 11 points, as Google Docs uses
 * Arial, whose letter widths Arimo has. */
export const DEFAULT_FONT = "Arimo";
export const DEFAULT_SIZE = 11;

/** The font Docs has by this name, ignoring case. */
export function fontNamed(name: string): FontChoice | undefined {
  const lower = name.toLowerCase();
  return FONTS.find((font) => font.name.toLowerCase() === lower);
}

/** Fonts Docs doesn't have, and the one it uses instead. `same` marks
 * fonts made to the same letter widths, so lines break in the same places.
 * The others only look alike. Keys are in lowercase. */
export const STAND_INS: Readonly<Record<string, { font: string; same: boolean }>> = {
  arial: { font: "Arimo", same: true },
  helvetica: { font: "Arimo", same: true },
  "liberation sans": { font: "Arimo", same: true },
  calibri: { font: "Carlito", same: true },
  cambria: { font: "Caladea", same: true },
  "courier new": { font: "Cousine", same: true },
  courier: { font: "Cousine", same: true },
  "liberation mono": { font: "Cousine", same: true },
  georgia: { font: "Gelasio", same: true },
  "times new roman": { font: "Tinos", same: true },
  times: { font: "Tinos", same: true },
  "liberation serif": { font: "Tinos", same: true },
  "comic sans ms": { font: "Comic Relief", same: true },
  "comic sans": { font: "Comic Relief", same: true },
  "helvetica neue": { font: "Arimo", same: false },
  verdana: { font: "Noto Sans", same: false },
  tahoma: { font: "Noto Sans", same: false },
  "segoe ui": { font: "Noto Sans", same: false },
  "dejavu sans": { font: "Noto Sans", same: false },
  "lucida grande": { font: "Noto Sans", same: false },
  "lucida sans unicode": { font: "Noto Sans", same: false },
  "trebuchet ms": { font: "Source Sans 3", same: false },
  aptos: { font: "Source Sans 3", same: false },
  impact: { font: "Oswald", same: false },
  "proxima nova": { font: "Montserrat", same: false },
  "century gothic": { font: "Montserrat", same: false },
  futura: { font: "Montserrat", same: false },
  garamond: { font: "EB Garamond", same: false },
  baskerville: { font: "Libre Baskerville", same: false },
  "baskerville old face": { font: "Libre Baskerville", same: false },
  consolas: { font: "Source Code Pro", same: false },
  menlo: { font: "Source Code Pro", same: false },
  monaco: { font: "Source Code Pro", same: false },
  "lucida console": { font: "Source Code Pro", same: false },
  "dejavu sans mono": { font: "Source Code Pro", same: false },
};

/** CSS's generic families, and the font Docs uses for each. */
const GENERIC: Readonly<Record<string, string | null>> = {
  serif: "Tinos",
  "sans-serif": "Arimo",
  monospace: "Cousine",
  cursive: "Caveat",
  fantasy: null,
  "system-ui": null,
  "ui-serif": "Tinos",
  "ui-sans-serif": "Arimo",
  "ui-monospace": "Cousine",
  "ui-rounded": null,
  math: null,
  emoji: null,
  fangsong: null,
  "-apple-system": null,
  blinkmacsystemfont: null,
  "-webkit-standard": null,
  inherit: null,
  initial: null,
  unset: null,
};

/** Weights that fonts put in their names, such as "Raleway Light", as Word
 * and older programs name them. */
const WEIGHT_WORDS: readonly [RegExp, number][] = [
  [/\s+(thin|hairline)$/i, 100],
  [/\s+(extra|ultra)[\s-]?light$/i, 200],
  [/\s+light$/i, 300],
  [/\s+(regular|normal|book)$/i, 400],
  [/\s+medium$/i, 500],
  [/\s+(semi|demi)[\s-]?bold$/i, 600],
  [/\s+(extra|ultra)[\s-]?bold$/i, 800],
  [/\s+(black|heavy)$/i, 900],
  [/\s+bold$/i, 700],
];

/** A font Docs has, as a name and weight read from elsewhere become. */
export interface ResolvedFont {
  /** The font Docs uses. */
  name: string;
  /** A weight the name gave, such as 300 for "Raleway Light", if it
   * isn't 400. */
  weight: number | null;
  /** The font asked for, when Docs uses another in its place, and how
   * alike the two are. */
  replaced: Replaced | null;
}

/** A font Docs doesn't have, and the one it uses in its place: one made to
 * the same letter widths, one that looks like it, or just one of the same
 * kind, such as a serif font. */
export interface Replaced {
  from: string;
  to: string;
  kind: "same" | "like" | "other";
}

/** The font Docs uses for a CSS `font-family`, such as `"Segoe UI",
 * Roboto, sans-serif`. The first font Docs has, or one made to the same
 * widths as it, comes first, then one that looks like the first font named,
 * then one for its generic family, then Arimo. A name with a weight in it,
 * such as "Raleway Light", is the font with that weight. */
export function resolveFont(family: string): ResolvedFont {
  const names = family
    .split(",")
    .map((name) =>
      name
        .trim()
        .replace(/^["']|["']$/g, "")
        .trim()
        .replace(/\s+/g, " "),
    )
    .filter(Boolean);
  const named = names.filter((name) => !(name.toLowerCase() in GENERIC));
  const weighted = named.map(splitWeight);
  // The font asked for, without a weight in its name.
  const asked = weighted[0]?.[0] ?? null;
  const askedName = named[0] ?? null;
  const result = (name: string, weight: number | null, wanted: number | null, kind: Replaced["kind"]): ResolvedFont => ({
    name,
    weight: weight === 400 ? null : weight,
    replaced:
      askedName && asked!.toLowerCase() !== name.toLowerCase()
        ? // Widths match only in the weight asked for.
          { from: askedName, to: name, kind: kind === "same" && weight !== wanted ? "like" : kind }
        : null,
  });
  for (const [base, weight] of weighted) {
    const font = fontNamed(base);
    if (font) return result(font.name, nearestWeight(font, weight), weight, "other");
    const stand = STAND_INS[base.toLowerCase()];
    if (stand?.same) return result(stand.font, nearestWeight(fontNamed(stand.font)!, weight), weight, "same");
  }
  for (const [base, weight] of weighted) {
    const stand = STAND_INS[base.toLowerCase()];
    if (stand) return result(stand.font, nearestWeight(fontNamed(stand.font)!, weight), weight, "like");
  }
  for (const name of names) {
    const generic = GENERIC[name.toLowerCase()];
    if (generic) return result(generic, null, null, "other");
  }
  return result(DEFAULT_FONT, null, null, "other");
}

/** A name without the weight it ends with, and that weight. */
function splitWeight(name: string): [string, number | null] {
  if (fontNamed(name) || STAND_INS[name.toLowerCase()]) return [name, null];
  for (const [pattern, weight] of WEIGHT_WORDS) {
    if (pattern.test(name)) return [name.replace(pattern, ""), weight];
  }
  return [name, null];
}

/** The weight `font` has closest to `weight`, the lighter of two as close. */
export function nearestWeight(font: FontChoice, weight: number | null): number | null {
  if (weight === null) return null;
  let best = font.weights[0]!;
  for (const have of font.weights) {
    if (Math.abs(have - weight) < Math.abs(best - weight)) best = have;
  }
  return best;
}

/** The weight text shows: its own weight, made bolder by bold, as Google
 * Docs does. Bold makes weights under 400 regular, weights under 700 bold,
 * and leaves heavier ones as they are. */
export function shownWeight(weight: number | null, bold: boolean): number {
  const own = weight ?? 400;
  if (!bold || own >= 700) return own;
  return own < 400 ? 400 : 700;
}

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

const GENERIC_CSS: Record<FontKind, string> = {
  "sans-serif": "sans-serif",
  serif: "serif",
  monospace: "monospace",
  display: "sans-serif",
  handwriting: "cursive",
};

/** The CSS `font-family` for one of Docs' fonts, with a generic family
 * after it while its file loads. */
export function fontStack(name: string): string {
  const kind = fontNamed(name)?.kind ?? "sans-serif";
  return `"${name.replace(/["\\]/g, "")}", ${GENERIC_CSS[kind]}`;
}

/** A font's name as the server keeps it (accordion-docs' `style.rs`):
 * letters, digits, spaces, and a few marks. */
export function safeFontName(name: string): string | null {
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (!trimmed || [...trimmed].length > 64 || !/^[\p{L}\p{N} ._&-]+$/u.test(trimmed)) return null;
  return trimmed;
}

type ReplacedListener = (replaced: readonly Replaced[]) => void;
const listeners = new Set<ReplacedListener>();
let waiting: Replaced[] = [];

/** Tells the page that Docs used another font in place of one it doesn't
 * have, such as while reading a paste. Fonts replaced together, as in one
 * paste, are told together. */
export function reportReplaced(replaced: Replaced): void {
  if (!safeFontName(replaced.from)) return;
  if (waiting.length === 0) {
    queueMicrotask(() => {
      const told = waiting;
      waiting = [];
      for (const listener of listeners) listener(told);
    });
  }
  if (!waiting.some((each) => each.from.toLowerCase() === replaced.from.toLowerCase())) waiting.push(replaced);
}

/** Calls `listener` with the fonts replaced at a time, until the returned
 * function stops it. */
export function onFontsReplaced(listener: ReplacedListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
