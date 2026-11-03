// Remote access (decision 21): the admin's switch and port, how the router
// and the address record are doing, and everyone's devices. People add
// their own devices in Apps and devices.

import { useEffect, useState } from "preact/hooks";

import { api } from "../api.ts";
import { formatDay, formatMoment, t } from "../i18n.ts";
import { ConfirmDialog, problemText } from "../shell/dialog.tsx";
import { SettingsPage } from "./layout.tsx";
import { LoadState, useLoad } from "./parts.tsx";

export interface RemoteDevice {
  id: string;
  name: string;
  created_at: string;
  last_connected_at: string | null;
  out_of_date: boolean;
}

interface Status {
  available: boolean;
  named: boolean;
  on: boolean;
  port: number;
  network: string | null;
  endpoint: string | null;
  home_address: string | null;
  home_problem: string | null;
  listening: boolean;
  tunnel_problem: string | null;
  router: {
    method: string | null;
    external_port: number | null;
    external_address: string | null;
    shared_address: boolean;
    problem: string | null;
    no_answer: boolean;
    last_attempt: number | null;
  } | null;
  record: {
    ipv4: string | null;
    ipv4_set_by_provider: boolean;
    ipv6: string | null;
    problem: string | null;
  } | null;
  devices: (RemoteDevice & { owner: string })[];
}

/** How often the page checks again while the router or record is being
 * set up, so it shows the answer without a reload. */
const SETTLING_MS = 3 * 1000;

function settling(data: Status): boolean {
  if (!data.on) return false;
  const asking = data.router !== null && data.router.method === null && data.router.problem === null;
  return (data.named && asking) || (data.on && !data.listening && !data.tunnel_problem);
}

/** When a device last connected, or that it hasn't. */
export function connectedLine(device: RemoteDevice): string {
  return device.last_connected_at
    ? t("remote.connected", { when: formatMoment(Date.parse(device.last_connected_at)) })
    : t("remote.neverConnected");
}

export function RemotePage() {
  const status = useLoad<Status>("/api/remote-access", SETTLING_MS, settling);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [port, setPort] = useState("");
  const [removing, setRemoving] = useState<Status["devices"][number] | null>(null);
  const data = status.data;

  useEffect(() => {
    if (data && port === "") setPort(String(data.port));
  }, [data]);

  async function save(on: boolean) {
    setError("");
    const number = Number(port);
    if (!Number.isInteger(number) || number < 1 || number > 65535) {
      setError(t("remote.badPort"));
      return;
    }
    setBusy(true);
    try {
      await api("PUT", "/api/remote-access", { on, port: number });
      await status.reload();
    } catch (problem) {
      setError(problemText(problem));
    } finally {
      setBusy(false);
    }
  }

  if (data === null) {
    return (
      <SettingsPage title={t("settings.remote")} intro={t("remote.intro")}>
        <LoadState error={status.error} />
      </SettingsPage>
    );
  }

  return (
    <SettingsPage title={t("settings.remote")} intro={t("remote.intro")}>
      <p class="error" role="alert">
        {error || status.error}
      </p>
      <section class="settings-card">
        <h2>{t(data.on ? "remote.onTitle" : "remote.offTitle")}</h2>
        {!data.named && <p class="hint">{t("remote.unnamed")}</p>}
        {data.on ? null : <p>{t("remote.offBody")}</p>}
        {data.home_problem && <p class="error">{data.home_problem}</p>}
        {data.on && data.tunnel_problem && <p class="error">{data.tunnel_problem}</p>}
        <label for="remote-port">{t("remote.port")}</label>
        <p class="hint">{t("remote.portHint")}</p>
        <input
          id="remote-port"
          class="short"
          inputMode="numeric"
          value={port}
          onInput={(event) => setPort(event.currentTarget.value)}
        />
        <div class="form-buttons">
          <button type="button" disabled={busy} onClick={() => void save(!data.on)}>
            {t(data.on ? "remote.turnOff" : "remote.turnOn")}
          </button>
          {data.on && String(data.port) !== port && (
            <button type="button" class="secondary" disabled={busy} onClick={() => void save(true)}>
              {t("remote.savePort")}
            </button>
          )}
        </div>
        {data.on && <p class="hint">{t("remote.turnOffHint")}</p>}
      </section>

      {data.on && data.named && <RouterCard data={data} />}
      {data.on && <AddressCard data={data} />}

      <section class="settings-card">
        <h2>{t("remote.devicesTitle")}</h2>
        {data.devices.length === 0 ? (
          <p class="hint">{t("remote.devicesNone")}</p>
        ) : (
          <ul class="rows">
            {data.devices.map((device) => (
              <li key={device.id} class="row">
                <div class="row-text">
                  <strong>{device.name}</strong>
                  <span class="hint">
                    {t("remote.deviceLine", { owner: device.owner, created: formatDay(device.created_at) })}{" "}
                    {connectedLine(device)}
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
      </section>

      {removing && (
        <ConfirmDialog
          title={t("remote.removeTitle", { name: removing.name })}
          body={t("remote.removeBody", { name: removing.name, owner: removing.owner })}
          confirm={t("remote.remove")}
          onConfirm={async () => {
            await api("DELETE", `/api/remote-access/devices/${removing.id}`);
            setRemoving(null);
            await status.reload();
          }}
          onClose={() => setRemoving(null)}
        />
      )}
    </SettingsPage>
  );
}

/** Whether the router forwards the port, and what to do if it doesn't. */
function RouterCard({ data }: { data: Status }) {
  const router = data.router;
  if (!router) return null;
  const port = router.external_port ?? data.port;
  return (
    <section class="settings-card">
      <h2>{t("remote.routerTitle")}</h2>
      {router.method ? (
        <p>{t("remote.routerMapped", { port: String(port), method: router.method })}</p>
      ) : router.problem ? (
        <p>{t("remote.routerRefused", { problem: router.problem })}</p>
      ) : (
        <p role="status">{t("remote.routerAsking", { port: String(port) })}</p>
      )}
      {router.shared_address && (
        <>
          <p class="error">{t("remote.shared")}</p>
          {data.record?.ipv6 && <p>{t("remote.sharedIpv6", { address: data.record.ipv6 })}</p>}
          <p>{t("remote.sharedOptions")}</p>
        </>
      )}
      {!router.method && router.problem && (
        <>
          <h3>{t("remote.forwardTitle")}</h3>
          <p>{t("remote.forwardSteps")}</p>
          <dl class="facts">
            <dt>{t("remote.forwardProtocol")}</dt>
            <dd>UDP</dd>
            <dt>{t("remote.forwardPort")}</dt>
            <dd>{data.port}</dd>
            <dt>{t("remote.forwardTo")}</dt>
            <dd>{data.home_address ?? t("remote.unknown")}</dd>
          </dl>
          <p class="hint">{t("remote.forwardGuide")}</p>
        </>
      )}
    </section>
  );
}

/** Where devices find home, and the addresses there. */
function AddressCard({ data }: { data: Status }) {
  const record = data.record;
  return (
    <section class="settings-card">
      <h2>{t("remote.addressTitle")}</h2>
      {data.endpoint && (
        <p>{t(data.named ? "remote.addressBody" : "remote.addressUnnamed", { endpoint: data.endpoint })}</p>
      )}
      <dl class="facts">
        {record && (
          <>
            <dt>{t("remote.publicAddress")}</dt>
            <dd>
              {record.ipv4 ?? (record.ipv4_set_by_provider ? t("remote.setByProvider") : t("remote.unknown"))}
            </dd>
            {record.ipv6 && (
              <>
                <dt>{t("remote.publicIpv6")}</dt>
                <dd>{record.ipv6}</dd>
              </>
            )}
          </>
        )}
        <dt>{t("remote.homeAddress")}</dt>
        <dd>{data.home_address ?? t("remote.unknown")}</dd>
        {data.network && (
          <>
            <dt>{t("remote.tunnelAddresses")}</dt>
            <dd>{data.network}</dd>
          </>
        )}
      </dl>
      {record?.problem && <p class="error">{t("remote.recordProblem", { problem: record.problem })}</p>}
    </section>
  );
}
