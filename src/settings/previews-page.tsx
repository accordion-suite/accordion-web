// How the server prepares files the browser can't show on its own, for
// everyone on it: when videos are converted, and how much of the data disk
// previews may use (decision 26). Core does the work.

import { useState } from "preact/hooks";

import { api } from "../api.ts";
import { formatSize, t, type MessageKey } from "../i18n.ts";
import { problemText } from "../shell/dialog.tsx";
import { SettingsPage } from "./layout.tsx";
import { LoadState, useLoad } from "./parts.tsx";

type Conversion = "upload" | "opened" | "never";

interface Previews {
  /** null follows `automatic`, what the server's hardware suits. */
  convert_videos: Conversion | null;
  automatic: Conversion;
  cores: number;
  space_percent: number;
  used: number;
  limit: number;
  disk: number;
}

const CONVERSIONS: readonly [Conversion, MessageKey, MessageKey][] = [
  ["upload", "previews.upload", "previews.uploadHint"],
  ["opened", "previews.opened", "previews.openedHint"],
  ["never", "previews.never", "previews.neverHint"],
];

const SPACES = [5, 10, 20, 30] as const;

export function PreviewsPage() {
  const previews = useLoad<Previews>("/api/admin/previews");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const data = previews.data;

  async function choose(change: Partial<Pick<Previews, "convert_videos" | "space_percent">>) {
    setError("");
    setSaved(false);
    try {
      const next = await api<Previews>("PUT", "/api/admin/previews", {
        convert_videos: data!.convert_videos,
        space_percent: data!.space_percent,
        ...change,
      });
      previews.replace(next);
      setSaved(true);
    } catch (problem) {
      setError(problemText(problem));
    }
  }

  return (
    <SettingsPage title={t("settings.previews")} intro={t("previews.intro")}>
      <section class="settings-card">
        <h2 id="videos-title">{t("previews.videosTitle")}</h2>
        <p class="hint">{t("previews.videosHint")}</p>
        {data === null ? (
          <LoadState error={previews.error} />
        ) : (
          <>
            <fieldset class="choices" aria-labelledby="videos-title">
              {CONVERSIONS.map(([choice, label, hint]) => (
                <label key={choice} class="choice">
                  <input
                    type="radio"
                    name="convert_videos"
                    checked={(data.convert_videos ?? data.automatic) === choice}
                    // Choosing what the hardware suits follows it, so the
                    // server's choice can change with its hardware.
                    onChange={() => void choose({ convert_videos: choice === data.automatic ? null : choice })}
                  />
                  <span>
                    <strong>
                      {choice === data.automatic
                        ? t("previews.labelRecommended", { label: t(label) })
                        : t("previews.label", { label: t(label) })}
                    </strong>{" "}
                    {t(hint)}
                  </span>
                </label>
              ))}
            </fieldset>
            <p class="hint">
              {t(data.automatic === "upload" ? "previews.whyUpload" : "previews.whyOpened", { count: data.cores })}
            </p>
          </>
        )}
      </section>
      <section class="settings-card">
        <h2 id="space-title">{t("previews.spaceTitle")}</h2>
        <p class="hint">{t("previews.spaceHint")}</p>
        {data === null ? (
          <LoadState error={previews.error} />
        ) : (
          <>
            <fieldset class="choices" aria-labelledby="space-title">
              {SPACES.map((percent) => (
                <label key={percent} class="choice">
                  <input
                    type="radio"
                    name="space_percent"
                    checked={data.space_percent === percent}
                    onChange={() => void choose({ space_percent: percent })}
                  />
                  <span>
                    <strong>{t("previews.percent", { percent, size: formatSize((data.disk / 100) * percent) })}</strong>
                  </span>
                </label>
              ))}
            </fieldset>
            <p class="hint">{t("previews.used", { used: formatSize(data.used), limit: formatSize(data.limit) })}</p>
          </>
        )}
      </section>
      {error && (
        <p class="error" role="alert">
          {error}
        </p>
      )}
      {saved && (
        <p class="hint" role="status">
          {t("previews.saved")}
        </p>
      )}
    </SettingsPage>
  );
}
