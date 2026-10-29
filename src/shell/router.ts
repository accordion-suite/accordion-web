// Moves between pages without reloading, using the address bar's path. The
// server answers every page's address with the same app (decision 13), so a
// reload or a shared link opens the same page.

import { useEffect, useState } from "preact/hooks";

const CHANGED = "accordion:navigate";

/** Goes to `path`, which can end in a query, such as "/drive/?file=abc".
 * `state` is kept with the new history entry, as `history.state`. */
export function navigate(path: string, options: { replace?: boolean; state?: unknown } = {}): void {
  const state = options.state ?? null;
  if (options.replace) {
    history.replaceState(state, "", path);
  } else {
    history.pushState(state, "", path);
  }
  window.dispatchEvent(new Event(CHANGED));
}

/** The current path, such as "/drive/", updated as it changes. */
export function usePath(): string {
  return useAddress(() => location.pathname);
}

/** A value from the address's query, such as the file Drive is showing,
 * updated as it changes. */
export function useQuery(name: string): string | null {
  return useAddress(() => new URLSearchParams(location.search).get(name));
}

function useAddress<T>(read: () => T): T {
  const [value, setValue] = useState(read);
  useEffect(() => {
    const update = () => setValue(read);
    window.addEventListener("popstate", update);
    window.addEventListener(CHANGED, update);
    return () => {
      window.removeEventListener("popstate", update);
      window.removeEventListener(CHANGED, update);
    };
  }, []);
  return value;
}

/** Handles a link's click inside the app, unless the reader asked for a new
 * tab or window. Use it as a link's onClick. */
export function followLink(event: MouseEvent): void {
  const link = event.currentTarget as HTMLAnchorElement;
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return;
  }
  event.preventDefault();
  navigate(link.pathname + link.search);
}
