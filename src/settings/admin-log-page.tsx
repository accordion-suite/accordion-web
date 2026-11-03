// The admin log: what admins changed, and wrong passwords for any account,
// with how long the server keeps activity. It never shows anyone's files.

import { useState } from "preact/hooks";

import { api } from "../api.ts";
import { type MessageKey, t } from "../i18n.ts";
import { problemText } from "../shell/dialog.tsx";
import { SettingsPage } from "./layout.tsx";
import { LogList } from "./log-list.tsx";
import { LoadState, useLoad } from "./parts.tsx";

interface LogSettings {
  keep_days: number | null;
}

const CHOICES: readonly [number | null, MessageKey][] = [
  [90, "log.keep90"],
  [365, "log.keep365"],
  [730, "log.keep730"],
  [null, "log.keepForever"],
];

export function AdminLogPage({ me }: { me: string }) {
  const settings = useLoad<LogSettings>("/api/admin/log/settings");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  // The setting change shows in the log, so the list loads again after it.
  const [version, setVersion] = useState(0);

  async function choose(keep_days: number | null) {
    setError("");
    setSaved(false);
    try {
      settings.replace(await api<LogSettings>("PUT", "/api/admin/log/settings", { keep_days }));
      setSaved(true);
      setVersion((each) => each + 1);
    } catch (problem) {
      setError(problemText(problem));
    }
  }

  return (
    <SettingsPage title={t("settings.adminLog")} intro={t("log.adminIntro")}>
      <section class="settings-card">
        <h2 id="keep-title">{t("log.keepTitle")}</h2>
        <p class="hint">{t("log.keepHint")}</p>
        {settings.data === null ? (
          <LoadState error={settings.error} />
        ) : (
          <fieldset class="choices" aria-labelledby="keep-title">
            {CHOICES.map(([days, label]) => (
              <label key={String(days)} class="choice">
                <input
                  type="radio"
                  name="keep"
                  checked={settings.data!.keep_days === days}
                  onChange={() => void choose(days)}
                />
                <span>
                  <strong>{t(label)}</strong>
                </span>
              </label>
            ))}
          </fieldset>
        )}
        {error && (
          <p class="error" role="alert">
            {error}
          </p>
        )}
        {saved && (
          <p class="hint" role="status">
            {t("log.keepSaved")}
          </p>
        )}
      </section>
      <section class="settings-card">
        <h2>{t("log.title")}</h2>
        <LogList key={version} path="/api/admin/log" me={me} />
      </section>
    </SettingsPage>
  );
}
