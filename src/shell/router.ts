// Moves between pages without reloading, using the address bar's path. The
// server answers every page's address with the same app (decision 13), so a
// reload or a shared link opens the same page.

import { useEffect, useState } from "preact/hooks";

const CHANGED = "accordion:navigate";

export function navigate(path: string, options: { replace?: boolean } = {}): void {
  if (options.replace) {
    history.replaceState(null, "", path);
  } else {
    history.pushState(null, "", path);
  }
  window.dispatchEvent(new Event(CHANGED));
}

/** The current path, such as "/drive/", updated as it changes. */
export function usePath(): string {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const update = () => setPath(location.pathname);
    window.addEventListener("popstate", update);
    window.addEventListener(CHANGED, update);
    return () => {
      window.removeEventListener("popstate", update);
      window.removeEventListener(CHANGED, update);
    };
  }, []);
  return path;
}

/** Handles a link's click inside the app, unless the reader asked for a new
 * tab or window. Use it as a link's onClick. */
export function followLink(event: MouseEvent): void {
  const link = event.currentTarget as HTMLAnchorElement;
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return;
  }
  event.preventDefault();
  navigate(link.pathname);
}
