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

export function Dialog({
  title,
  class: className,
  onClose,
  children,
}: {
  title: string;
  class?: string;
  onClose: () => void;
  children: ComponentChildren;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();

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
