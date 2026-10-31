// Updates: which version the server runs, whether a newer one is waiting,
// when updates install, and what past updates did (decision 12).

import { useState } from "preact/hooks";

import { api } from "../api.ts";
import { formatCalendarDay, formatDay, formatMoment, t } from "../i18n.ts";
import { problemText } from "../shell/dialog.tsx";
import { followLink } from "../shell/router.ts";
import { type UpdateReport, updateLine } from "./describe.ts";
import { SettingsPage } from "./layout.tsx";
import { LoadState, useLoad } from "./parts.tsx";

interface Status {
  installed: string;
  installing: { version: string } | null;
  newest: { version: string; published: string; security: boolean; notes: string; link: string } | null;
  waiting: boolean;
  /** The last try at installing the newest release, if it failed. */
  failed: UpdateReport | null;
  /** Whether Accordion can install it here, or only with a command. */
  can_install: boolean;
  /** When the automatic install may start, in milliseconds. */
  installs_from: number | null;
  install_problem: string | null;
  automatic: boolean;
  check_on: boolean;
  last_check: { at: number; problem: string | null } | null;
  history: UpdateReport[];
}

/** How often the page checks again while an update installs. */
const INSTALLING_MS = 5 * 1000;

const COMMAND = "curl -fsSL https://github.com/accordion-suite/accordion/releases/latest/download/install.sh | sudo sh";

export function UpdatesPage() {
  const status = useLoad<Status>("/api/updates", INSTALLING_MS, (data) => data.installing !== null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"" | "check" | "install">("");

  async function send(what: "check" | "install" | "settings", body?: unknown) {
    setError("");
    if (what !== "settings") setBusy(what);
    try {
      if (what === "check") status.replace(await api<Status>("POST", "/api/updates/check"));
      else if (what === "install") await api("POST", "/api/updates/install");
      else await api("PUT", "/api/updates/settings", body);
      if (what !== "check") await status.reload();
    } catch (problem) {
      setError(problemText(problem));
    } finally {
      setBusy("");
    }
  }

  const data = status.data;
  if (data === null) {
    return (
      <SettingsPage title={t("settings.updates")}>
        <LoadState error={status.error} />
      </SettingsPage>
    );
  }
  const newest = data.newest;
  // While an update installs, the server stops for a while, so the page
  // keeps waiting rather than saying it can't connect.
  const problem = error || data.install_problem || (data.installing ? "" : status.error);

  return (
    <SettingsPage title={t("settings.updates")}>
      <p class="error" role="alert">
        {problem}
      </p>
      <section class="settings-card">
        <h2>{t("updates.version", { version: data.installed })}</h2>
        {data.waiting ? null : newest ? (
          <p>{t("updates.upToDateNewest", { version: newest.version, day: formatCalendarDay(newest.published) })}</p>
        ) : data.last_check && !data.last_check.problem ? (
          <p>{t("updates.upToDate")}</p>
        ) : null}
        <p class="hint">{checkLine(data)}</p>
        <div class="form-buttons">
          <button type="button" class="secondary" disabled={busy !== ""} onClick={() => void send("check")}>
            {t("updates.checkNow")}
          </button>
        </div>
        <p class="hint" role="status">
          {busy === "check" ? t("updates.checking") : ""}
        </p>
      </section>

      {data.installing && (
        <section class="settings-card highlight">
          <h2>{t("updates.installing", { version: data.installing.version })}</h2>
          <p role="status">{t("updates.installingBody")}</p>
        </section>
      )}

      {data.waiting && newest && !data.installing && (
        <section class="settings-card highlight">
          <h2>{t("updates.available", { version: newest.version })}</h2>
          <p class="hint">{t("updates.released", { day: formatCalendarDay(newest.published) })}</p>
          {newest.security && (
            <p>
              <strong>{t("updates.security")}</strong> {t("updates.securitySoon")}
            </p>
          )}
          <p class="notes">{newest.notes}</p>
          <p>
            <a href={newest.link} rel="noreferrer" target="_blank">
              {t("updates.notes")}
            </a>
          </p>
          {data.failed && (
            <p class="error">
              {updateLine(data.failed)} {t("updates.wontRetry", { version: newest.version })}
            </p>
          )}
          {data.can_install ? (
            <>
              {data.installs_from !== null && (
                <p>
                  {data.installs_from <= Date.now()
                    ? t("updates.tonight")
                    : t("updates.installsFrom", { day: formatDay(data.installs_from) })}
                </p>
              )}
              <div class="form-buttons">
                <button type="button" disabled={busy !== ""} onClick={() => void send("install")}>
                  {busy === "install" ? t("updates.downloading") : t("updates.installNow")}
                </button>
              </div>
              <p class="hint">{t("updates.installHint")}</p>
            </>
          ) : (
            <>
              <p>{t("updates.command")}</p>
              <pre>
                <code>{COMMAND}</code>
              </pre>
            </>
          )}
        </section>
      )}

      <section class="settings-card">
        <h2 id="schedule-title">{t("updates.scheduleTitle")}</h2>
        <fieldset class="choices" aria-labelledby="schedule-title">
          <label class="choice">
            <input
              type="radio"
              name="automatic"
              checked={data.automatic}
              onChange={() => void send("settings", { automatic: true })}
            />
            <span>
              <strong>{t("updates.automatic")}</strong> {t("updates.automaticHint")}{" "}
              <a href="/settings/backups" onClick={followLink}>
                {t("updates.backupHour")}
              </a>
            </span>
          </label>
          <label class="choice">
            <input
              type="radio"
              name="automatic"
              checked={!data.automatic}
              onChange={() => void send("settings", { automatic: false })}
            />
            <span>
              <strong>{t("updates.manual")}</strong> {t("updates.manualHint")}
            </span>
          </label>
        </fieldset>
      </section>

      {data.history.length > 0 && (
        <section class="settings-card">
          <h2>{t("updates.history")}</h2>
          <ul class="history">
            {data.history.map((report) => (
              <li key={report.finished_at}>{updateLine(report)}</li>
            ))}
          </ul>
        </section>
      )}
    </SettingsPage>
  );
}

function checkLine(data: Status): string {
  const check = data.last_check;
  if (!data.check_on) return t("updates.checkOff");
  if (!check) return t("updates.notChecked");
  if (check.problem) return t("updates.checkFailed", { when: formatMoment(check.at), problem: check.problem });
  return t("updates.checked", { when: formatMoment(check.at) });
}
