// Light, dark, or the device's own setting. It's kept in this browser, not
// on the server, so a phone can be dark and a laptop light, and it applies
// before the app first draws, with no flash of the other one.

export type Appearance = "light" | "dark" | "auto";

const KEY = "accordion.appearance";

export function savedAppearance(): Appearance {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    // Storage can be blocked, such as in a private window.
  }
  return "auto";
}

/** Sets the page's colors. app.css reads data-theme, and without it follows
 * the device. */
export function applyAppearance(appearance: Appearance): void {
  const root = document.documentElement;
  if (appearance === "auto") delete root.dataset["theme"];
  else root.dataset["theme"] = appearance;
  // The browser's own bar matches too. Each meta tag names its color
  // scheme, so a chosen one takes over both.
  const metas = [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')];
  for (const meta of metas) {
    meta.dataset["media"] ??= meta.media;
    meta.media = appearance === "auto" ? meta.dataset["media"] : meta.dataset["media"].includes(appearance) ? "all" : "not all";
  }
}

export function setAppearance(appearance: Appearance): void {
  try {
    if (appearance === "auto") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, appearance);
  } catch {
    // Still applies until the page reloads.
  }
  applyAppearance(appearance);
}
