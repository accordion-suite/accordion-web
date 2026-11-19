// A document's page: its paper size, which way up, and its margins
// (decision 30). It lives in the co-editing document's "page" map, so
// everyone sees a change at once, and the server writes it into the file
// for printing (accordion-docs' `PageSetup` and `yjs::PAGE`).

import type * as Y from "yjs";

export const PAGE_SIZES = ["letter", "a4", "legal", "a5", "a3", "tabloid"] as const;
export type PageSize = (typeof PAGE_SIZES)[number];

export interface PageSetup {
  size: PageSize;
  landscape: boolean;
  /** Top, right, bottom, and left, in points (72 to the inch). */
  margins: [number, number, number, number];
}

/** The map beside the editor's fragment. */
export const PAGE = "page";

const MARGIN_KEYS = ["top", "right", "bottom", "left"] as const;

const MM = 72 / 25.4;

/** Width and height upright, in points. */
const POINTS: Record<PageSize, [number, number]> = {
  letter: [612, 792],
  a4: [210 * MM, 297 * MM],
  legal: [612, 1008],
  a5: [148 * MM, 210 * MM],
  a3: [297 * MM, 420 * MM],
  tabloid: [792, 1224],
};

export const DEFAULT_MARGIN = 72;
export const MAX_MARGIN = 288;
/** The least room the margins leave for text, across and down. */
const MIN_TEXT = 72;

export const MARGIN_PRESETS = {
  normal: [72, 72, 72, 72],
  narrow: [36, 36, 36, 36],
  wide: [72, 144, 72, 144],
} as const satisfies Record<string, PageSetup["margins"]>;
export type MarginPreset = keyof typeof MARGIN_PRESETS;

/** Regions that use Letter paper. Everywhere else uses A4. */
const LETTER_REGIONS = new Set(["US", "CA", "MX", "PH", "CL", "CO", "VE", "CR", "GT", "SV", "NI", "PA", "DO", "PR", "BZ"]);

/** The region of `language`, such as "US" for "en-US", or of the language's
 * usual place when it names none. */
function region(language: string): string | undefined {
  try {
    return new Intl.Locale(language).maximize().region;
  } catch {
    return undefined;
  }
}

/** The paper people in the browser's region use: Letter in the US, Canada,
 * Mexico, and a few others, and A4 everywhere else. */
export function defaultPageSize(language = navigator.language): PageSize {
  return LETTER_REGIONS.has(region(language) ?? "US") ? "letter" : "a4";
}

/** Whether people in the browser's region measure margins in inches. */
export function usesInches(language = navigator.language): boolean {
  return defaultPageSize(language) === "letter";
}

export function newPageSetup(size: PageSize): PageSetup {
  return { size, landscape: false, margins: [...MARGIN_PRESETS.normal] };
}

/** Width and height as laid out, in points. */
export function pagePoints(setup: PageSetup): [number, number] {
  const [width, height] = POINTS[setup.size];
  return setup.landscape ? [height, width] : [width, height];
}

/** The same page with margins that fit, as the server keeps them: none
 * below zero or above 4 inches, rounded to a hundredth of a point, and at
 * least an inch of room for text each way. */
export function normalized(setup: PageSetup): PageSetup {
  const margins = setup.margins.map((margin) =>
    Math.round((Number.isFinite(margin) ? Math.min(Math.max(margin, 0), MAX_MARGIN) : DEFAULT_MARGIN) * 100) / 100,
  ) as PageSetup["margins"];
  const [width, height] = pagePoints(setup);
  const shrink = (a: number, b: number, room: number) => {
    const total = margins[a]! + margins[b]!;
    if (total > room && total > 0) {
      const scale = room / total;
      margins[a] = Math.floor(margins[a]! * scale * 100) / 100;
      margins[b] = Math.floor(margins[b]! * scale * 100) / 100;
    }
  };
  shrink(3, 1, width - MIN_TEXT);
  shrink(0, 2, height - MIN_TEXT);
  return { ...setup, margins };
}

/** The preset the margins match, if any. */
export function marginPreset(margins: PageSetup["margins"]): MarginPreset | null {
  for (const [name, preset] of Object.entries(MARGIN_PRESETS)) {
    if (preset.every((value, index) => Math.abs(value - margins[index]!) < 0.01)) return name as MarginPreset;
  }
  return null;
}

/** The page setup in `page`, or null if nobody has set one. */
export function readPage(page: Y.Map<unknown>): PageSetup | null {
  const size = page.get("size");
  if (typeof size !== "string" || !(PAGE_SIZES as readonly string[]).includes(size)) return null;
  const margins = MARGIN_KEYS.map((key) => {
    const value = page.get(key);
    return typeof value === "number" ? value : DEFAULT_MARGIN;
  }) as PageSetup["margins"];
  return normalized({ size: size as PageSize, landscape: page.get("orientation") === "landscape", margins });
}

/** Makes `page` hold `setup`, changing only what differs, in one
 * transaction, so undo and everyone else see one change. */
export function writePage(page: Y.Map<unknown>, setup: PageSetup) {
  const fixed = normalized(setup);
  const write = () => {
    const set = (key: string, value: string | number) => {
      if (page.get(key) !== value) page.set(key, value);
    };
    set("size", fixed.size);
    set("orientation", fixed.landscape ? "landscape" : "portrait");
    MARGIN_KEYS.forEach((key, index) => set(key, fixed.margins[index]!));
  };
  if (page.doc) page.doc.transact(write);
  else write();
}

/** A margin in points as the reader's unit shows it, rounded for typing. */
export function fromPoints(points: number, inches: boolean): number {
  return inches ? Math.round((points / 72) * 100) / 100 : Math.round((points / MM / 10) * 100) / 100;
}

/** A margin typed in the reader's unit, in points. */
export function toPoints(value: number, inches: boolean): number {
  return inches ? value * 72 : value * 10 * MM;
}
