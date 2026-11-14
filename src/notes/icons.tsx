// Notes' icons, drawn like Drive's: 24 units square, in the color of the
// text around them, and hidden from screen readers, since their labels say
// what they mean.

import { Icon } from "../drive/icons.tsx";

const line = { fill: "none", stroke: "currentColor", "stroke-width": "1.8", "stroke-linecap": "round", "stroke-linejoin": "round" } as const;

export const NoteIcon = () => (
  <Icon>
    <path d="M6 3.5h12a1.5 1.5 0 0 1 1.5 1.5v9.5l-5 5H6A1.5 1.5 0 0 1 4.5 18V5A1.5 1.5 0 0 1 6 3.5Z" {...line} />
    <path d="M19.5 14.5h-4a1 1 0 0 0-1 1v4M8 8h8M8 11.5h5" {...line} />
  </Icon>
);

export const PinIcon = ({ filled = false }: { filled?: boolean }) => (
  <Icon>
    <path
      d="M15 3.5 20.5 9l-2.2.6-3.6 3.6.3 4.4-1.6 1.6-3.4-3.4L5 20l3.8-5-3.4-3.4L7 10l4.4.3L15 6.7Z"
      {...line}
      fill={filled ? "currentColor" : "none"}
    />
  </Icon>
);

export const PaletteIcon = () => (
  <Icon>
    <path d="M12 3.5a8.5 8.5 0 0 0 0 17c1.2 0 1.8-.8 1.8-1.6 0-1.2-1-1.4-1-2.5 0-.9.7-1.6 1.6-1.6h2.1a4 4 0 0 0 4-4c0-4.2-3.8-7.3-8.5-7.3Z" {...line} />
    <circle cx="7.8" cy="11.5" r="1.2" fill="currentColor" />
    <circle cx="10.5" cy="7.6" r="1.2" fill="currentColor" />
    <circle cx="15" cy="8" r="1.2" fill="currentColor" />
  </Icon>
);

export const ArchiveIcon = () => (
  <Icon>
    <rect x="3.5" y="4.5" width="17" height="4" rx="1" {...line} />
    <path d="M5 8.5v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-10M10 12.5h4" {...line} />
  </Icon>
);

export const LabelIcon = () => (
  <Icon>
    <path d="M4.5 5.5h10l5 6.5-5 6.5h-10Z" {...line} />
  </Icon>
);

export const ChecklistIcon = () => (
  <Icon>
    <rect x="3.5" y="4.5" width="15" height="15" rx="2" {...line} />
    <path d="m7.5 12 2.5 2.5 5-5" {...line} />
  </Icon>
);

export const EditIcon = () => (
  <Icon>
    <path d="M4.5 19.5h4l10-10-4-4-10 10Zm9-13 4 4" {...line} />
  </Icon>
);

export const NoColorIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="8" {...line} />
    <path d="m6.5 6.5 11 11" {...line} />
  </Icon>
);

export const DragIcon = () => (
  <Icon>
    <circle cx="9" cy="7" r="1.3" fill="currentColor" />
    <circle cx="15" cy="7" r="1.3" fill="currentColor" />
    <circle cx="9" cy="12" r="1.3" fill="currentColor" />
    <circle cx="15" cy="12" r="1.3" fill="currentColor" />
    <circle cx="9" cy="17" r="1.3" fill="currentColor" />
    <circle cx="15" cy="17" r="1.3" fill="currentColor" />
  </Icon>
);
