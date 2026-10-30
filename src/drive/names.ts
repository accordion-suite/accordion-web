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
