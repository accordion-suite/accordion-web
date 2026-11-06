// How long the server keeps trash and older versions, which the admin
// chooses in Settings. The Trash page and version history say it, so it's
// loaded once and kept until the admin changes it.

import { useEffect, useState } from "preact/hooks";

import { api } from "../api.ts";
import { t } from "../i18n.ts";

export interface Retention {
  trash_days: number;
  version_days: number;
}

let kept: Retention | null = null;

/** The server's retention, `null` while it loads, or `"unknown"` if it
 * couldn't load. */
export function useRetention(): Retention | null | "unknown" {
  const [retention, setRetention] = useState<Retention | null | "unknown">(kept);
  useEffect(() => {
    if (kept) return;
    api<Retention>("GET", "/api/drive/retention").then(
      (loaded) => {
        kept = loaded;
        setRetention(loaded);
      },
      () => setRetention("unknown"),
    );
  }, []);
  return retention;
}

/** Keeps the admin's new choice, so Drive's pages say it without loading
 * it again. */
export function rememberRetention(retention: Retention): void {
  kept = retention;
}

/** A retention choice in words, such as "30 days" or "1 year". */
export function keptFor(days: number): string {
  return days === 365 ? t("retention.year") : t("retention.days", { count: days });
}
