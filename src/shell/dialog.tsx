// A modal dialog, built on the browser's own <dialog>, which keeps keyboard
// focus inside it and closes on Escape.

import type { ComponentChildren } from "preact";
import { useEffect, useId, useRef } from "preact/hooks";

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
    // closes, so keyboard users carry on from there.
    const opener = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => opener?.focus();
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
