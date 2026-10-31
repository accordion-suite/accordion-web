// Runs a change that may need the password again. If the server asks for
// it, a dialog takes the password, then the change runs once more.

import type { VNode } from "preact";
import { useState } from "preact/hooks";

import { api } from "../api.ts";
import { t } from "../i18n.ts";
import { Dialog, problemText } from "../shell/dialog.tsx";
import { needsPassword } from "./password.ts";

interface Asking {
  message: string;
  answer: (confirmed: boolean) => void;
}

/** Returns `run`, which resolves to the change's result, or null if the
 * reader canceled, and the dialog to put on the page. */
export function usePasswordCheck(): [<T>(change: () => Promise<T>) => Promise<T | null>, VNode | null] {
  const [asking, setAsking] = useState<Asking | null>(null);

  async function run<T>(change: () => Promise<T>): Promise<T | null> {
    try {
      return await change();
    } catch (problem) {
      if (!needsPassword(problem)) throw problem;
      const confirmed = await new Promise<boolean>((answer) => setAsking({ message: problem.message, answer }));
      setAsking(null);
      return confirmed ? await change() : null;
    }
  }

  const dialog = asking && (
    <PasswordDialog
      message={asking.message}
      onConfirmed={() => asking.answer(true)}
      onClose={() => asking.answer(false)}
    />
  );
  return [run, dialog];
}

function PasswordDialog({
  message,
  onConfirmed,
  onClose,
}: {
  message: string;
  onConfirmed: () => void;
  onClose: () => void;
}) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("POST", "/api/session/confirm", { password });
      onConfirmed();
    } catch (problem) {
      setError(problemText(problem));
      setPassword("");
      setBusy(false);
    }
  }

  return (
    <Dialog title={t("settings.passwordTitle")} onClose={onClose}>
      <form onSubmit={submit}>
        <p>{message}</p>
        <label for="confirm-password">{t("settings.yourPassword")}</label>
        <input
          id="confirm-password"
          type="password"
          autocomplete="current-password"
          required
          autofocus
          value={password}
          onInput={(event) => setPassword(event.currentTarget.value)}
        />
        <p class="error" role="alert">
          {error}
        </p>
        <div class="dialog-buttons">
          <button type="submit" disabled={busy}>
            {t("settings.confirm")}
          </button>
          <button type="button" class="secondary" onClick={onClose}>
            {t("dialog.cancel")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
