// A modal dialog, built on the browser's own <dialog>, which keeps keyboard
// focus inside it and closes on Escape, and one that asks before an action.

import type { ComponentChildren } from "preact";
import { useEffect, useId, useRef, useState } from "preact/hooks";

import { t } from "../i18n.ts";

/** What to show for a failure: the server's own message, or a general one. */
export function problemText(problem: unknown): string {
  return problem instanceof Error ? problem.message : t("error.problem");
}

// Whether the reader last used the keyboard, rather than a mouse or touch.
let usingKeyboard = false;
addEventListener("keydown", () => (usingKeyboard = true), true);
addEventListener("pointerdown", () => (usingKeyboard = false), true);

/** Whether a press on the dialog itself landed on the dimmed page around
 * it. A press on the dialog's own padding has the dialog as its target too,
 * so its box decides. */
function onBackdrop(dialog: HTMLDialogElement | null, event: MouseEvent): boolean {
  if (!dialog || event.target !== dialog) return false;
  const box = dialog.getBoundingClientRect();
  return event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom;
}

/** A modal dialog. With `closeOutside`, a click on the page around it
 * closes it, for dialogs that keep what's typed, such as a note. */
export function Dialog({
  title,
  class: className,
  closeOutside = false,
  onClose,
  children,
}: {
  title: string;
  class?: string;
  closeOutside?: boolean;
  onClose: () => void;
  children: ComponentChildren;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  // Whether the press started outside too, so selecting text and letting go
  // past the dialog's edge doesn't close it. A press while a menu is open
  // only closes the menu. Menus close as the press starts, so this looks
  // first, from the window.
  const pressedOutside = useRef(false);
  useEffect(() => {
    if (!closeOutside) return;
    const pressed = (event: PointerEvent) => {
      pressedOutside.current = onBackdrop(dialog.current, event) && !dialog.current?.querySelector("[role=menu]");
    };
    addEventListener("pointerdown", pressed, true);
    return () => removeEventListener("pointerdown", pressed, true);
  }, [closeOutside]);

  useEffect(() => {
    // Focus goes back to what opened the dialog, such as a button, when it
    // closes, so keyboard users carry on from there. Firefox only outlines
    // it when asked, so a dialog closed by keyboard asks.
    const opener = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => opener?.focus({ focusVisible: usingKeyboard });
  }, []);

  return (
    <dialog
      ref={dialog}
      class={className}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={
        closeOutside
          ? (event) => {
              if (pressedOutside.current && onBackdrop(dialog.current, event)) onClose();
              pressedOutside.current = false;
            }
          : undefined
      }
    >
      <h2 id={titleId}>{title}</h2>
      {children}
    </dialog>
  );
}

/** Asks before an action, such as emptying the trash. Its button is red
 * unless `safe`, for actions that can be undone, such as making someone an
 * admin. */
export function ConfirmDialog({
  title,
  body,
  confirm,
  safe = false,
  onConfirm,
  onClose,
}: {
  title: string;
  body: ComponentChildren;
  confirm: string;
  safe?: boolean;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function go() {
    setBusy(true);
    setError("");
    try {
      await onConfirm();
    } catch (problem) {
      setError(problemText(problem));
      setBusy(false);
    }
  }

  return (
    <Dialog title={title} onClose={onClose}>
      {typeof body === "string" ? <p>{body}</p> : body}
      <p class="error" role="alert">
        {error}
      </p>
      <div class="dialog-buttons">
        <button type="button" class={safe ? undefined : "danger"} disabled={busy} onClick={go}>
          {confirm}
        </button>
        {/* Focus starts on the safe choice. */}
        <button type="button" class="secondary" autofocus onClick={onClose}>
          {t("dialog.cancel")}
        </button>
      </div>
    </Dialog>
  );
}
