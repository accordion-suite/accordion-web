// A note's images (decision 31). Each image is a file beside the note,
// shown by a line of its own at the top of the note's text, such as
// `![](Garden/Groceries%201.jpg)`, so Obsidian shows them there too. The
// editor shows those lines as pictures above the text, and the text box
// holds only what's below them.

/** The largest picture the server takes. */
export const MAX_IMAGE_BYTES = 50 * 1024 * 1024;

/** The kinds of pictures Notes takes, for the file picker. */
export const IMAGE_TYPES = ".jpg,.jpeg,.png,.gif,.webp,.avif,.heic,.heif,image/jpeg,image/png,image/gif,image/webp,image/avif,image/heic,image/heif";

const EXTENSIONS = ["jpg", "jpeg", "png", "gif", "webp", "avif", "heic", "heif"];

/** A line that only shows a picture: `![alt](target)` or `![[target]]`. */
const IMAGE_LINE = /^\s*!(?:\[[^\]]*\]\(\s*(<[^>]*>|[^)\s]+)(?:\s+["'][^"']*["'])?\s*\)|\[\[([^\]|#^]+)(?:[|#^][^\]]*)?\]\])\s*$/;

/** The file a line that only shows a picture points to, decoded, or null
 * for any other line. */
export function imageTarget(line: string): string | null {
  const found = IMAGE_LINE.exec(line.replace(/\r$/, ""));
  if (!found) return null;
  if (found[2] !== undefined) return found[2].trim();
  const written = found[1]!;
  if (written.startsWith("<")) return written.slice(1, -1);
  return decodeTarget(written.replace(/\\([!-/:-@[-`{-~])/g, "$1"));
}

/** A link's address as the note means it, with `%20` and the like
 * decoded, as Notes on the server reads it. */
export function decodeTarget(written: string): string {
  try {
    return decodeURIComponent(written);
  } catch {
    return written;
  }
}

/** Whether `name` is a picture Notes takes. */
export function isImageName(name: string): boolean {
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  return name.includes(".") && EXTENSIONS.includes(extension);
}

/** A note's text, split into the lines of pictures at its top and the
 * rest. */
export interface Split {
  /** The lines that show pictures, as written. */
  lines: string[];
  /** The text below them. */
  rest: string;
}

/** Splits the pictures at the top of `body` from the text below them. One
 * blank line after them goes with them. */
export function splitImages(body: string): Split {
  const all = body.split("\n");
  let count = 0;
  while (count < all.length && imageTarget(all[count]!) !== null && isImageName(imageTarget(all[count]!)!)) count++;
  if (count === 0) return { lines: [], rest: body };
  let restStart = count;
  if (restStart < all.length && all[restStart]!.trim() === "") restStart++;
  return { lines: all.slice(0, count), rest: all.slice(restStart).join("\n") };
}

/** A note's text with `lines` of pictures at its top, then a blank line,
 * then `rest`. */
export function joinImages(lines: readonly string[], rest: string): string {
  if (lines.length === 0) return rest;
  return rest === "" ? `${lines.join("\n")}\n` : `${lines.join("\n")}\n\n${rest}`;
}

/** Where the text below the pictures starts in `body`. */
export function restOffset(body: string): number {
  return body.length - splitImages(body).rest.length;
}

/** The address of one of a note's pictures: `small` for a card, from
 * Drive's thumbnail, or `large` for the editor. */
export function imageUrl(note: string, target: string, size: "small" | "large"): string {
  return `/api/notes/notes/${note}/image?path=${encodeURIComponent(target)}&size=${size}`;
}
