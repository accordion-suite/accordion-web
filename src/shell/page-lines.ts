// A page thumbnail: an HTML page's first lines as the server read them
// (accordion-core's `src/html.rs`), with each line's kind and its text's
// styles, so a card can draw the page with the app's own styles.

/** The page thumbnail version this app draws. The server raises it when
 * what thumbnails hold changes in a way apps must know about. */
const VERSION = 1;

/** The styles a run of text can have. */
export const STYLES = ["bold", "italic", "underline", "strike", "code", "link"] as const;
export type Style = (typeof STYLES)[number];

/** Text with the same styles. */
export interface Run {
  text: string;
  styles: Style[];
}

export type PageLine = {
  /** How many lists an item is inside, past the first. */
  depth: number;
  /** Whether it's quoted. */
  quote: boolean;
} & (
  | { kind: "paragraph" | "code"; runs: Run[] }
  | { kind: "heading"; level: number; runs: Run[] }
  | { kind: "item"; mark: string; runs: Run[] }
  | { kind: "check"; checked: boolean; runs: Run[] }
  | { kind: "row"; cells: Run[][] }
);

/** The lines of the page thumbnail `json`, or null if it isn't one this
 * app knows how to draw, such as one from a newer server. */
export function pageLines(json: unknown): PageLine[] | null {
  if (!isObject(json) || json["version"] !== VERSION || !Array.isArray(json["lines"])) return null;
  const lines: PageLine[] = [];
  for (const value of json["lines"]) {
    const line = pageLine(value);
    if (!line) return null;
    lines.push(line);
  }
  return lines;
}

function pageLine(value: unknown): PageLine | null {
  if (!isObject(value)) return null;
  const depth = typeof value["depth"] === "number" ? Math.max(0, Math.floor(value["depth"])) : 0;
  const quote = value["quote"] === true;
  if (value["kind"] === "row") {
    if (!Array.isArray(value["cells"])) return null;
    const cells = value["cells"].map(runs);
    return cells.every((cell) => cell !== null) ? { kind: "row", cells, depth, quote } : null;
  }
  const text = runs(value["runs"]);
  if (!text) return null;
  switch (value["kind"]) {
    case "paragraph":
    case "code":
      return { kind: value["kind"], runs: text, depth, quote };
    case "heading": {
      const level = typeof value["level"] === "number" ? value["level"] : 1;
      return { kind: "heading", level: Math.min(6, Math.max(1, Math.floor(level))), runs: text, depth, quote };
    }
    case "item":
      return { kind: "item", mark: typeof value["mark"] === "string" ? value["mark"] : "•", runs: text, depth, quote };
    case "check":
      return { kind: "check", checked: value["checked"] === true, runs: text, depth, quote };
    default:
      // A kind from a newer server shows as plain text.
      return { kind: "paragraph", runs: text, depth, quote };
  }
}

function runs(value: unknown): Run[] | null {
  if (!Array.isArray(value)) return null;
  const found: Run[] = [];
  for (const run of value) {
    if (!isObject(run) || typeof run["text"] !== "string") return null;
    found.push({ text: run["text"], styles: STYLES.filter((style) => run[style] === true) });
  }
  return found;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
