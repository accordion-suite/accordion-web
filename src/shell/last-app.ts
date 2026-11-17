// The app page the reader was last on, such as a Drive folder or a Notes
// label, so Settings can lead back to it.

export type App = "drive" | "notes" | "docs";

let last: { app: App; href: string } | null = null;

export function rememberAppPage(app: App, href: string): void {
  last = { app, href };
}

export function lastAppPage(): { app: App; href: string } | null {
  return last;
}

/** Forgets it, since it belongs to whoever was signed in before. */
export function forgetAppPage(): void {
  last = null;
}
