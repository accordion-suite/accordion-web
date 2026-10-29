// A modal dialog, built on the browser's own <dialog>, which keeps keyboard
// focus inside it and closes on Escape.

import type { ComponentChildren } from "preact";
import { useEffect, useId, useRef } from "preact/hooks";

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
