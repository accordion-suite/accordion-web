// Transcripts of voice memos recorded in Notes (decision 33), for everyone
// on the server. Turning them on downloads a speech model from Accordion's
// release, and the words never leave the server. Admins only.

import { useState } from "preact/hooks";

import { api } from "../api.ts";
import { formatSize, t, type MessageKey } from "../i18n.ts";
import { problemText } from "../shell/dialog.tsx";
import { SettingsPage } from "./layout.tsx";
import { LoadState, useLoad } from "./parts.tsx";

type ModelId = "base" | "small";

interface Transcripts {
  /** null while transcribing is off. */
  model: ModelId | null;
  state: "off" | "downloading" | "ready" | "failed";
  done: number;
  total: number;
  problem: string | null;
  /** Why this server can't transcribe whatever the setting. */
  unavailable: string | null;
  recommended: ModelId;
  models: { id: ModelId; size: number }[];
}

const MODELS: Record<ModelId, [MessageKey, MessageKey]> = {
  base: ["transcripts.faster", "transcripts.fasterHint"],
  small: ["transcripts.accurate", "transcripts.accurateHint"],
};

/** How often the page looks again while the model downloads. */
const WHILE_DOWNLOADING = 1000;

export function TranscriptsPage() {
  const setting = useLoad<Transcripts>("/api/notes/transcripts", WHILE_DOWNLOADING, (data) => data.state === "downloading");
  const [error, setError] = useState("");
  const data = setting.data;

  async function choose(model: ModelId | null) {
    setError("");
    try {
      setting.replace(await api<Transcripts>("PUT", "/api/notes/transcripts", { model }));
      // Follows the download.
      void setting.reload();
    } catch (problem) {
      setError(problemText(problem));
    }
  }

  const sizeOf = (id: ModelId) => formatSize(data?.models.find((model) => model.id === id)?.size ?? 0);

  return (
    <SettingsPage title={t("settings.notesTranscripts")} intro={t("transcripts.intro")}>
      <section class="settings-card">
        {data === null ? (
          <LoadState error={setting.error} />
        ) : (
          <>
            <div class="switch-row">
              <div>
                <h2 id="transcripts-title">{t("transcripts.switchTitle")}</h2>
                <p class="hint" id="transcripts-hint">
                  {t("transcripts.switchHint", { size: sizeOf(data.model ?? data.recommended) })}
                </p>
              </div>
              <input
                type="checkbox"
                role="switch"
                class="switch"
                aria-labelledby="transcripts-title"
                aria-describedby="transcripts-hint"
                checked={data.model !== null}
                onChange={(event) => void choose(event.currentTarget.checked ? data.recommended : null)}
              />
            </div>
            {data.unavailable && (
              <p class="hint" role="status">
                {t("transcripts.unavailable", { reason: data.unavailable })}
              </p>
            )}
            {data.model !== null && <Progress data={data} onRetry={() => void choose(data.model)} />}
          </>
        )}
      </section>
      {data !== null && data.model !== null && (
        <section class="settings-card">
          <h2 id="model-title">{t("transcripts.modelTitle")}</h2>
          <p class="hint">{t("transcripts.modelHint")}</p>
          <fieldset class="choices" aria-labelledby="model-title">
            {data.models.map(({ id }) => {
              const [label, hint] = MODELS[id];
              return (
                <label key={id} class="choice">
                  <input type="radio" name="model" checked={data.model === id} onChange={() => void choose(id)} />
                  <span class="choice-text">
                    <strong>{id === data.recommended ? t("transcripts.labelRecommended", { label: t(label) }) : t(label)}</strong>
                    <span class="hint">{t(hint, { size: sizeOf(id) })}</span>
                  </span>
                </label>
              );
            })}
          </fieldset>
        </section>
      )}
      {error && (
        <p class="error" role="alert">
          {error}
        </p>
      )}
    </SettingsPage>
  );
}

/** Where the chosen model is: downloading, ready, or failed. */
function Progress({ data, onRetry }: { data: Transcripts; onRetry: () => void }) {
  if (data.state === "downloading") {
    // Checking a model that's already here has nothing to count.
    if (data.total === 0) {
      return (
        <p class="hint" role="status">
          {t("transcripts.checking")}
        </p>
      );
    }
    return (
      <div class="transcripts-progress" role="status">
        <progress max={data.total} value={data.done} aria-labelledby="transcripts-downloading" />
        <p class="hint" id="transcripts-downloading">
          {t("transcripts.downloading", { done: formatSize(data.done), total: formatSize(data.total) })}
        </p>
      </div>
    );
  }
  if (data.state === "failed") {
    return (
      <div role="alert">
        <p class="error">{t("transcripts.failed", { problem: data.problem ?? "" })}</p>
        <button type="button" class="secondary" onClick={onRetry}>
          {t("transcripts.tryAgain")}
        </button>
      </div>
    );
  }
  return (
    <p class="hint" role="status">
      {t("transcripts.ready")}
    </p>
  );
}
