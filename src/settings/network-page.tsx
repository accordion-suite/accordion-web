// Network: every connection the server makes to other computers, and why
// (decision 11), with a switch for each one that can be turned off.

import { useState } from "preact/hooks";

import { api } from "../api.ts";
import { t } from "../i18n.ts";
import { problemText } from "../shell/dialog.tsx";
import { type Connection, type NetworkStatus, connections } from "./describe.ts";
import { SettingsPage } from "./layout.tsx";
import { LoadState, useLoad } from "./parts.tsx";

export function NetworkPage() {
  const status = useLoad<NetworkStatus>("/api/network");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  async function turn(path: string, on: boolean) {
    setError("");
    setBusy(path);
    try {
      await api("PUT", path, { on });
      await status.reload();
    } catch (problem) {
      setError(problemText(problem));
    } finally {
      setBusy("");
    }
  }

  return (
    <SettingsPage title={t("settings.network")} intro={t("network.intro")}>
      <p class="error" role="alert">
        {error}
      </p>
      {status.data === null ? (
        <LoadState error={status.error} />
      ) : (
        connections(status.data).map((entry) => (
          <ConnectionCard key={entry.title} entry={entry} busy={busy === entry.toggle?.path} onTurn={turn} />
        ))
      )}
      <section class="settings-card">
        <h2>{t("network.notCoveredTitle")}</h2>
        <ul>
          <li>{t("network.notCoveredSystem")}</li>
          <li>{t("network.notCoveredNames")}</li>
          <li>{t("network.notCoveredDisks")}</li>
        </ul>
      </section>
    </SettingsPage>
  );
}

function ConnectionCard({
  entry,
  busy,
  onTurn,
}: {
  entry: Connection;
  busy: boolean;
  onTurn: (path: string, on: boolean) => Promise<void>;
}) {
  const toggle = entry.toggle;
  return (
    <section class="settings-card">
      <div class="card-head">
        <h2>{entry.title}</h2>
        {toggle && !toggle.on && <span class="state">{t("network.off")}</span>}
      </div>
      <p>{entry.purpose}</p>
      <dl class="facts">
        <dt>{t("network.where")}</dt>
        <dd>{entry.where}</dd>
        <dt>{t("network.often")}</dt>
        <dd>{entry.often}</dd>
        <dt>{t("network.last")}</dt>
        <dd>{entry.last}</dd>
      </dl>
      {entry.fixed && <p class="hint">{entry.fixed}</p>}
      {toggle && (
        <>
          {toggle.on && <p class="hint">{toggle.offHint}</p>}
          <div class="form-buttons">
            <button type="button" class="secondary" disabled={busy} onClick={() => void onTurn(toggle.path, !toggle.on)}>
              {toggle.on ? toggle.offLabel : toggle.onLabel}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
