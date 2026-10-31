// Server health: how the server's certificate, backups, updates, and the
// rest are doing. The server writes each check's text, so this page only
// lays it out, and checks again every minute.

import { t } from "../i18n.ts";
import { followLink } from "../shell/router.ts";
import { SettingsPage } from "./layout.tsx";
import { LoadState, useLoad } from "./parts.tsx";

type State = "ok" | "warning" | "problem";

interface Report {
  state: State;
  checks: { title: string; state: State; summary: string }[];
}

const REFRESH_MS = 60 * 1000;

const OVERALL = { ok: "health.ok", warning: "health.warning", problem: "health.problem" } as const;
const LABELS = { ok: "health.okLabel", warning: "health.warningLabel", problem: "health.problemLabel" } as const;

export function HealthPage() {
  const report = useLoad<Report>("/api/health", REFRESH_MS);
  const data = report.data;
  return (
    <SettingsPage title={t("settings.health")}>
      {data === null ? (
        <LoadState error={report.error} />
      ) : (
        <>
          <p class="overall" data-state={data.state}>
            {t(OVERALL[data.state])}
          </p>
          <p class="error" role="alert">
            {report.error}
          </p>
          <ul class="checks">
            {data.checks.map((check) => (
              <li key={check.title} class="settings-card check" data-state={check.state}>
                <h2>
                  {check.title} <span class="state">{t(LABELS[check.state])}</span>
                </h2>
                <p>{check.summary}</p>
              </li>
            ))}
          </ul>
          <p class="hint">
            {t("health.every")}{" "}
            <a href="/settings/network" onClick={followLink}>
              {t("health.toNetwork")}
            </a>
          </p>
          <div class="form-buttons">
            <button type="button" class="secondary" onClick={() => void report.reload()}>
              {t("health.again")}
            </button>
          </div>
        </>
      )}
    </SettingsPage>
  );
}
