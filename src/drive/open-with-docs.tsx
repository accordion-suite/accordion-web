// Open with Docs (decision 30): a new document from a Word file, a web
// page, Markdown, or plain text, as Google Drive's "Open with Google Docs".
// The file stays as it is. Docs reads it in the server's sandbox and makes
// the document beside it, or in the reader's own Docs if they can't add
// there. When something in the file won't come across, such as text boxes
// or tracked changes, Docs says what first and asks.
//
// This lives in Drive's code rather than the editor's, so Drive doesn't
// load the editor to offer it.

import type { VNode } from "preact";
import { useState } from "preact/hooks";

import { api } from "../api.ts";
import { t, type MessageKey } from "../i18n.ts";
import { ConfirmDialog } from "../shell/dialog.tsx";
import { navigate } from "../shell/router.ts";
import type { Item } from "./item.ts";
import type { Notice } from "./layout.tsx";

/** The files Docs opens, by their names, as the server's list has them. */
const OPENS = /^[^.].*\.(docx|docm|dotx|dotm|html?|xhtml|md|markdown|txt)$/i;

export function opensWithDocs(item: Pick<Item, "kind" | "name">): boolean {
  return item.kind === "file" && OPENS.test(item.name);
}

/** What didn't come across, as the server reports it. */
type Lost =
  | "tracked_changes"
  | "comments"
  | "text_boxes"
  | "shapes"
  | "equations"
  | "pictures"
  | "pictures_moved"
  | "fields"
  | "endnotes"
  | "columns"
  | "sections"
  | "even_pages"
  | "tabs";

interface FontReplaced {
  from: string;
  to: string;
  kind: "same" | "like" | "other";
}

interface Report {
  lost: Lost[];
  fonts: FontReplaced[];
  paper: string | null;
}

interface Imported {
  document: { id: string; name: string } | null;
  report: Report;
}

const LOST: Record<Lost, MessageKey> = {
  tracked_changes: "openWith.trackedChanges",
  comments: "openWith.comments",
  text_boxes: "openWith.textBoxes",
  shapes: "openWith.shapes",
  equations: "openWith.equations",
  pictures: "openWith.pictures",
  pictures_moved: "openWith.picturesMoved",
  fields: "openWith.fields",
  endnotes: "openWith.endnotes",
  columns: "openWith.columns",
  sections: "openWith.sections",
  even_pages: "openWith.evenPages",
  tabs: "openWith.tabs",
};

const FONTS: Record<FontReplaced["kind"], MessageKey> = {
  same: "openWith.fontSame",
  like: "openWith.fontLike",
  other: "openWith.fontOther",
};

/** Paper sizes' names, which are the same in every language. */
const PAPER: Record<string, string> = {
  letter: "Letter",
  a4: "A4",
  legal: "Legal",
  a5: "A5",
  a3: "A3",
  tabloid: "Tabloid",
};

/** Where the editor finds the fonts a new document's file named, to say
 * which Docs used in their place, as it does for a paste. */
export function importedFontsKey(id: string): string {
  return `accordion.docs.importedFonts.${id}`;
}

export function useOpenWithDocs(notify: (notice: Notice | null) => void): {
  open(item: Item): Promise<void>;
  dialog: VNode | null;
} {
  const [asking, setAsking] = useState<{ item: Item; report: Report } | null>(null);

  function opened(made: Imported) {
    const document = made.document!;
    try {
      if (made.report.fonts.length) {
        sessionStorage.setItem(importedFontsKey(document.id), JSON.stringify(made.report.fonts));
      }
    } catch {
      // The editor says nothing about fonts then.
    }
    navigate(`/docs/d/${document.id}`);
  }

  async function open(item: Item) {
    try {
      // A document already opens in Docs as it is.
      if (/\.html$/i.test(item.name)) {
        const isDocument = await api("GET", `/api/docs/documents/${item.id}`).then(
          () => true,
          () => false,
        );
        if (isDocument) {
          navigate(`/docs/d/${item.id}`);
          return;
        }
      }
      notify({ message: t("openWith.opening", { name: item.name }) });
      const made = await api<Imported>("POST", "/api/docs/imports", { item: item.id });
      if (made.document) {
        opened(made);
      } else {
        notify(null);
        setAsking({ item, report: made.report });
      }
    } catch (problem) {
      notify({ message: problem instanceof Error ? problem.message : t("error.problem"), problem: true });
    }
  }

  let dialog: VNode | null = null;
  if (asking) {
    const { item, report } = asking;
    const lines = [
      ...report.lost.filter((lost) => lost in LOST).map((lost) => t(LOST[lost])),
      ...(report.paper ? [t("openWith.paper", { paper: PAPER[report.paper] ?? report.paper })] : []),
    ];
    dialog = (
      <ConfirmDialog
        title={t("openWith.title", { name: item.name })}
        safe
        body={
          <>
            <p>{t("openWith.intro")}</p>
            <ul class="open-with-lost">
              {lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            {report.fonts.length > 0 && (
              <>
                <p>{t("openWith.fontsIntro")}</p>
                <ul class="open-with-lost">
                  {report.fonts.map((font) => (
                    <li key={font.from}>{t(FONTS[font.kind], { from: font.from, to: font.to })}</li>
                  ))}
                </ul>
              </>
            )}
            <p>{t("openWith.original")}</p>
          </>
        }
        confirm={t("openWith.confirm")}
        onConfirm={async () => {
          const made = await api<Imported>("POST", "/api/docs/imports", { item: item.id, confirmed: true });
          setAsking(null);
          opened(made);
        }}
        onClose={() => setAsking(null)}
      />
    );
  }
  return { open, dialog };
}
