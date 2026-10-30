import { useState } from "preact/hooks";

import { api, type Session } from "../api.ts";
import { Logo } from "../drive/icons.tsx";
import { t } from "../i18n.ts";
import { PageTitle } from "./page.tsx";

export function SignIn({ onSignedIn }: { onSignedIn: (session: Session) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      onSignedIn(await api<Session>("POST", "/api/session", { username, password }));
    } catch (problem) {
      setError((problem as Error).message);
      setPassword("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main class="sign-in">
      <div class="sign-in-card">
        <Logo />
        <PageTitle>{t("signIn.title")}</PageTitle>
        <p class="hint">{t("signIn.intro")}</p>
        <form onSubmit={submit}>
        <label for="username">{t("signIn.username")}</label>
        <input
          id="username"
          autocomplete="username"
          autocapitalize="none"
          spellcheck={false}
          required
          value={username}
          onInput={(event) => setUsername(event.currentTarget.value)}
        />
        <label for="password">{t("signIn.password")}</label>
        <input
          id="password"
          type="password"
          autocomplete="current-password"
          required
          value={password}
          onInput={(event) => setPassword(event.currentTarget.value)}
        />
        <p class="error" role="alert">
          {error}
        </p>
        <button type="submit" class="wide" disabled={busy}>
          {t("signIn.submit")}
        </button>
        </form>
      </div>
    </main>
  );
}
