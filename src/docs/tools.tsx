// Docs' tools (decision 30, step 3, part 3): find and replace, word count,
// and the list of keyboard shortcuts.

import type { Command, EditorState } from "prosemirror-state";
import { useEffect, useRef, useState } from "preact/hooks";

import { CloseIcon } from "../drive/icons.tsx";
import { type ShortcutGroup, ShortcutsDialog } from "../drive/dialogs.tsx";
import { formatNumber, t } from "../i18n.ts";
import { Dialog } from "../shell/dialog.tsx";
import { saveTyping, typing, type TypingPreferences } from "./autoformat.ts";
import { countDocument } from "./counts.ts";
import { findCount, findStep, replaceAll, replaceMatch, setSearch } from "./find.ts";
import { DownIcon, UpIcon } from "./icons.tsx";

/** The find panel at the top right of the document, as in Google Docs. It
 * stays open while you edit, and Esc closes it, leaving the caret on the
 * match. Viewers can find, and editors can also replace. */
export function FindBar({
  state,
  readOnly,
  initial,
  focusRequest,
  apply,
  onClose,
}: {
  state: EditorState;
  readOnly: boolean;
  /** What to look for at first, such as the selected words. */
  initial: string;
  /** Changes each time Ctrl+F asks for the panel again. */
  focusRequest: number;
  /** Runs a command on the document without moving focus to it. */
  apply: (command: Command) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState(initial);
  const [matchCase, setMatchCase] = useState(false);
  const [replacement, setReplacement] = useState("");
  const [replaced, setReplaced] = useState<number | null>(null);
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    field.current?.focus();
    field.current?.select();
  }, [focusRequest]);

  useEffect(() => {
    apply(setSearch(query, matchCase));
  }, [query, matchCase]);

  // The highlights go when the panel does.
  useEffect(() => () => apply(setSearch("", false)), []);

  const { current, total } = findCount(state);
  const said =
    replaced !== null
      ? t("docs.findReplaced", { count: replaced })
      : !query
        ? ""
        : total === 0
          ? t("docs.findNone")
          : current
            ? t("docs.findCount", { current: formatNumber(current), total: formatNumber(total) })
            : t("docs.findTotal", { count: total });

  function step(direction: 1 | -1) {
    setReplaced(null);
    apply(findStep(direction));
  }

  return (
    <div
      class="docs-find"
      role="search"
      aria-label={readOnly ? t("docs.find") : t("docs.findReplace")}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        onClose();
      }}
    >
      <div class="docs-find-row">
        <input
          ref={field}
          class="docs-find-field"
          value={query}
          placeholder={t("docs.findPlaceholder")}
          aria-label={t("docs.find")}
          aria-describedby="docs-find-count"
          autocomplete="off"
          spellcheck={false}
          onInput={(event) => {
            setReplaced(null);
            setQuery(event.currentTarget.value);
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            step(event.shiftKey ? -1 : 1);
          }}
        />
        <span id="docs-find-count" class="docs-find-count" aria-live="polite">
          {said}
        </span>
        <button
          type="button"
          class="icon-button"
          aria-label={t("docs.findPrevious")}
          title={t("docs.findPrevious")}
          disabled={!total}
          onClick={() => step(-1)}
        >
          <UpIcon />
        </button>
        <button
          type="button"
          class="icon-button"
          aria-label={t("docs.findNext")}
          title={t("docs.findNext")}
          disabled={!total}
          onClick={() => step(1)}
        >
          <DownIcon />
        </button>
        <button type="button" class="icon-button" aria-label={t("dialog.close")} title={t("dialog.close")} onClick={onClose}>
          <CloseIcon />
        </button>
      </div>
      <label class="choice docs-find-case">
        <input type="checkbox" checked={matchCase} onChange={(event) => setMatchCase(event.currentTarget.checked)} />
        {t("docs.findMatchCase")}
      </label>
      {!readOnly && (
        <>
          <input
            class="docs-find-field"
            value={replacement}
            placeholder={t("docs.replacePlaceholder")}
            aria-label={t("docs.replaceWith")}
            autocomplete="off"
            spellcheck={false}
            onInput={(event) => setReplacement(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              setReplaced(null);
              apply(replaceMatch(replacement));
            }}
          />
          <div class="docs-find-buttons">
            <button
              type="button"
              class="secondary"
              disabled={!total}
              onClick={() => {
                setReplaced(null);
                apply(replaceMatch(replacement));
              }}
            >
              {t("docs.replace")}
            </button>
            <button
              type="button"
              class="secondary"
              disabled={!total}
              onClick={() => {
                setReplaced(total);
                apply(replaceAll(replacement));
              }}
            >
              {t("docs.replaceAll")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** Shows how many words and characters the document has, and the
 * selection's out of them, as Google Docs does. */
export function WordCountDialog({
  state,
  showing,
  onShow,
  onClose,
}: {
  state: EditorState;
  /** Whether the count shows at the bottom of the page while you type. */
  showing: boolean;
  onShow: (show: boolean) => void;
  onClose: () => void;
}) {
  const whole = countDocument(state.doc);
  const { from, to, empty } = state.selection;
  const part = empty ? null : countDocument(state.doc, from, to);
  const shown = (key: "words" | "characters" | "letters") =>
    part ? t("docs.countOf", { part: formatNumber(part[key]), whole: formatNumber(whole[key]) }) : formatNumber(whole[key]);
  return (
    <Dialog title={t("docs.wordCount")} class="docs-count-dialog" onClose={onClose}>
      <table class="docs-counts">
        <tbody>
          <tr>
            <th scope="row">{t("docs.countWords")}</th>
            <td>{shown("words")}</td>
          </tr>
          <tr>
            <th scope="row">{t("docs.countCharacters")}</th>
            <td>{shown("characters")}</td>
          </tr>
          <tr>
            <th scope="row">{t("docs.countLetters")}</th>
            <td>{shown("letters")}</td>
          </tr>
        </tbody>
      </table>
      {part && <p class="hint">{t("docs.countSelection")}</p>}
      <label class="choice">
        <input type="checkbox" checked={showing} onChange={(event) => onShow(event.currentTarget.checked)} />
        {t("docs.countWhileTyping")}
      </label>
      <div class="dialog-buttons">
        <button type="button" onClick={onClose}>
          {t("dialog.close")}
        </button>
      </div>
    </Dialog>
  );
}

/** The count at the bottom of the page while you type. Selecting it opens
 * the word count. */
export function WordCountBadge({ state, onOpen }: { state: EditorState; onOpen: () => void }) {
  const whole = countDocument(state.doc).words;
  const { from, to, empty } = state.selection;
  const text = empty
    ? t("docs.countBadge", { count: whole })
    : t("docs.countBadgeOf", {
        part: formatNumber(countDocument(state.doc, from, to).words),
        whole: formatNumber(whole),
      });
  return (
    <button type="button" class="docs-count-badge" onClick={onOpen}>
      {text}
    </button>
  );
}

const SHOW_COUNT = "accordion.docs.wordCount";

/** Whether this browser shows the word count while typing. It's only a
 * convenience, so it's kept in the browser, and a browser that won't keep
 * it leaves the count off. */
export function readShowCount(): boolean {
  try {
    return localStorage.getItem(SHOW_COUNT) === "on";
  } catch {
    return false;
  }
}

export function saveShowCount(show: boolean) {
  try {
    if (show) localStorage.setItem(SHOW_COUNT, "on");
    else localStorage.removeItem(SHOW_COUNT);
  } catch {
    // The choice lasts until the page closes.
  }
}

/** Tools > Preferences: what changes as you type, as in Google Docs. Each
 * choice applies at once. */
export function PreferencesDialog({ onClose }: { onClose: () => void }) {
  const [chosen, setChosen] = useState({ ...typing });
  const choose = (change: Partial<TypingPreferences>) =>
    setChosen((now) => {
      const next = { ...now, ...change };
      saveTyping(next);
      return next;
    });
  return (
    <Dialog title={t("docs.preferences")} class="docs-preferences" onClose={onClose}>
      <fieldset class="choices">
        <label class="choice">
          <input
            type="checkbox"
            checked={chosen.smartQuotes}
            onChange={(event) => choose({ smartQuotes: event.currentTarget.checked })}
          />
          <span class="choice-text">
            <strong>{t("docs.smartQuotes")}</strong>
            <span class="hint">{t("docs.smartQuotesHint")}</span>
          </span>
        </label>
        <label class="choice">
          <input
            type="checkbox"
            checked={chosen.autoLinks}
            onChange={(event) => choose({ autoLinks: event.currentTarget.checked })}
          />
          <span class="choice-text">
            <strong>{t("docs.autoLinks")}</strong>
            <span class="hint">{t("docs.autoLinksHint")}</span>
          </span>
        </label>
      </fieldset>
      <p class="hint">{t("docs.preferencesHint")}</p>
      <div class="dialog-buttons">
        <button type="button" onClick={onClose}>
          {t("dialog.close")}
        </button>
      </div>
    </Dialog>
  );
}

/** Docs' keyboard shortcuts, which follow Google Docs'. */
export function DocsShortcutsDialog({ readOnly, onClose }: { readOnly: boolean; onClose: () => void }) {
  const general: ShortcutGroup = {
    title: t("docs.keysGeneral"),
    shortcuts: [
      ["Ctrl+/", t("docs.keysShortcuts")],
      [readOnly ? "Ctrl+F" : { or: ["Ctrl+F", "Ctrl+H"] }, readOnly ? t("docs.find") : t("docs.findReplace")],
      ["Ctrl+Shift+C", t("docs.wordCount")],
      [t("docs.openShortcut"), t("docs.keysOpen")],
      [t("docs.printShortcut"), t("docs.keysPrint")],
      [t("docs.copyShortcut"), t("docs.copy")],
      [t("docs.selectAllShortcut"), t("docs.selectAll")],
    ],
  };
  if (readOnly) return <ShortcutsDialog groups={[general]} onClose={onClose} />;
  const groups: ShortcutGroup[] = [
    {
      ...general,
      shortcuts: [
        ...general.shortcuts,
        [t("docs.undoShortcut"), t("docs.undo")],
        [{ or: [t("docs.redoShortcut"), "Ctrl+Shift+Z"] }, t("docs.redo")],
        [t("docs.cutShortcut"), t("docs.cut")],
        [t("docs.pasteShortcut"), t("docs.paste")],
        [t("docs.pastePlainShortcut"), t("docs.pastePlain")],
      ],
    },
    {
      title: t("docs.keysText"),
      shortcuts: [
        [t("docs.boldShortcut"), t("docs.bold")],
        [t("docs.italicShortcut"), t("docs.italic")],
        [t("docs.underlineShortcut"), t("docs.underline")],
        [t("docs.strikeShortcut"), t("docs.strike")],
        [t("docs.superscriptShortcut"), t("docs.superscript")],
        [t("docs.subscriptShortcut"), t("docs.subscript")],
        [t("docs.inlineCodeShortcut"), t("docs.keysCode")],
        [t("docs.largerShortcut"), t("docs.larger")],
        [t("docs.smallerShortcut"), t("docs.smaller")],
        [t("docs.linkShortcut"), t("docs.keysLink")],
        [t("docs.clearFormattingShortcut"), t("docs.clearFormatting")],
      ],
    },
    {
      title: t("docs.keysParagraphs"),
      shortcuts: [
        [t("docs.styleShortcut", { key: 0 }), t("docs.styleNormal")],
        [t("docs.styleShortcut", { key: "1–6" }), t("docs.keysHeadings")],
        [t("docs.alignLeftShortcut"), t("docs.alignLeftLong")],
        [t("docs.alignCenterShortcut"), t("docs.alignCenterLong")],
        [t("docs.alignRightShortcut"), t("docs.alignRightLong")],
        [t("docs.alignJustifyShortcut"), t("docs.alignJustifyLong")],
        [t("docs.indentMoreShortcut"), t("docs.indentMore")],
        [t("docs.indentLessShortcut"), t("docs.indentLess")],
        ["Ctrl+Shift+7", t("docs.numbers")],
        ["Ctrl+Shift+8", t("docs.bullets")],
        [t("docs.checklistShortcut"), t("docs.checklist")],
        [{ or: ["Tab", "Shift+Tab"] }, t("docs.keysListLevel")],
        ["Shift+Enter", t("docs.keysLineBreak")],
        [t("docs.pageBreakShortcut"), t("docs.pageBreak")],
        [t("docs.footnoteShortcut"), t("docs.footnote")],
        [t("docs.altTextShortcut"), t("docs.keysAltText")],
      ],
    },
    {
      title: t("docs.keysTyping"),
      shortcuts: [
        [{ then: ["#", "Space"] }, t("docs.keysTypeHeading")],
        [{ then: ["-", "Space"] }, t("docs.bullets")],
        [{ then: ["1.", "Space"] }, t("docs.numbers")],
        [{ then: ["[]", "Space"] }, t("docs.checklist")],
        [{ then: [">", "Space"] }, t("docs.quote")],
        ["```", t("docs.keysTypeCode")],
        ["---", t("docs.rule")],
      ],
    },
  ];
  return <ShortcutsDialog groups={groups} onClose={onClose} />;
}
