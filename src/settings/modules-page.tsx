// The admin's Modules page (decisions 7 and 31): each module, such as Drive
// or Notes, with a switch. A module that's off disappears from everyone's
// apps, and its data stays. The page also shows how much memory the server
// uses, as the spec asks.

import { useState } from "preact/hooks";

import { api } from "../api.ts";
import { formatList, formatSize, t, type MessageKey } from "../i18n.ts";
import { ConfirmDialog, problemText } from "../shell/dialog.tsx";
import { SettingsPage } from "./layout.tsx";
import { LoadState, useLoad } from "./parts.tsx";

interface ModuleView {
  id: string;
  name: string;
  requires: string[];
  on: boolean;
  size: number | null;
}

interface Modules {
  modules: ModuleView[];
  memory: number | null;
}

/** What each module is for, in a line. A module the web app doesn't know
 * yet shows without one. */
const ABOUT: Readonly<Record<string, MessageKey>> = {
  drive: "modules.aboutDrive",
  notes: "modules.aboutNotes",
};

type Asking = { module: ModuleView; on: boolean; needs: ModuleView[] };

export function ModulesPage() {
  const loaded = useLoad<Modules>("/api/admin/modules");
  const [asking, setAsking] = useState<Asking | null>(null);
  const [error, setError] = useState("");
  const data = loaded.data;

  const byId = (id: string) => data?.modules.find((module) => module.id === id);
  /** The running modules that need `module`. */
  const neededBy = (module: ModuleView) => (data?.modules ?? []).filter((other) => other.on && other.requires.includes(module.id));

  async function send(module: ModuleView, on: boolean, withRequired: boolean) {
    setError("");
    loaded.replace(await api<Modules>("PUT", `/api/admin/modules/${module.id}`, { on, with_required: withRequired }));
  }

  return (
    <SettingsPage title={t("settings.modules")} intro={t("modules.intro")}>
      {data === null ? (
        <LoadState error={loaded.error} />
      ) : (
        <>
          {data.modules.map((module) => {
            const needing = neededBy(module);
            const about = ABOUT[module.id];
            const hintId = `module-${module.id}-hint`;
            return (
              <section class="settings-card" key={module.id}>
                <div class="switch-row">
                  <div>
                    <h2 id={`module-${module.id}`}>{module.name}</h2>
                    <p class="hint" id={hintId}>
                      {about && <>{t(about)} </>}
                      {module.size !== null && t("modules.size", { size: formatSize(module.size) })}
                    </p>
                    {module.on && needing.length > 0 && (
                      <p class="hint">{t("modules.neededBy", { names: formatList(needing.map((other) => other.name)), name: module.name })}</p>
                    )}
                  </div>
                  <input
                    type="checkbox"
                    role="switch"
                    class="switch"
                    aria-labelledby={`module-${module.id}`}
                    aria-describedby={hintId}
                    checked={module.on}
                    disabled={module.on && needing.length > 0}
                    onChange={(event) => {
                      // The switch moves only once the server agrees.
                      event.currentTarget.checked = module.on;
                      const needs = module.on
                        ? []
                        : module.requires.map(byId).filter((other): other is ModuleView => !!other && !other.on);
                      setAsking({ module, on: !module.on, needs });
                    }}
                  />
                </div>
              </section>
            );
          })}
          {data.memory !== null && <p class="hint">{t("modules.memory", { size: formatSize(data.memory) })}</p>}
          {error && (
            <p class="error" role="alert">
              {error}
            </p>
          )}
        </>
      )}
      {asking && (
        <ConfirmDialog
          title={
            asking.on
              ? asking.needs.length > 0
                ? t("modules.onWithTitle", { name: asking.module.name, needs: formatList(asking.needs.map((other) => other.name)) })
                : t("modules.onTitle", { name: asking.module.name })
              : t("modules.offTitle", { name: asking.module.name })
          }
          body={
            asking.on
              ? asking.needs.length > 0
                ? t("modules.onWithBody", { name: asking.module.name, needs: formatList(asking.needs.map((other) => other.name)) })
                : t("modules.onBody", { name: asking.module.name })
              : t("modules.offBody", { name: asking.module.name })
          }
          confirm={t(asking.on ? "modules.turnOn" : "modules.turnOff", { name: asking.module.name })}
          safe={asking.on}
          onConfirm={async () => {
            try {
              await send(asking.module, asking.on, asking.needs.length > 0);
            } catch (problem) {
              setError(problemText(problem));
            }
            setAsking(null);
          }}
          onClose={() => setAsking(null)}
        />
      )}
    </SettingsPage>
  );
}
