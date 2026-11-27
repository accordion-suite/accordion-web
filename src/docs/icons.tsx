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

/** A framed picture of a hill under the sun. */
export const PictureIcon = () => (
  <Icon>
    <rect x="3.5" y="5" width="17" height="14" rx="2" {...line} />
    <circle cx="9" cy="10" r="1.6" {...line} />
    <path d="m4 17.5 5-4.5 3.5 3 3-2.5 4.5 4" {...line} />
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

/** The letter A, for text color. The color shows in a bar under it. */
export const TextColorIcon = () => (
  <Icon>
    <path d="M7.5 16 12 4.5 16.5 16M9.2 11.8h5.6" {...line} />
  </Icon>
);

/** A highlighter pen, for highlight color. The color shows in a bar under
 * it. */
export const HighlightIcon = () => (
  <Icon>
    <path d="m14.5 4.5 4 4-7 7H7.5v-4Z M12.5 6.5l4 4M7.5 15.5l-2 2" {...line} />
  </Icon>
);

/** A T with a slash through it, for clearing formatting. */
export const ClearFormatIcon = () => (
  <Icon>
    <path d="M6 5.5h10M11 5.5 8.5 18.5M14.5 13.5l5 5M19.5 13.5l-5 5" {...line} />
  </Icon>
);

export const MinusIcon = () => (
  <Icon>
    <path d="M6 12h12" {...line} />
  </Icon>
);

export const PlusIcon = () => (
  <Icon>
    <path d="M6 12h12M12 6v12" {...line} />
  </Icon>
);

/** Lines lined up at the left, centered, at the right, or both sides. */
const alignLines = {
  left: "M4.5 6h15M4.5 10h10M4.5 14h15M4.5 18h10",
  center: "M4.5 6h15M7 10h10M4.5 14h15M7 18h10",
  right: "M4.5 6h15M9.5 10h10M4.5 14h15M9.5 18h10",
  justify: "M4.5 6h15M4.5 10h15M4.5 14h15M4.5 18h15",
} as const;

export const AlignIcon = ({ align }: { align: keyof typeof alignLines }) => (
  <Icon>
    <path d={alignLines[align]} {...line} />
  </Icon>
);

/** Lines with arrows up and down beside them: line spacing. */
export const LineSpacingIcon = () => (
  <Icon>
    <path d="M10.5 6h9M10.5 10h9M10.5 14h9M10.5 18h9M6 4.5v15M3.5 7 6 4.5 8.5 7M3.5 17 6 19.5 8.5 17" {...line} />
  </Icon>
);

/** Lines with an arrow into them or out of them. */
export const IndentMoreIcon = () => (
  <Icon>
    <path d="M4.5 5.5h15M11 10h8.5M11 14h8.5M4.5 18.5h15M4.5 9.5 7.5 12l-3 2.5" {...line} />
  </Icon>
);

export const IndentLessIcon = () => (
  <Icon>
    <path d="M4.5 5.5h15M11 10h8.5M11 14h8.5M4.5 18.5h15M7.5 9.5 4.5 12l3 2.5" {...line} />
  </Icon>
);

/** Two pages, one ending and the next starting: a page break. */
export const PageBreakIcon = () => (
  <Icon>
    <path d="M6 3.5v5h12v-5M6 20.5v-5h12v5M3.5 12h2.5M9 12h2M13 12h2M18 12h2.5" {...line} />
  </Icon>
);

/** A caret pointing up, for the match before, and down, for the next. */
export const UpIcon = () => (
  <Icon>
    <path d="m7 14.5 5-5 5 5" {...line} />
  </Icon>
);

export const DownIcon = () => (
  <Icon>
    <path d="m7 9.5 5 5 5-5" {...line} />
  </Icon>
);

/** Lines indented under one another: the document's outline. */
export const OutlineIcon = () => (
  <Icon>
    <path d="M4.5 6.5h15M8 12h11.5M11.5 17.5h8" {...line} />
  </Icon>
);

const bubble = "M5 5h14a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 19 17h-8.5l-4.5 3.5V17H5a1.5 1.5 0 0 1-1.5-1.5v-9A1.5 1.5 0 0 1 5 5Z";

/** A speech bubble with a plus: add a comment. */
export const CommentIcon = () => (
  <Icon>
    <path d={bubble} {...line} />
    <path d="M12 8v6M9 11h6" {...line} />
  </Icon>
);

/** A speech bubble with lines of text: the document's comments. */
export const CommentsIcon = () => (
  <Icon>
    <path d={bubble} {...line} />
    <path d="M8 9.5h8M8 12.5h5" {...line} />
  </Icon>
);

/** An arrow pointing left: back to the document from its history. */
export const BackIcon = () => (
  <Icon>
    <path d="M19 12H5.5M11 6l-6 6 6 6" {...line} />
  </Icon>
);
