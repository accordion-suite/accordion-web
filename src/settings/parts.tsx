// Pieces that Settings' sections share.

import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

import { ApiError, api } from "../api.ts";
import { t } from "../i18n.ts";
import { Dialog, problemText } from "../shell/dialog.tsx";

/** What a form says after it's sent: done, or what went wrong. */
export type Outcome = { done: string } | { problem: string } | null;

export function OutcomeLine({ outcome }: { outcome: Outcome }) {
  return (
    <>
      <p class="done" role="status">
        {outcome && "done" in outcome ? outcome.done : ""}
      </p>
      <p class="error" role="alert">
        {outcome && "problem" in outcome ? outcome.problem : ""}
      </p>
    </>
  );
}

export interface Loaded<T> {
  data: T | null;
  /** Why the last load failed, or "". */
  error: string;
  reload: () => Promise<void>;
  /** Replaces the data with what a change returned, such as a new status. */
  replace: (data: T) => void;
}

/** Loads `path`, and again every `every` milliseconds while `again(data)`
 * says to, such as while a backup runs. A failed load keeps the last data,
 * so a server that's restarting doesn't empty the page. */
export function useLoad<T>(path: string, every = 0, again: (data: T) => boolean = () => true): Loaded<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const timer = useRef<number | undefined>(undefined);
  const latest = useRef<T | null>(null);

  async function reload() {
    clearTimeout(timer.current);
    try {
      const next = await api<T>("GET", path);
      latest.current = next;
      setData(next);
      setError("");
    } catch (problem) {
      // Signed out elsewhere: reloading shows the sign-in page.
      if (problem instanceof ApiError && problem.status === 401) location.reload();
      setError(problemText(problem));
    }
    if (every > 0 && (latest.current === null || again(latest.current))) {
      timer.current = window.setTimeout(reload, every);
    }
  }

  useEffect(() => {
    void reload();
    return () => clearTimeout(timer.current);
  }, [path]);

  return {
    data,
    error,
    reload,
    replace: (next) => {
      latest.current = next;
      setData(next);
    },
  };
}

/** A section's loading line, or why it couldn't load. */
export function LoadState({ error }: { error: string }) {
  return error ? (
    <p class="error" role="alert">
      {error}
    </p>
  ) : (
    <p class="loading">{t("shell.loading")}</p>
  );
}

/** Copies `text`, or selects `element`'s text if the browser won't, such
 * as over plain HTTP. Returns whether it copied. */
export async function copyText(text: string, element: Element | null): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    if (element) getSelection()?.selectAllChildren(element);
    return false;
  }
}

/** Something to copy, such as a password, with a button that copies it. */
export function Secret({
  text,
  label = t("settings.copy"),
  long = false,
}: {
  text: string;
  label?: string;
  /** For a link or a key, which gets its own line in smaller type. */
  long?: boolean;
}) {
  const code = useRef<HTMLElement>(null);
  const [copied, setCopied] = useState<boolean | null>(null);
  return (
    <div class={long ? "secret long" : "secret"}>
      <code ref={code}>{text}</code>
      <button type="button" class="secondary" onClick={async () => setCopied(await copyText(text, code.current))}>
        {copied ? t("settings.copied") : label}
      </button>
      {copied === false && (
        <p class="hint" role="status">
          {t("settings.copySelected")}
        </p>
      )}
    </div>
  );
}

/** A dialog whose form sends a change, and stays open to show a problem. */
export function FormDialog({
  title,
  submit,
  danger = false,
  onSubmit,
  onClose,
  children,
}: {
  title: string;
  submit: string;
  danger?: boolean;
  onSubmit: () => Promise<void>;
  onClose: () => void;
  children: ComponentChildren;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog title={title} onClose={onClose}>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          try {
            await onSubmit();
          } catch (problem) {
            setError(problemText(problem));
          } finally {
            setBusy(false);
          }
        }}
      >
        {children}
        <p class="error" role="alert">
          {error}
        </p>
        <div class="dialog-buttons">
          <button type="submit" class={danger ? "danger" : undefined} disabled={busy}>
            {submit}
          </button>
          <button type="button" class="secondary" onClick={onClose}>
            {t("dialog.cancel")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
