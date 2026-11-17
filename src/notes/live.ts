// Editing a shared note together (decisions 30 and 31), over the shared
// co-editing connection in shell/coedit.ts.

import * as Y from "yjs";

import { LiveDocument, type LiveStatus, userOf, type Visitor } from "../shell/coedit.ts";
import { textChange } from "./text-change.ts";

export { caretColor, type LiveStatus, type Visitor } from "../shell/coedit.ts";

/** Someone else's caret, as an offset in the body. */
export interface RemoteCaret extends Visitor {
  /** Their awareness client, which tells carets apart. */
  client: number;
  at: number;
}

/** A shared note's document, live while it's open. */
export class LiveNote extends LiveDocument {
  readonly body = this.doc.getText("body");
  /** What everyone sees the note as, which only the browsers use: the
   * server writes only the front matter and the body. `checkboxes` is
   * set once someone shows or hides checkboxes, so everyone switches. */
  readonly view = this.doc.getMap<boolean>("view");

  constructor(id: string, me: { name: string }, onStatus: (status: LiveStatus) => void) {
    super(`/api/notes/notes/${id}/live`, `/api/notes/notes/${id}`, me, onStatus);
  }

  /** Where the others' carets are, as offsets in the body. */
  carets(): RemoteCaret[] {
    const carets: RemoteCaret[] = [];
    this.awareness.getStates().forEach((state, client) => {
      const user = userOf(state);
      const head = (state as { cursor?: { head?: unknown } }).cursor?.head;
      if (client === this.doc.clientID || !user || !head) return;
      try {
        const at = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(head), this.doc);
        if (at && at.type === this.body) carets.push({ ...user, client, at: at.index });
      } catch {
        // Someone else's state that doesn't read as a position.
      }
    });
    return carets;
  }

  /** Tells the others where the reader's caret is, as an offset in the
   * body, or that it's not in the note. */
  setCaret(at: { start: number; end: number } | null): void {
    const position = (index: number) =>
      Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(this.body, index)) as unknown;
    const cursor = at && { anchor: position(at.start), head: position(at.end) };
    const current = (this.awareness.getLocalState() as { cursor?: unknown } | null)?.cursor ?? null;
    if (JSON.stringify(current) === JSON.stringify(cursor)) return;
    this.awareness.setLocalStateField("cursor", cursor);
  }

  /** Whether everyone sees checkboxes, once someone chose. */
  checkboxes(): boolean | undefined {
    return this.view.get("checkboxes");
  }

  /** Changes the body to `text` with the fewest edits, so others' typing
   * elsewhere in it stays. */
  setBody(text: string, checkboxes?: boolean): void {
    const change = textChange(this.body.toString(), text);
    const switched = checkboxes !== undefined && this.view.get("checkboxes") !== checkboxes;
    if (!change && !switched) return;
    // One change, so the others get the new text and the switch together.
    this.doc.transact(() => {
      if (change && change.removed > 0) this.body.delete(change.start, change.removed);
      if (change?.inserted) this.body.insert(change.start, change.inserted);
      if (switched) this.view.set("checkboxes", checkboxes);
    });
  }
}
