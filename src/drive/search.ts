// A search's words and filters (decision 20), as the search page's address
// holds them and Drive's API takes them. The address keeps the reader's
// choices, such as "last 7 days", and the API gets the times they mean,
// worked out in the reader's own time zone, which the server doesn't know.

/** What a search looks for. Empty means any. */
export interface SearchFilters {
  /** Words in the name or inside the file. */
  q: string;
  /** Words in the name only. */
  name: string;
  /** One of `TYPE_KINDS`' names. */
  type: string;
  /** The People filter: "me", "shared" for what the reader shared,
  * "person:" and a username for what they own and what the reader shared
  * with them, or from older addresses, "others" or a username for what
  * they own. */
  owner: string;
  /** "my-drive", "shared", or a folder's ID. */
  in: string;
  starred: boolean;
  trash: boolean;
  /** One of `MODIFIED`'s choices, or "custom" for `from` and `to`. */
  modified: string;
  /** Dates as `YYYY-MM-DD`, in the reader's time zone. `to` is the last
   * day included. */
  from: string;
  to: string;
  /** A username: what the reader shared with them. */
  shared_with: string;
}

export const NO_FILTERS: SearchFilters = {
  q: "",
  name: "",
  type: "",
  owner: "",
  in: "",
  starred: false,
  trash: false,
  modified: "",
  from: "",
  to: "",
  shared_with: "",
};

const TEXT_FILTERS = ["q", "name", "type", "owner", "in", "modified", "from", "to", "shared_with"] as const;
const SWITCHES = ["starred", "trash"] as const;

/** The modified filter's choices, with their messages. */
export const MODIFIED: readonly [string, string][] = [
  ["today", "search.today"],
  ["week", "search.week"],
  ["month", "search.month"],
  ["year", "search.thisYear"],
  ["last-year", "search.lastYear"],
];

/** The search in a page's address. */
export function readSearch(query: URLSearchParams): SearchFilters {
  const filters = { ...NO_FILTERS };
  for (const name of TEXT_FILTERS) filters[name] = query.get(name)?.trim() ?? "";
  for (const name of SWITCHES) filters[name] = query.get(name) === "true";
  return filters;
}

/** The search page's address for `filters`. */
export function searchPath(filters: SearchFilters): string {
  const query = new URLSearchParams();
  for (const name of TEXT_FILTERS) {
    const value = filters[name].trim();
    // Dates only mean something between two dates.
    if (value && ((name !== "from" && name !== "to") || filters.modified === "custom")) query.set(name, value);
  }
  for (const name of SWITCHES) if (filters[name]) query.set(name, "true");
  const text = query.toString();
  return text ? `/drive/search?${text}` : "/drive/search";
}

/** Whether any filter is set, apart from the words. */
export function anyFilter(filters: SearchFilters): boolean {
  return TEXT_FILTERS.some((name) => name !== "q" && filters[name] !== "") || SWITCHES.some((name) => filters[name]);
}

/** The times a modified filter covers, worked out in the reader's own time
 * zone. `from` and `to` are dates for "custom", and `to` is included. */
export function modifiedRange(
  choice: string,
  now = new Date(),
  from = "",
  to = "",
): { after?: string; before?: string } {
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
    case "custom": {
      const start = localDate(from);
      const end = localDate(to);
      return {
        ...(start && { after: start.toISOString() }),
        // The whole of the last day.
        ...(end && { before: new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1).toISOString() }),
      };
    }
    default:
      return {};
  }
}

/** Midnight at the start of a `YYYY-MM-DD` date, in the reader's time zone. */
function localDate(text: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** The API's address for a search. */
export function searchAddress(filters: SearchFilters, now = new Date()): string {
  const query = new URLSearchParams();
  for (const name of ["q", "name", "type", "owner", "in", "shared_with"] as const) {
    if (filters[name]) query.set(name, filters[name]);
  }
  for (const name of SWITCHES) if (filters[name]) query.set(name, "true");
  const { after, before } = modifiedRange(filters.modified, now, filters.from, filters.to);
  if (after) query.set("after", after);
  if (before) query.set("before", before);
  return `/api/drive/search?${query}`;
}
