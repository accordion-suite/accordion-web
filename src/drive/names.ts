/** How much of a file's name to select for renaming: everything before its
 * extension, so typing replaces the name and keeps ".jpg". A name that
 * starts with its only dot, such as ".bashrc", has no extension. */
export function stemLength(name: string): number {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? dot : name.length;
}

/** `name`, or else "name (1)", "name (2)", and so on, whichever isn't in
 * `taken`, as Google Drive names a second upload with the same name. The
 * number goes before the extension, so "Beach.jpg" becomes "Beach (1).jpg"
 * and still opens as a photo. Google Drive does the same for folders, so a
 * folder named "test.txt" becomes "test (1).txt" too.
 *
 * A name that already ends in a number in parentheses counts up from it, so
 * "test (4).txt" becomes "test (5).txt", not "test (4) (1).txt". Every such
 * number counts, including a year: "Taxes (2025).pdf" becomes
 * "Taxes (2026).pdf". The rule stays the same for every name, as it does in
 * Google Drive. */
export function freeName(name: string, taken: ReadonlySet<string>): string {
  if (!taken.has(name)) return name;
  const extension = name.slice(stemLength(name));
  const numbered = /^(.*) \((\d+)\)$/.exec(name.slice(0, name.length - extension.length));
  const stem = numbered ? numbered[1]! : name.slice(0, name.length - extension.length);
  // BigInt, so a long run of digits counts up exactly.
  for (let number = numbered ? BigInt(numbered[2]!) + 1n : 1n; ; number++) {
    const next = `${stem} (${number})${extension}`;
    if (!taken.has(next)) return next;
  }
}

/** What a rename does to a file's extension, so Drive can ask first, as
 * Windows and macOS do: "removed" or "changed", with the extensions before
 * and after, or null when it stays (ignoring capitals) or is only added.
 *
 * Only an ending that looks like an extension counts: up to 12 letters or
 * digits with at least one letter, such as ".html" or ".mp4". That keeps
 * "Budget v1.2" and "Meeting 3.5 notes" from counting as extensions, so
 * renaming them doesn't ask. */
export function extensionChange(
  before: string,
  after: string,
): { kind: "removed" | "changed"; before: string; after: string } | null {
  const from = extensionOf(before);
  if (!from) return null;
  const to = extensionOf(after);
  if (!to) return { kind: "removed", before: from, after: "" };
  return to.toLowerCase() === from.toLowerCase() ? null : { kind: "changed", before: from, after: to };
}

function extensionOf(name: string): string {
  const extension = name.slice(stemLength(name));
  return /^\.(?=[\p{L}\p{N}]*\p{L})[\p{L}\p{N}]{1,12}$/u.test(extension) ? extension : "";
}
