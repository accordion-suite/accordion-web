// How long Drive keeps trash and older versions, for everyone on the
// server. Core empties what's older in its hourly upkeep.

import { useState } from "preact/hooks";

import { api } from "../api.ts";
import { keptFor, rememberRetention, type Retention } from "../drive/retention.ts";
import { t } from "../i18n.ts";
import { problemText } from "../shell/dialog.tsx";
import { SettingsPage } from "./layout.tsx";
import { LoadState, useLoad } from "./parts.tsx";

const CHOICES = [7, 30, 90, 365] as const;

export function RetentionPage() {
  const retention = useLoad<Retention>("/api/admin/storage/retention");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  async function choose(change: Partial<Retention>) {
    setError("");
    setSaved(false);
    try {
      const next = await api<Retention>("PUT", "/api/admin/storage/retention", { ...retention.data!, ...change });
      retention.replace(next);
      rememberRetention(next);
      setSaved(true);
    } catch (problem) {
      setError(problemText(problem));
    }
  }

  const card = (field: keyof Retention, title: string, hint: string) => (
    <section class="settings-card">
      <h2 id={`${field}-title`}>{title}</h2>
      <p class="hint">{hint}</p>
      {retention.data === null ? (
        <LoadState error={retention.error} />
      ) : (
        <fieldset class="choices" aria-labelledby={`${field}-title`}>
          {CHOICES.map((days) => (
            <label key={days} class="choice">
              <input
                type="radio"
                name={field}
                checked={retention.data![field] === days}
                onChange={() => void choose({ [field]: days })}
              />
              <span>
                <strong>{keptFor(days)}</strong>
              </span>
            </label>
          ))}
        </fieldset>
      )}
    </section>
  );

  return (
    <SettingsPage title={t("settings.retention")} intro={t("retention.intro")}>
      {card("trash_days", t("retention.trashTitle"), t("retention.trashHint"))}
      {card("version_days", t("retention.versionsTitle"), t("retention.versionsHint"))}
      {error && (
        <p class="error" role="alert">
          {error}
        </p>
      )}
      {saved && (
        <p class="hint" role="status">
          {t("retention.saved")}
        </p>
      )}
    </SettingsPage>
  );
}
