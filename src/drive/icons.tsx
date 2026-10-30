// The app's icons, drawn here as SVG so they come from the server with the
// app and nothing else is fetched (decision 13). Each is 24 units square and
// takes its color from the text around it, apart from the file icons, whose
// colors come from app.css by kind, so a folder of photos reads at a glance.
//
// Icons are decoration. Whatever they mean is also said in text, such as a
// button's label, so they're hidden from screen readers.

import type { ComponentChildren } from "preact";

import type { Item } from "./item.ts";

function Icon({ children, class: className }: { children: ComponentChildren; class?: string }) {
  return (
    <svg class={className ? `icon ${className}` : "icon"} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

export const HomeIcon = () => (
  <Icon>
    <path d="M12 3.2 2.8 11h2.7v9h5v-6h3v6h5v-9h2.7z" fill="currentColor" />
  </Icon>
);

export const DriveIcon = () => (
  <Icon>
    <path
      d="M5 4h14l3 8v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6zm.9 2-2.2 6h16.6l-2.2-6zM4 14v4h16v-4zm12 1h2v2h-2z"
      fill="currentColor"
    />
  </Icon>
);

export const StarIcon = ({ filled = false }: { filled?: boolean }) => (
  <Icon class={filled ? "star filled" : "star"}>
    <path
      d="m12 3 2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 16.8l-5.4 2.9 1.1-6.1-4.5-4.2 6.1-.8z"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linejoin="round"
    />
  </Icon>
);

export const TrashIcon = () => (
  <Icon>
    <path d="M9 3h6l1 2h4v2H4V5h4zM6 8h12l-1 13H7zm3 2v9h2v-9zm4 0v9h2v-9z" fill="currentColor" />
  </Icon>
);

export const SearchIcon = () => (
  <Icon>
    <path
      d="M10 3a7 7 0 0 1 5.6 11.2l5.1 5.1-1.4 1.4-5.1-5.1A7 7 0 1 1 10 3m0 2a5 5 0 1 0 0 10 5 5 0 0 0 0-10"
      fill="currentColor"
    />
  </Icon>
);

export const ListIcon = () => (
  <Icon>
    <path d="M3 5h3v3H3zm5 0h13v3H8zm-5 5.5h3v3H3zm5 0h13v3H8zM3 16h3v3H3zm5 0h13v3H8z" fill="currentColor" />
  </Icon>
);

export const GridIcon = () => (
  <Icon>
    <path d="M3 3h8v8H3zm2 2v4h4V5zm8-2h8v8h-8zm2 2v4h4V5zM3 13h8v8H3zm2 2v4h4v-4zm8-2h8v8h-8zm2 2v4h4v-4z" fill="currentColor" />
  </Icon>
);

export const PlusIcon = () => (
  <Icon>
    <path d="M11 4h2v7h7v2h-7v7h-2v-7H4v-2h7z" fill="currentColor" />
  </Icon>
);

export const MoreIcon = () => (
  <Icon>
    <path d="M12 4a2 2 0 1 1 0 4 2 2 0 0 1 0-4m0 6a2 2 0 1 1 0 4 2 2 0 0 1 0-4m0 6a2 2 0 1 1 0 4 2 2 0 0 1 0-4" fill="currentColor" />
  </Icon>
);

export const MenuIcon = () => (
  <Icon>
    <path d="M3 6h18v2H3zm0 5h18v2H3zm0 5h18v2H3z" fill="currentColor" />
  </Icon>
);

export const ChevronIcon = () => (
  <Icon class="chevron">
    <path d="m9.5 6 6 6-6 6-1.4-1.4 4.6-4.6-4.6-4.6z" fill="currentColor" />
  </Icon>
);

export const CloseIcon = () => (
  <Icon>
    <path d="m6.4 5 5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4z" fill="currentColor" />
  </Icon>
);

export const CheckIcon = () => (
  <Icon>
    <path d="m9.5 16.2-4.2-4.2-1.4 1.4 5.6 5.6 11-11-1.4-1.4z" fill="currentColor" />
  </Icon>
);

export const CloudIcon = () => (
  <Icon>
    <path
      d="M12 5a6 6 0 0 1 5.9 5A4.5 4.5 0 0 1 17.5 19H7a5 5 0 0 1-.8-9.9A6 6 0 0 1 12 5m0 2a4 4 0 0 0-3.9 3.1l-.2.8-.8.1A3 3 0 0 0 7 17h10.5a2.5 2.5 0 0 0 .2-5l-1.6-.1-.2-1.6A4 4 0 0 0 12 7"
      fill="currentColor"
    />
  </Icon>
);

export const UploadFileIcon = () => (
  <Icon>
    <path d="M6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2m7 1.5V9h5.5zM11 19h2v-5h3l-4-4-4 4h3z" fill="currentColor" />
  </Icon>
);

export const UploadFolderIcon = () => (
  <Icon>
    <path d="M3 5a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zm8 13h2v-4h3l-4-4-4 4h3z" fill="currentColor" />
  </Icon>
);

export const NewFolderIcon = () => (
  <Icon>
    <path d="M3 5a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zm8 4v3H8v2h3v3h2v-3h3v-2h-3V9z" fill="currentColor" />
  </Icon>
);

/** The kinds of file that get their own icon and color, by extension.
 * They match the search filter's types in Drive's API. */
const KINDS: Record<string, readonly string[]> = {
  document: ["doc", "docx", "odt", "rtf", "txt", "md", "pages"],
  spreadsheet: ["xls", "xlsx", "ods", "csv", "tsv", "numbers"],
  presentation: ["ppt", "pptx", "odp", "key"],
  pdf: ["pdf"],
  image: ["jpg", "jpeg", "png", "gif", "webp", "heic", "heif", "avif", "bmp", "tif", "tiff", "svg", "dng", "raw"],
  video: ["mp4", "mov", "m4v", "mkv", "webm", "avi", "wmv", "3gp", "mts"],
  audio: ["mp3", "m4a", "aac", "wav", "flac", "ogg", "opus", "wma", "aiff"],
  archive: ["zip", "rar", "7z", "tar", "gz", "tgz", "bz2", "xz"],
};

/** What kind of item this is, for its icon: "folder", "file", or one of
 * the kinds above. */
export function kindOf(item: Pick<Item, "kind" | "name">): string {
  if (item.kind === "folder") return "folder";
  const dot = item.name.lastIndexOf(".");
  if (dot <= 0) return "file";
  const extension = item.name.slice(dot + 1).toLowerCase();
  return Object.keys(KINDS).find((kind) => KINDS[kind]!.includes(extension)) ?? "file";
}

const SHAPES: Record<string, ComponentChildren> = {
  folder: <path d="M2 6a2 2 0 0 1 2-2h5.2l2 2H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z" />,
  document: (
    <path d="M6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2m2 10v1.6h8V12zm0 3.4V17h8v-1.6zm0 3.4v1.6h5v-1.6z" />
  ),
  spreadsheet: (
    <path d="M6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2m1.5 9.5v8h9v-8zm1.5 1.5h2.2v1.8H9zm3.7 0H15v1.8h-2.3zM9 16.2h2.2V18H9zm3.7 0H15V18h-2.3z" />
  ),
  presentation: (
    <path d="M6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2m1.5 10v6.5h9V12zm1.5 1.5h6V17H9z" />
  ),
  pdf: (
    <path d="M6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2m1 11v5h1.4v-1.6h.8a1.7 1.7 0 0 0 0-3.4zm1.4 1.2h.8a.5.5 0 0 1 0 1h-.8zM11.3 13v5h1.4a2.5 2.5 0 0 0 0-5zm1.4 1.2h.1a1.3 1.3 0 0 1 0 2.6h-.1zM16 13v5h1.4v-2h1.4v-1.1h-1.4v-.7H19V13z" />
  ),
  image: (
    <path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2m3.5 4a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6M6 18h12l-3.8-5.2-3 3.9-2-2.4z" />
  ),
  video: (
    <path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2m5 5.5v7l5.5-3.5z" />
  ),
  audio: (
    <path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2m5.5 4v6.3A2.5 2.5 0 1 0 12 15.6V9.5h3V7z" />
  ),
  archive: (
    <path d="M6 2h12a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2m5 1v2h2V3zm0 2v2h-2v2h2v2h-2v2h2v2.5a1.5 1.5 0 1 0 2 0V13h-2v-2h2V9h-2V7h2V5z" />
  ),
  file: <path d="M6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2m7 1.5V9h5.5z" />,
};

/** An item's icon, colored by its kind. */
export function ItemIcon({ item }: { item: Pick<Item, "kind" | "name"> }) {
  const kind = kindOf(item);
  return (
    <svg class={`icon item-icon kind-${kind}`} viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="currentColor">
      {SHAPES[kind]}
    </svg>
  );
}

/** Accordion's mark: an accordion seen from the front, with its two ends
 * and the folded bellows between them. */
export const Logo = () => (
  <svg class="logo" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
    <rect x="2" y="5" width="7" height="22" rx="2.5" fill="var(--logo-end)" />
    <rect x="23" y="5" width="7" height="22" rx="2.5" fill="var(--logo-end)" />
    <path d="M9 8h3.5L14 24h-3.5zM12.5 8H16l1.5 16H14zM16 8h3.5L21 24h-3.5zM19.5 8H23v16h-2z" fill="var(--logo-folds)" />
    <path d="M12.5 8 14 24M16 8l1.5 16M19.5 8 21 24" stroke="var(--logo-crease)" stroke-width="1" />
  </svg>
);
