// Account: the reader's name, username, and password.

import { useState } from "preact/hooks";

import { api, type Session } from "../api.ts";
import { t } from "../i18n.ts";
import { problemText } from "../shell/dialog.tsx";
import { SettingsPage } from "./layout.tsx";
import { type Outcome, OutcomeLine } from "./parts.tsx";

export function AccountPage({ session, onChanged }: { session: Session; onChanged: () => Promise<void> }) {
  return (
    <SettingsPage title={t("settings.account")}>
      <NameForm session={session} onChanged={onChanged} />
      <PasswordForm username={session.user.username} />
    </SettingsPage>
  );
}

function NameForm({ session, onChanged }: { session: Session; onChanged: () => Promise<void> }) {
  const [name, setName] = useState(session.user.display_name);
  const [username, setUsername] = useState(session.user.username);
  const [password, setPassword] = useState("");
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [busy, setBusy] = useState(false);
  // A new username needs the current password, so it's asked for only then.
  const newUsername = username.trim().toLowerCase() !== session.user.username;

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    setBusy(true);
    setOutcome(null);
    try {
      await api("PUT", "/api/account/name", {
        display_name: name,
        username,
        current_password: password,
      });
      setPassword("");
      await onChanged();
      setOutcome({ done: t("account.nameSaved") });
    } catch (problem) {
      setOutcome({ problem: problemText(problem) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section class="settings-card">
      <h2>{t("account.nameTitle")}</h2>
      <form onSubmit={submit} onInput={() => setOutcome(null)}>
        <label for="display-name">{t("account.name")}</label>
        <p class="hint">{t("account.nameHint")}</p>
        <input
          id="display-name"
          maxLength={100}
          required
          value={name}
          onInput={(event) => setName(event.currentTarget.value)}
        />
        <label for="username">{t("account.username")}</label>
        <p class="hint">{t("account.usernameHint")}</p>
        <input
          id="username"
          maxLength={32}
          autocomplete="off"
          autocapitalize="none"
          spellcheck={false}
          required
          value={username}
          onInput={(event) => setUsername(event.currentTarget.value)}
        />
        {newUsername && (
          <>
            <label for="rename-password">{t("account.currentPassword")}</label>
            <p class="hint">{t("account.renamePasswordHint")}</p>
            <input
              id="rename-password"
              type="password"
              autocomplete="current-password"
              required
              value={password}
              onInput={(event) => setPassword(event.currentTarget.value)}
            />
          </>
        )}
        <OutcomeLine outcome={outcome} />
        <div class="form-buttons">
          <button type="submit" disabled={busy}>
            {t("account.saveName")}
          </button>
        </div>
      </form>
    </section>
  );
}

function PasswordForm({ username }: { username: string }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    setOutcome(null);
    if (next !== repeat) {
      setOutcome({ problem: t("account.passwordsDiffer") });
      return;
    }
    setBusy(true);
    try {
      await api("POST", "/api/account/password", { current_password: current, new_password: next });
      setCurrent("");
      setNext("");
      setRepeat("");
      setOutcome({ done: t("account.passwordChanged") });
    } catch (problem) {
      setOutcome({ problem: problemText(problem) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section class="settings-card">
      <h2>{t("account.passwordTitle")}</h2>
      <p class="hint">{t("account.passwordIntro")}</p>
      <form onSubmit={submit} onInput={() => setOutcome(null)}>
        {/* Lets password managers save the new password with the username. */}
        <input type="text" autocomplete="username" value={username} hidden readOnly />
        <label for="current-password">{t("account.currentPassword")}</label>
        <input
          id="current-password"
          type="password"
          autocomplete="current-password"
          required
          value={current}
          onInput={(event) => setCurrent(event.currentTarget.value)}
        />
        <label for="new-password">{t("account.newPassword")}</label>
        <p class="hint">{t("account.newPasswordHint")}</p>
        <input
          id="new-password"
          type="password"
          autocomplete="new-password"
          required
          value={next}
          onInput={(event) => setNext(event.currentTarget.value)}
        />
        <label for="repeat-password">{t("account.repeatPassword")}</label>
        <input
          id="repeat-password"
          type="password"
          autocomplete="new-password"
          required
          value={repeat}
          onInput={(event) => setRepeat(event.currentTarget.value)}
        />
        <OutcomeLine outcome={outcome} />
        <div class="form-buttons">
          <button type="submit" disabled={busy}>
            {t("account.changePassword")}
          </button>
        </div>
      </form>
    </section>
  );
}
