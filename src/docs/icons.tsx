// Docs' icons, drawn like Drive's and Notes': 24 units square, in the
// color of the text around them, and hidden from screen readers, since
// their labels say what they mean.

import { Icon } from "../drive/icons.tsx";

const line = { fill: "none", stroke: "currentColor", "stroke-width": "1.8", "stroke-linecap": "round", "stroke-linejoin": "round" } as const;

/** A page with lines of text: Docs, and a document. */
export const DocIcon = () => (
  <Icon>
    <path d="M7 3.5h7.5l4 4V19a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 19V5A1.5 1.5 0 0 1 7 3.5Z" {...line} />
    <path d="M14.5 3.5v4h4M8.5 11.5h7M8.5 14.5h7M8.5 17.5h4.5" {...line} />
  </Icon>
);

export const UndoIcon = () => (
  <Icon>
    <path d="M9 7.5 5 11.5l4 4M5.5 11.5H15a4 4 0 0 1 0 8h-3" {...line} />
  </Icon>
);

export const RedoIcon = () => (
  <Icon>
    <path d="m15 7.5 4 4-4 4M18.5 11.5H9a4 4 0 0 0 0 8h3" {...line} />
  </Icon>
);

export const BoldIcon = () => (
  <Icon>
    <path d="M7.5 5h5.25a3.5 3.5 0 0 1 0 7H7.5ZM7.5 12h6.25a3.5 3.5 0 0 1 0 7H7.5Z" {...line} stroke-width="2.2" />
  </Icon>
);

export const ItalicIcon = () => (
  <Icon>
    <path d="M10 5h7M7 19h7M13.5 5l-3 14" {...line} />
  </Icon>
);

export const UnderlineIcon = () => (
  <Icon>
    <path d="M7 4.5v6a5 5 0 0 0 10 0v-6M5.5 20h13" {...line} />
  </Icon>
);

export const StrikeIcon = () => (
  <Icon>
    <path d="M16.5 7.5c-.6-1.8-2.3-3-4.5-3-2.6 0-4.5 1.5-4.5 3.5 0 1.4.8 2.4 2.5 3M4.5 12h15M8 16.5c.6 1.8 2.3 3 4.5 3 2.6 0 4.5-1.5 4.5-3.5 0-.8-.3-1.5-.8-2" {...line} />
  </Icon>
);

export const CodeIcon = () => (
  <Icon>
    <path d="m8.5 7.5-4.5 4.5 4.5 4.5M15.5 7.5l4.5 4.5-4.5 4.5" {...line} />
  </Icon>
);

export const LinkIcon = () => (
  <Icon>
    <path d="M10.5 13.5a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1 1M13.5 10.5a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5l1-1" {...line} />
  </Icon>
);

export const BulletsIcon = () => (
  <Icon>
    <path d="M10 6.5h10M10 12h10M10 17.5h10" {...line} />
    <circle cx="5.5" cy="6.5" r="1.3" fill="currentColor" />
    <circle cx="5.5" cy="12" r="1.3" fill="currentColor" />
    <circle cx="5.5" cy="17.5" r="1.3" fill="currentColor" />
  </Icon>
);

export const NumbersIcon = () => (
  <Icon>
    <path d="M10 6.5h10M10 12h10M10 17.5h10M4.5 5l1.5-1v5M4.5 11.5c.4-.6 1-.9 1.6-.9.8 0 1.4.5 1.4 1.2 0 1.1-3 2.2-3 3.7h3" {...line} stroke-width="1.5" />
  </Icon>
);

export const ChecklistIcon = () => (
  <Icon>
    <rect x="3.5" y="4.5" width="5" height="5" rx="1" {...line} />
    <rect x="3.5" y="14.5" width="5" height="5" rx="1" {...line} />
    <path d="M12 7h8.5M12 17h8.5M4.8 17l1.2 1.2 2.2-2.4" {...line} />
  </Icon>
);

export const QuoteIcon = () => (
  <Icon>
    <path d="M6 18.5V12h4.5v4.5L8.5 18.5M14 18.5V12h4.5v4.5l-2 2M6 12c0-3 1.5-5 4-6M14 12c0-3 1.5-5 4-6" {...line} />
  </Icon>
);

export const RuleIcon = () => (
  <Icon>
    <path d="M4 12h16M7 7.5h10M7 16.5h10" {...line} stroke-opacity="1" />
  </Icon>
);

export const TableIcon = () => (
  <Icon>
    <rect x="3.5" y="4.5" width="17" height="15" rx="1.5" {...line} />
    <path d="M3.5 9.5h17M3.5 14.5h17M9.5 9.5v10M15 9.5v10" {...line} />
  </Icon>
);
