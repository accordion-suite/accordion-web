// Backups: turning them on with a recovery key, when they run, and where
// they go (decisions 8 and 10).

import type { TargetedEvent } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

import { api } from "../api.ts";
import { formatHour, t } from "../i18n.ts";
import { ConfirmDialog, problemText } from "../shell/dialog.tsx";
import { type Target, targetLines } from "./describe.ts";
import { SettingsPage } from "./layout.tsx";
import { FormDialog, LoadState, Secret, useLoad } from "./parts.tsx";
import { usePasswordCheck } from "./password-check.tsx";

interface Status {
  /** Whether there's a recovery key, and whether the admin confirmed they
   * saved it. */
  key: "none" | "unconfirmed" | "confirmed";
  running: boolean;
  hour: number;
  targets: Target[];
}

/** How often the page checks again while a backup or test runs. */
const RUNNING_MS = 3 * 1000;

export function BackupsPage() {
  const status = useLoad<Status>("/api/backups", RUNNING_MS, (data) => data.running);
  const [key, setKey] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<Target | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [checked, passwordDialog] = usePasswordCheck();

  /** Gets the recovery key: POST makes it, GET shows it again. */
  async function fetchKey(method: "POST" | "GET") {
    setError("");
    try {
      const shown = await checked(() => api<{ recovery_key: string }>(method, "/api/backups/key"));
      if (shown) setKey(shown.recovery_key);
    } catch (problem) {
      setError(problemText(problem));
    }
  }

  async function send(what: string, method: string, path: string, body?: unknown) {
    setError("");
    setBusy(what);
    try {
      await api(method, path, body);
      await status.reload();
    } catch (problem) {
      setError(problemText(problem));
    } finally {
      setBusy("");
    }
  }

  const data = status.data;
  const errorLine = (
    <p class="error" role="alert">
      {error || (data ? status.error : "")}
    </p>
  );

  if (data === null) {
    return (
      <SettingsPage title={t("settings.backups")}>
        <LoadState error={status.error} />
      </SettingsPage>
    );
  }

  if (key !== null) {
    return (
      <SettingsPage title={t("settings.backups")}>
        {errorLine}
        <RecoveryKey
          recoveryKey={key}
          onSaved={async () => {
            setKey(null);
            await status.reload();
          }}
        />
      </SettingsPage>
    );
  }

  if (data.key === "none") {
    return (
      <SettingsPage title={t("settings.backups")}>
        {errorLine}
        <section class="settings-card">
          <h2>{t("backups.offTitle")}</h2>
          <p>{t("backups.offBody")}</p>
          <p>{t("backups.offKey")}</p>
          <div class="form-buttons">
            <button type="button" onClick={() => void fetchKey("POST")}>
              {t("backups.turnOn")}
            </button>
          </div>
        </section>
        {passwordDialog}
      </SettingsPage>
    );
  }

  let summary;
  if (data.running) summary = t("backups.running");
  else if (data.targets.length === 0) summary = t("backups.nowhere");
  else summary = t("backups.nightly", { hour: formatHour(data.hour) });

  return (
    <SettingsPage title={t("settings.backups")}>
      {errorLine}
      {data.key === "unconfirmed" && (
        <section class="settings-card highlight">
          <p>
            <strong>{t("backups.unconfirmed")}</strong> {t("backups.unconfirmedBody")}
          </p>
          <div class="form-buttons">
            <button type="button" onClick={() => void fetchKey("GET")}>
              {t("backups.showKey")}
            </button>
          </div>
        </section>
      )}

      <section class="settings-card">
        <h2>{t("backups.statusTitle")}</h2>
        <p role="status">{summary}</p>
        <label for="hour">{t("backups.hour")}</label>
        <p class="hint">{t("backups.hourHint")}</p>
        <select
          id="hour"
          class="short"
          value={String(data.hour)}
          disabled={busy === "hour"}
          onChange={(event) => void send("hour", "PUT", "/api/backups/settings", { hour: Number(event.currentTarget.value) })}
        >
          {Array.from({ length: 24 }, (_, hour) => (
            <option key={hour} value={String(hour)}>
              {formatHour(hour)}
            </option>
          ))}
        </select>
        <div class="form-buttons">
          <button
            type="button"
            disabled={data.running || data.targets.length === 0 || busy !== ""}
            onClick={() => void send("run", "POST", "/api/backups/run")}
          >
            {t("backups.runNow")}
          </button>
        </div>
      </section>

      <section class="settings-card">
        <div class="card-head">
          <h2>{t("backups.whereTitle")}</h2>
          <button type="button" onClick={() => setAdding(true)}>
            {t("backups.add")}
          </button>
        </div>
        {data.targets.length === 0 ? (
          <p class="hint">{t("backups.noTargets")}</p>
        ) : (
          <ul class="rows">
            {data.targets.map((target) => (
              <li key={target.id} class="row target">
                <div class="row-text">
                  <strong>{target.name}</strong>
                  <span class="hint">{target.location}</span>
                  {targetLines(target, data.hour).map((line) => (
                    <span key={line}>{line}</span>
                  ))}
                  <div class="row-buttons">
                    <button
                      type="button"
                      class="secondary"
                      disabled={data.running || target.paused || !target.last_good_backup || busy !== ""}
                      onClick={() => void send(target.id, "POST", `/api/backups/targets/${target.id}/test`)}
                    >
                      {t("backups.test")}
                    </button>
                    <button type="button" class="secondary" onClick={() => setRemoving(target)}>
                      {t("backups.remove")}
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {data.key === "confirmed" && (
        <div class="form-buttons">
          <button type="button" class="secondary" onClick={() => void fetchKey("GET")}>
            {t("backups.showKey")}
          </button>
        </div>
      )}

      {adding && (
        <AddTargetDialog
          onAdded={async () => {
            setAdding(false);
            await status.reload();
          }}
          onClose={() => setAdding(false)}
        />
      )}
      {removing && (
        <ConfirmDialog
          title={t("backups.removeTitle", { name: removing.name })}
          body={t("backups.removeBody")}
          confirm={t("backups.remove")}
          onConfirm={async () => {
            await api("DELETE", `/api/backups/targets/${removing.id}`);
            setRemoving(null);
            await status.reload();
          }}
          onClose={() => setRemoving(null)}
        />
      )}
      {passwordDialog}
    </SettingsPage>
  );
}

/** Shows the recovery key, and asks for it back to show it's saved. Only
 * this part of the page prints. */
function RecoveryKey({ recoveryKey, onSaved }: { recoveryKey: string; onSaved: () => Promise<void> }) {
  const [typed, setTyped] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("POST", "/api/backups/key/confirm", { recovery_key: typed });
      await onSaved();
    } catch (problem) {
      setError(problemText(problem));
      setBusy(false);
    }
  }

  return (
    <section class="settings-card printable">
      <h2>{t("backups.keyTitle")}</h2>
      <p class="recovery-key">
        <code>{recoveryKey}</code>
      </p>
      <p>
        <strong>{t("backups.keySave")}</strong> {t("backups.keyWhy")}
      </p>
      <div class="form-buttons no-print">
        <button type="button" class="secondary" onClick={() => window.print()}>
          {t("backups.print")}
        </button>
      </div>
      <form class="no-print" onSubmit={submit}>
        <label for="typed-key">{t("backups.typeKey")}</label>
        <input
          id="typed-key"
          autocomplete="off"
          autocapitalize="none"
          spellcheck={false}
          required
          value={typed}
          onInput={(event) => setTyped(event.currentTarget.value)}
        />
        <p class="error" role="alert">
          {error}
        </p>
        <div class="form-buttons">
          <button type="submit" disabled={busy}>
            {t("backups.saved")}
          </button>
        </div>
      </form>
    </section>
  );
}

type Kind = Target["kind"];

const KINDS: readonly Kind[] = ["folder", "s3", "sftp", "rest"];

/** When adding a location gets a second, longer note. One that doesn't
 * answer has already failed by then, after 10 seconds. */
const STILL_WORKING_MS = 15 * 1000;

function AddTargetDialog({ onAdded, onClose }: { onAdded: () => Promise<void>; onClose: () => void }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<Kind>("folder");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [sshKey, setSshKey] = useState("");
  const [keyError, setKeyError] = useState("");
  const [progress, setProgress] = useState("");
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  useEffect(() => {
    if (kind !== "sftp" || sshKey) return;
    api<{ public_key: string }>("GET", "/api/backups/ssh-key").then(
      (key) => setSshKey(key.public_key),
      (problem) => setKeyError(problemText(problem)),
    );
  }, [kind]);

  const field = (id: string) => fields[id] ?? "";
  const input = (id: string, label: string, hint: string, options: { secret?: boolean; optional?: boolean; url?: boolean } = {}) => {
    const shared = {
      id: `target-${id}`,
      autocomplete: "off",
      required: !options.optional,
      value: field(id),
      onInput: (event: TargetedEvent<HTMLInputElement>) => {
        const value = event.currentTarget.value;
        setFields((all) => ({ ...all, [id]: value }));
      },
    };
    return (
      <>
        <label for={`target-${id}`}>{label}</label>
        {hint && <p class="hint">{hint}</p>}
        {options.secret ? (
          <input type="password" {...shared} />
        ) : (
          <input
            type="text"
            inputMode={options.url ? "url" : undefined}
            autocapitalize="none"
            spellcheck={false}
            {...shared}
          />
        )}
      </>
    );
  };

  function place() {
    switch (kind) {
      case "folder":
        return { kind, path: field("path") };
      case "s3":
        return { kind, endpoint: field("endpoint"), bucket: field("bucket"), key_id: field("keyId"), secret_key: field("secret") };
      case "sftp":
        return { kind, server: field("server"), username: field("username"), folder: field("folder") };
      case "rest":
        return { kind, address: field("address"), username: field("restUsername"), password: field("restPassword") };
    }
  }

  async function add() {
    setProgress(kind === "folder" ? t("backups.settingUpFolder") : t("backups.connecting"));
    timer.current = window.setTimeout(() => setProgress(t("backups.stillConnecting")), STILL_WORKING_MS);
    try {
      await api("POST", "/api/backups/targets", { name, ...place() });
    } finally {
      clearTimeout(timer.current);
      setProgress("");
    }
    await onAdded();
  }

  return (
    <FormDialog title={t("backups.addTitle")} submit={t("backups.addButton")} onSubmit={add} onClose={onClose}>
      <label for="target-name">{t("account.name")}</label>
      <p class="hint">{t("backups.nameHint")}</p>
      <input id="target-name" maxLength={100} required autofocus value={name} onInput={(event) => setName(event.currentTarget.value)} />
      <fieldset class="choices">
        <legend>{t("backups.where")}</legend>
        {KINDS.map((choice) => (
          <label key={choice} class="choice">
            <input type="radio" name="target-kind" checked={kind === choice} onChange={() => setKind(choice)} />
            <span>
              <strong>{t(`backups.kind.${choice}`)}</strong> {t(`backups.kind.${choice}.hint`)}
            </span>
          </label>
        ))}
      </fieldset>
      {kind === "folder" && input("path", t("backups.folder"), t("backups.folderHint"))}
      {kind === "s3" && (
        <>
          <p class="hint">{t("backups.s3Intro")}</p>
          <p class="hint">{t("backups.s3Versions")}</p>
          {input("endpoint", t("backups.s3Address"), t("backups.s3AddressHint"), { url: true })}
          {input("bucket", t("backups.bucket"), t("backups.bucketHint"))}
          {input("keyId", t("backups.keyId"), t("backups.keyIdHint"))}
          {input("secret", t("backups.secret"), t("backups.secretHint"), { secret: true })}
        </>
      )}
      {kind === "sftp" && (
        <>
          <p class="hint">{t("backups.sftpIntro")}</p>
          {sshKey ? <Secret text={sshKey} label={t("backups.copyKey")} long /> : <p class="error">{keyError}</p>}
          {input("server", t("backups.computer"), t("backups.computerHint"))}
          {input("username", t("account.username"), t("backups.sftpUsernameHint"))}
          {input("folder", t("backups.folder"), t("backups.sftpFolderHint"))}
        </>
      )}
      {kind === "rest" && (
        <>
          <p class="hint">{t("backups.restIntro")}</p>
          {input("address", t("backups.address"), t("backups.addressHint"), { url: true })}
          {input("restUsername", t("account.username"), t("backups.restUsernameHint"), { optional: true })}
          {input("restPassword", t("backups.password"), "", { secret: true, optional: true })}
        </>
      )}
      <p class="hint" role="status">
        {progress}
      </p>
    </FormDialog>
  );
}
