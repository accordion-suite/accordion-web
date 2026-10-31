// Apps and devices: app passwords, which let File Explorer, Finder, and
// phone apps open Drive (decision 3), each with its own password that can
// be deleted without changing the reader's.

import { useState } from "preact/hooks";

import { api } from "../api.ts";
import { formatDay, t } from "../i18n.ts";
import { ConfirmDialog, Dialog, problemText } from "../shell/dialog.tsx";
import { SettingsPage } from "./layout.tsx";
import { LoadState, Secret, useLoad } from "./parts.tsx";
import { usePasswordCheck } from "./password-check.tsx";

interface AppPassword {
  id: string;
  device_name: string;
  use_for: "dav" | "mail";
  created_at: string;
  last_used_at: string | null;
}

interface Created {
  app_password: AppPassword;
  password: string;
}

export function DevicesPage({ username }: { username: string }) {
  const passwords = useLoad<AppPassword[]>("/api/app-passwords");
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<AppPassword | null>(null);

  return (
    <SettingsPage title={t("settings.devices")} intro={t("devices.intro")}>
      <section class="settings-card">
        <h2>{t("devices.title")}</h2>
        {passwords.data === null ? (
          <LoadState error={passwords.error} />
        ) : passwords.data.length === 0 ? (
          <p class="hint">{t("devices.none")}</p>
        ) : (
          <ul class="rows">
            {passwords.data.map((password) => (
              <li key={password.id} class="row">
                <div class="row-text">
                  <strong>{password.device_name}</strong>
                  <span class="hint">
                    {t(password.use_for === "mail" ? "devices.forMail" : "devices.forFiles")}{" "}
                    {password.last_used_at
                      ? t("devices.createdUsed", {
                          created: formatDay(password.created_at),
                          used: formatDay(password.last_used_at),
                        })
                      : t("devices.createdUnused", { created: formatDay(password.created_at) })}
                  </span>
                </div>
                <button type="button" class="secondary" onClick={() => setDeleting(password)}>
                  {t("devices.delete")}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div class="form-buttons">
          <button type="button" onClick={() => setCreating(true)}>
            {t("devices.create")}
          </button>
        </div>
      </section>

      {creating && (
        <CreateDialog
          username={username}
          onCreated={() => void passwords.reload()}
          onClose={() => setCreating(false)}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title={t("devices.deleteTitle", { name: deleting.device_name })}
          body={t("devices.deleteBody", { name: deleting.device_name })}
          confirm={t("devices.delete")}
          onConfirm={async () => {
            await api("DELETE", `/api/app-passwords/${deleting.id}`);
            setDeleting(null);
            await passwords.reload();
          }}
          onClose={() => setDeleting(null)}
        />
      )}
    </SettingsPage>
  );
}

/** Names the device, then shows its new password once, with how to use
 * it. */
function CreateDialog({
  username,
  onCreated,
  onClose,
}: {
  username: string;
  onCreated: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [created, setCreated] = useState<Created | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [checked, passwordDialog] = usePasswordCheck();

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const made = await checked(() =>
        api<Created>("POST", "/api/app-passwords", { device_name: name, use_for: "dav" }),
      );
      if (made) {
        setCreated(made);
        onCreated();
      }
    } catch (problem) {
      setError(problemText(problem));
    } finally {
      setBusy(false);
    }
  }

  if (created) {
    return (
      <Dialog title={t("devices.createdTitle", { name: created.app_password.device_name })} onClose={onClose}>
        <p>{t("devices.createdBody")}</p>
        <Secret text={created.password} />
        <p class="hint">{t("devices.spaces")}</p>
        <dl class="details">
          <dt>{t("devices.address")}</dt>
          <dd>
            <code>{`${location.origin}/dav/drive/`}</code>
          </dd>
          <dt>{t("devices.username")}</dt>
          <dd>
            <code>{username}</code>
          </dd>
        </dl>
        <ul class="steps">
          <li>{t("devices.windows")}</li>
          <li>{t("devices.mac")}</li>
        </ul>
        <div class="dialog-buttons">
          <button type="button" autofocus onClick={onClose}>
            {t("devices.done")}
          </button>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog title={t("devices.create")} onClose={onClose}>
      <form onSubmit={submit}>
        <label for="device-name">{t("devices.deviceName")}</label>
        <p class="hint">{t("devices.deviceNameHint")}</p>
        <input
          id="device-name"
          maxLength={100}
          required
          autofocus
          value={name}
          onInput={(event) => setName(event.currentTarget.value)}
        />
        <p class="error" role="alert">
          {error}
        </p>
        <div class="dialog-buttons">
          <button type="submit" disabled={busy}>
            {t("devices.createButton")}
          </button>
          <button type="button" class="secondary" onClick={onClose}>
            {t("dialog.cancel")}
          </button>
        </div>
      </form>
      {passwordDialog}
    </Dialog>
  );
}
