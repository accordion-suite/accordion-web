// Apps and devices: remote access devices, which reach Accordion away from
// home through WireGuard (decision 21), and app passwords, which let File
// Explorer, Finder, and phone apps open Drive (decision 3), each with its
// own password that can be deleted without changing the reader's.

import { useEffect, useState } from "preact/hooks";

import { api } from "../api.ts";
import { formatDay, t } from "../i18n.ts";
import { ConfirmDialog, Dialog, problemText } from "../shell/dialog.tsx";
import { followLink } from "../shell/router.ts";
import { SettingsPage } from "./layout.tsx";
import { LoadState, Secret, useLoad } from "./parts.tsx";
import { usePasswordCheck } from "./password-check.tsx";
import { connectedLine, type RemoteDevice } from "./remote-page.tsx";

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

interface RemoteDevices {
  on: boolean;
  max: number;
  devices: RemoteDevice[];
}

interface AddedDevice {
  device: RemoteDevice;
  config: string;
  qr_code: string;
  file_name: string;
}

export function DevicesPage({ username, admin }: { username: string; admin: boolean }) {
  const passwords = useLoad<AppPassword[]>("/api/app-passwords");
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<AppPassword | null>(null);

  return (
    <SettingsPage title={t("settings.devices")} intro={t("devices.intro")}>
      <AppsCard />
      <SessionsCard />
      <RemoteCard admin={admin} />
      <section class="settings-card">
        <h2>{t("devices.title")}</h2>
        <p>{t("devices.passwordsIntro")}</p>
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
        <dl class="facts">
          <dt>{t("devices.address")}</dt>
          <dd>
            <code>{`${location.origin}/dav/drive/`}</code>
          </dd>
          <dt>{t("devices.sharedAddress")}</dt>
          <dd>
            <code>{`${location.origin}/dav/shared/`}</code>
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

interface AppCode {
  code: string;
  expires_at: string;
  /** With remote access on: the code and a temporary tunnel key, for an
   * app away from home. */
  setup: string | null;
  qr_code: string | null;
}

/** Adds one of Accordion's apps with a code, which works away from home
 * too (decision 23). */
function AppsCard() {
  const [code, setCode] = useState<AppCode | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [checked, passwordDialog] = usePasswordCheck();

  async function make() {
    setBusy(true);
    setError("");
    try {
      const made = await checked(() => api<AppCode>("POST", "/api/app-codes"));
      if (made) setCode(made);
    } catch (problem) {
      setError(problemText(problem));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section class="settings-card">
      <h2>{t("devices.appsTitle")}</h2>
      <p>{t("devices.appsIntro")}</p>
      <p class="error" role="alert">
        {error}
      </p>
      <div class="form-buttons">
        <button type="button" disabled={busy} onClick={() => void make()}>
          {t("devices.appsAdd")}
        </button>
      </div>
      {passwordDialog}
      {code && (
        <Dialog title={t("devices.appsCodeTitle")} onClose={() => setCode(null)}>
          <p>{t("devices.appsCodeBody")}</p>
          <dl class="facts">
            <dt>{t("devices.appsServer")}</dt>
            <dd>
              <code>{location.origin}</code>
            </dd>
            <dt>{t("devices.appsCode")}</dt>
          </dl>
          <Secret text={code.code} />
          {code.setup && code.qr_code && (
            <>
              <h3>{t("devices.appsAwayTitle")}</h3>
              <p>{t("devices.appsAwayBody")}</p>
              {/* The server draws the SVG itself, with no scripts, as for
                  remote access devices. */}
              <div
                class="qr-code"
                role="img"
                aria-label={t("devices.appsQrLabel")}
                dangerouslySetInnerHTML={{ __html: code.qr_code.replace(/^<\?xml[^>]*>\s*/, "") }}
              />
              <Secret text={code.setup} label={t("devices.appsCopySetup")} long />
            </>
          )}
          <p class="hint">
            {t("devices.appsCodeOnce", {
              time: new Date(code.expires_at).toLocaleTimeString(undefined, { timeStyle: "short" }),
            })}
          </p>
          <div class="dialog-buttons">
            <button type="button" autofocus onClick={() => setCode(null)}>
              {t("devices.done")}
            </button>
          </div>
        </Dialog>
      )}
    </section>
  );
}

interface SignedInSession {
  id: string;
  device_name: string;
  client: "browser" | "app";
  created_at: string;
  last_used_at: string;
  current: boolean;
}

/** The browsers and apps the reader is signed in on, each with a way to
 * sign it out (decision 3). */
function SessionsCard() {
  const sessions = useLoad<SignedInSession[]>("/api/sessions");
  const [ending, setEnding] = useState<SignedInSession | null>(null);

  return (
    <section class="settings-card">
      <h2>{t("devices.sessionsTitle")}</h2>
      <p>{t("devices.sessionsIntro")}</p>
      {sessions.data === null ? (
        <LoadState error={sessions.error} />
      ) : (
        <ul class="rows">
          {sessions.data.map((session) => (
            <li key={session.id} class="row">
              <div class="row-text">
                <strong>{session.device_name}</strong>
                <span class="hint">
                  {t(session.client === "app" ? "devices.sessionApp" : "devices.sessionBrowser")}{" "}
                  {session.current
                    ? t("devices.sessionThis")
                    : t("devices.sessionUsed", {
                        created: formatDay(session.created_at),
                        used: formatDay(session.last_used_at),
                      })}
                </span>
              </div>
              {!session.current && (
                <button type="button" class="secondary" onClick={() => setEnding(session)}>
                  {t("devices.sessionSignOut")}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {ending && (
        <ConfirmDialog
          title={t("devices.sessionSignOutTitle", { name: ending.device_name })}
          body={t(ending.client === "app" ? "devices.sessionSignOutApp" : "devices.sessionSignOutBrowser", {
            name: ending.device_name,
          })}
          confirm={t("devices.sessionSignOut")}
          onConfirm={async () => {
            await api("DELETE", `/api/sessions/${ending.id}`);
            setEnding(null);
            await sessions.reload();
          }}
          onClose={() => setEnding(null)}
        />
      )}
    </section>
  );
}

/** The reader's remote access devices, with a way to add one. */
function RemoteCard({ admin }: { admin: boolean }) {
  const remote = useLoad<RemoteDevices>("/api/remote-devices");
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<RemoteDevice | null>(null);
  const data = remote.data;
  // A server without remote access says so, and the card stays away.
  if (data === null && remote.error) return null;

  return (
    <section class="settings-card">
      <h2>{t("devices.remoteTitle")}</h2>
      <p>{t("devices.remoteIntro")}</p>
      {data === null ? (
        <LoadState error={remote.error} />
      ) : (
        <>
          {!data.on && (
            <p class="hint">
              {admin ? (
                <>
                  {t("devices.remoteOffAdmin")}{" "}
                  <a href="/settings/remote" onClick={followLink}>
                    {t("settings.remote")}
                  </a>
                </>
              ) : (
                t("devices.remoteOff")
              )}
            </p>
          )}
          {data.devices.length === 0 ? (
            data.on && <p class="hint">{t("devices.remoteNone")}</p>
          ) : (
            <ul class="rows">
              {data.devices.map((device) => (
                <li key={device.id} class="row">
                  <div class="row-text">
                    <strong>{device.name}</strong>
                    <span class="hint">
                      {t("devices.remoteAdded", { created: formatDay(device.created_at) })} {connectedLine(device)}
                    </span>
                    {device.out_of_date && <span class="hint">{t("remote.outOfDate")}</span>}
                  </div>
                  <button type="button" class="secondary" onClick={() => setRemoving(device)}>
                    {t("remote.remove")}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {data.on && (
            <div class="form-buttons">
              <button type="button" disabled={data.devices.length >= data.max} onClick={() => setAdding(true)}>
                {t("devices.remoteAdd")}
              </button>
            </div>
          )}
          {data.on && data.devices.length >= data.max && (
            <p class="hint">{t("devices.remoteMax", { max: String(data.max) })}</p>
          )}
        </>
      )}

      {adding && <AddDeviceDialog onAdded={() => void remote.reload()} onClose={() => setAdding(false)} />}
      {removing && (
        <ConfirmDialog
          title={t("remote.removeTitle", { name: removing.name })}
          body={t("devices.remoteRemoveBody", { name: removing.name })}
          confirm={t("remote.remove")}
          onConfirm={async () => {
            await api("DELETE", `/api/remote-devices/${removing.id}`);
            setRemoving(null);
            await remote.reload();
          }}
          onClose={() => setRemoving(null)}
        />
      )}
    </section>
  );
}

/** Names the device, then shows its setup once: a QR code for phones, and
 * a file for computers. */
function AddDeviceDialog({ onAdded, onClose }: { onAdded: () => void; onClose: () => void }) {
  const [name, setName] = useState("");
  const [added, setAdded] = useState<AddedDevice | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [checked, passwordDialog] = usePasswordCheck();
  const [download, setDownload] = useState("");

  // The file's address lasts as long as the dialog.
  useEffect(() => {
    if (!added) return;
    const url = URL.createObjectURL(new Blob([added.config], { type: "text/plain" }));
    setDownload(url);
    return () => URL.revokeObjectURL(url);
  }, [added]);

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const made = await checked(() => api<AddedDevice>("POST", "/api/remote-devices", { name }));
      if (made) {
        setAdded(made);
        onAdded();
      }
    } catch (problem) {
      setError(problemText(problem));
    } finally {
      setBusy(false);
    }
  }

  if (added) {
    return (
      <Dialog title={t("devices.remoteAddedTitle", { name: added.device.name })} onClose={onClose}>
        <ol class="steps">
          <li>{t("devices.remoteStepApp")}</li>
          <li>{t("devices.remoteStepPhone")}</li>
          <li>{t("devices.remoteStepComputer")}</li>
        </ol>
        {/* The page's policy allows no data: images, so the server's SVG,
            which it draws itself and which has no scripts, goes in as is. */}
        <div
          class="qr-code"
          role="img"
          aria-label={t("devices.remoteQrLabel", { name: added.device.name })}
          dangerouslySetInnerHTML={{ __html: added.qr_code.replace(/^<\?xml[^>]*>\s*/, "") }}
        />
        <div class="form-buttons">
          <a class="button secondary" href={download} download={added.file_name}>
            {t("devices.remoteDownload")}
          </a>
        </div>
        <p class="hint">{t("devices.remoteOnce")}</p>
        <p class="hint">{t("devices.remoteAway")}</p>
        <div class="dialog-buttons">
          <button type="button" autofocus onClick={onClose}>
            {t("devices.done")}
          </button>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog title={t("devices.remoteAdd")} onClose={onClose}>
      <form onSubmit={submit}>
        <label for="remote-device-name">{t("devices.deviceName")}</label>
        <p class="hint">{t("devices.remoteNameHint")}</p>
        <input
          id="remote-device-name"
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
            {t("devices.remoteAddButton")}
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
