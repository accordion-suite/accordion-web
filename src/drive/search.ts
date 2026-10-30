// The search page's filters, as Drive's API takes them.

/** The times a modified filter covers, worked out in the reader's own time
 * zone, which the server doesn't know. */
export function modifiedRange(choice: string, now = new Date()): { after?: string; before?: string } {
  const day = 24 * 60 * 60 * 1000;
  switch (choice) {
    case "today":
      return { after: new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString() };
    case "week":
      return { after: new Date(now.getTime() - 7 * day).toISOString() };
    case "month":
      return { after: new Date(now.getTime() - 30 * day).toISOString() };
    case "year":
      return { after: new Date(now.getFullYear(), 0, 1).toISOString() };
    case "last-year":
      return {
        after: new Date(now.getFullYear() - 1, 0, 1).toISOString(),
        before: new Date(now.getFullYear(), 0, 1).toISOString(),
      };
    default:
      return {};
  }
}

/** The API's address for a search page's words and filters. */
export function searchAddress(words: string, type: string, modified: string, now = new Date()): string {
  const query = new URLSearchParams();
  if (words) query.set("q", words);
  if (type) query.set("type", type);
  const { after, before } = modifiedRange(modified, now);
  if (after) query.set("after", after);
  if (before) query.set("before", before);
  return `/api/drive/search?${query}`;
}
