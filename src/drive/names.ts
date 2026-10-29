/** How much of a file's name to select for renaming: everything before its
 * extension, so typing replaces the name and keeps ".jpg". A name that
 * starts with its only dot, such as ".bashrc", has no extension. */
export function stemLength(name: string): number {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? dot : name.length;
}
