// Notices when the server has a newer web app than this tab runs, such as
// after an update, so the reader can reload before the old code trips over
// the new server. The page names its script and styles by a hash of their
// contents, so different names mean different code.

import { useEffect, useState } from "preact/hooks";

const READY = "accordion:update-ready";
// How often an open tab checks, and the least time between checks when the
// reader comes back to it.
const EVERY = 10 * 60 * 1000;
const SOON = 60 * 1000;

let ready = false;
let checking = false;
let lastChecked = Date.now();

/** The script and styles a page loads, from its HTML, or null if it isn't
 * the app's page, such as the page about damaged files. */
export function assetsOf(html: string): string | null {
  const script = /<script\b[^>]*\bsrc="([^"]+)"/.exec(html)?.[1];
  const style = /<link\b[^>]*\brel="stylesheet"[^>]*\bhref="([^"]+)"/.exec(html)?.[1];
  return script && style ? `${script} ${style}` : null;
}

/** The script and styles this tab loaded. */
function running(): string | null {
  const script = document.querySelector("script[type=module][src]")?.getAttribute("src");
  const style = document.querySelector("link[rel=stylesheet]")?.getAttribute("href");
  return script && style ? `${script} ${style}` : null;
}

/** Asks the server for its page, and says so if it loads other code than
 * this tab's. A failed check says nothing: the tab may be offline. */
export async function checkForUpdate(): Promise<void> {
  if (ready || checking) return;
  checking = true;
  lastChecked = Date.now();
  try {
    const response = await fetch("/", { cache: "no-cache", credentials: "same-origin" });
    const latest = response.ok ? assetsOf(await response.text()) : null;
    const current = running();
    if (latest && current && latest !== current) {
      ready = true;
      window.dispatchEvent(new Event(READY));
    }
  } catch {
    // Checked again later.
  } finally {
    checking = false;
  }
}

/** Whether a newer web app is ready. It checks every so often while the tab
 * is in view, and when the reader comes back to it. */
export function useUpdateReady(): boolean {
  const [isReady, setReady] = useState(ready);
  useEffect(() => {
    const update = () => setReady(true);
    const check = () => {
      if (document.visibilityState === "visible" && Date.now() - lastChecked >= SOON) {
        void checkForUpdate();
      }
    };
    window.addEventListener(READY, update);
    document.addEventListener("visibilitychange", check);
    const timer = setInterval(check, EVERY);
    return () => {
      window.removeEventListener(READY, update);
      document.removeEventListener("visibilitychange", check);
      clearInterval(timer);
    };
  }, []);
  return isReady;
}
