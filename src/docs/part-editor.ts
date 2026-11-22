// An open header or footer (decision 30, step 4): its editor, shown in its
// sheet's margin (pages.ts), with its options.

import type { EditorView } from "prosemirror-view";
import * as Y from "yjs";

import type { LiveDocument } from "../shell/coedit.ts";
import { t } from "../i18n.ts";
import { createPartEditor } from "./editor.ts";
import type { PartKind } from "./pages.ts";
import { blank, differentFirst, partName, removePart, setDifferentFirst } from "./parts.ts";

/** An open header or footer: its editor, in an element the sheet's margin
 * shows, with its options under it. */
export class PartEditor {
  readonly element: HTMLElement;
  readonly view: EditorView;
  readonly name: string;

  constructor(
    readonly kind: PartKind,
    readonly sheet: number,
    private live: LiveDocument,
    options: {
      onChange: () => void;
      onLink: () => void;
      onClose: () => void;
      pictureAddress: (hash: string) => string;
    },
  ) {
    const doc = live.doc;
    const first = sheet === 0 && differentFirst(doc);
    this.name = partName(kind, first);
    const fragment = doc.getXmlFragment(this.name);
    // A new header starts with an empty line to type on.
    if (!fragment.length) fragment.insert(0, [new Y.XmlElement("paragraph")]);
    this.element = document.createElement("div");
    this.element.className = "docs-part-editing";
    const text = document.createElement("div");
    text.className = "docs-part-text";
    this.element.append(text);
    this.view = createPartEditor(text, live, this.name, options);

    const bar = document.createElement("div");
    bar.className = "docs-part-bar";
    const label = document.createElement("span");
    label.className = "docs-part-label";
    label.textContent = t(first ? (kind === "header" ? "docs.firstHeader" : "docs.firstFooter") : kind === "header" ? "docs.header" : "docs.footer");
    const choice = document.createElement("label");
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = differentFirst(doc);
    box.addEventListener("change", () => {
      setDifferentFirst(doc, box.checked);
      options.onClose();
    });
    choice.append(box, t("docs.differentFirstPage"));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "link";
    remove.textContent = t(kind === "header" ? "docs.removeHeader" : "docs.removeFooter");
    remove.addEventListener("click", () => {
      removePart(doc, this.name);
      options.onClose();
    });
    // Clicks on the options keep the editor open.
    bar.addEventListener("mousedown", (event) => event.stopPropagation());
    bar.append(label, choice, remove);
    this.element.append(bar);
  }

  /** Closes the editor. A part left empty goes, as in Google Docs. */
  close() {
    this.view.destroy();
    const fragment = this.live.doc.getXmlFragment(this.name);
    if (fragment.length && blank(fragment)) removePart(this.live.doc, this.name);
  }
}
