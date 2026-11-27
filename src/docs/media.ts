// Media queries for Docs' pages, kept up to date as the window changes.

import { useEffect, useState } from "preact/hooks";

/** Phones' width, where the text takes the screen's width without pages. */
const NARROW = "(max-width: 860px)";

/** Whether the window is as narrow as a phone's. */
export function useNarrow(): boolean {
  return useMedia(NARROW);
}

/** Whether the window matches a media query, kept up to date. */
export function useMedia(media: string): boolean {
  const [matches, setMatches] = useState(() => matchMedia(media).matches);
  useEffect(() => {
    const query = matchMedia(media);
    const change = () => setMatches(query.matches);
    change();
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, [media]);
  return matches;
}
