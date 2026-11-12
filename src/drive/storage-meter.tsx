// How full someone's space is: "87 MB of 10 GB used" with a bar, under
// Storage in the sidebar and on the Storage page, where the bar shows each
// type of file in its own color. Without a limit, the text says "of ∞", and
// the bar has no end to fill toward.

import { formatPercent, formatSize, t } from "../i18n.ts";
import { named, TYPES, typeIcon } from "./filter-bar.tsx";
import { ItemIcon } from "./icons.tsx";
import type { Usage } from "./layout.tsx";
import { TYPE_KINDS } from "./types.ts";

/** How much space one type of file takes, from `/api/drive/usage/types`.
 * The type is null for files of no type. */
export interface TypeUsage {
  type: string | null;
  bytes: number;
}

/** "87 MB of 10 GB used", or "87 MB of ∞ used" with no limit. */
export function usedText(used: number, limit: number | null): string {
  const size = formatSize(used);
  return limit === null
    ? t("drive.storageUsedNoLimit", { used: size })
    : t("drive.storageUsed", { used: size, quota: formatSize(limit) });
}

/** What the bar is out of: the limit, or with none, what's used, so the
 * types share the bar. Someone over their limit fills it. */
function wholeOf(usage: Usage): number {
  return Math.max(usage.quota ?? usage.used, usage.used, 1);
}

/** The bar of how full the space is. Its text says the same, so screen
 * readers skip it. */
export function StorageBar({ usage, types }: { usage: Usage; types?: readonly TypeUsage[] }) {
  const whole = wholeOf(usage);
  // Without a limit, the plain bar has nothing to measure against.
  const used = usage.quota === null ? 0 : usage.used / whole;
  return (
    <div class={types ? "storage-bar detailed" : "storage-bar"} aria-hidden="true">
      {types
        ? types.map((each) => (
            <span
              key={each.type ?? ""}
              class="storage-part"
              style={{ width: `${(each.bytes / whole) * 100}%`, background: colorOf(each.type) }}
            />
          ))
        : used > 0 && <span class="storage-part" style={{ width: `${used * 100}%` }} />}
    </div>
  );
}

function colorOf(type: string | null): string {
  return `var(--kind-${(type && TYPE_KINDS[type]) || "file"})`;
}

/** Each type's icon, in the color its part of the bar has, with its name,
 * size, and share. The shares are of the limit, as the bar shows them, or
 * of what's used. */
export function TypeLegend({ usage, types }: { usage: Usage; types: readonly TypeUsage[] }) {
  const whole = wholeOf(usage);
  const names = new Map(named(TYPES));
  const free = usage.quota === null ? 0 : Math.max(usage.quota - usage.used, 0);
  return (
    <ul class="storage-legend">
      {types.map((each) => (
        <li key={each.type ?? ""}>
          <span class="storage-legend-icon" aria-hidden="true">
            {each.type ? typeIcon(each.type) : <ItemIcon item={{ kind: "file", name: "", type: null }} />}
          </span>
          <span class="storage-legend-name">
            {(each.type && names.get(each.type)) || t("storage.otherFiles")}
          </span>
          <span class="storage-legend-size">{formatSize(each.bytes)}</span>
          <span class="storage-legend-share">{formatPercent(each.bytes / whole)}</span>
        </li>
      ))}
      {usage.quota !== null && (
        <li class="storage-free">
          <span class="storage-legend-icon" aria-hidden="true">
            <span class="storage-swatch" />
          </span>
          <span class="storage-legend-name">{t("storage.free")}</span>
          <span class="storage-legend-size">{formatSize(free)}</span>
          <span class="storage-legend-share">{formatPercent(free / whole)}</span>
        </li>
      )}
    </ul>
  );
}
