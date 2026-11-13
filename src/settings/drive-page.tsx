// Drive's settings: the page Drive opens on, what clicking an item does,
// and thumbnails in grid view.
// They save as soon as they change, and follow the reader to every device.

import { useState } from "preact/hooks";

import { type ClickAction, type DriveSettings, saveDriveSettings, useDriveSettings } from "../drive/preferences.ts";
import { type MessageKey, t } from "../i18n.ts";
import { problemText } from "../shell/dialog.tsx";
import { SettingsPage } from "./layout.tsx";
import { LoadState, type Outcome, OutcomeLine } from "./parts.tsx";

const CLICK_CHOICES: { value: ClickAction; label: MessageKey; hint: MessageKey }[] = [
  { value: "select", label: "driveSettings.clickSelect", hint: "driveSettings.clickSelectHint" },
  { value: "open", label: "driveSettings.clickOpen", hint: "driveSettings.clickOpenHint" },
  { value: "download", label: "driveSettings.clickDownload", hint: "driveSettings.clickDownloadHint" },
];

export function DrivePage() {
  const settings = useDriveSettings();
  const [outcome, setOutcome] = useState<Outcome>(null);

  async function save(change: Partial<DriveSettings>) {
    setOutcome(null);
    try {
      await saveDriveSettings(change);
      setOutcome({ done: t("driveSettings.saved") });
    } catch (problem) {
      setOutcome({ problem: problemText(problem) });
    }
  }

  if (!settings) {
    return (
      <SettingsPage title={t("settings.driveTitle")}>
        <LoadState error="" />
      </SettingsPage>
    );
  }

  return (
    <SettingsPage title={t("settings.driveTitle")}>
      <OutcomeLine outcome={outcome} />
      <section class="settings-card">
        <h2 id="start-title">{t("driveSettings.startTitle")}</h2>
        <p class="hint">{t("driveSettings.startIntro")}</p>
        <fieldset class="choices" aria-labelledby="start-title">
          <label class="choice">
            <input
              type="radio"
              name="start-page"
              checked={settings.start_page === "home"}
              onChange={() => void save({ start_page: "home" })}
            />
            <span>
              <strong>{t("driveSettings.home")}</strong> {t("driveSettings.homeHint")}
            </span>
          </label>
          <label class="choice">
            <input
              type="radio"
              name="start-page"
              checked={settings.start_page === "my-drive"}
              onChange={() => void save({ start_page: "my-drive" })}
            />
            <span>
              <strong>{t("driveSettings.myDrive")}</strong> {t("driveSettings.myDriveHint")}
            </span>
          </label>
        </fieldset>
      </section>
      <section class="settings-card">
        <h2 id="click-title">{t("driveSettings.clickTitle")}</h2>
        <p class="hint">{t("driveSettings.clickIntro")}</p>
        <fieldset class="choices" aria-labelledby="click-title">
          {CLICK_CHOICES.map((choice) => (
            <label class="choice" key={choice.value}>
              <input
                type="radio"
                name="click"
                checked={settings.click === choice.value}
                onChange={() => void save({ click: choice.value })}
              />
              <span>
                <strong>{t(choice.label)}</strong> {t(choice.hint)}
              </span>
            </label>
          ))}
        </fieldset>
      </section>
      <section class="settings-card">
        <div class="switch-row">
          <div>
            <h2 id="thumbnails-title">{t("driveSettings.thumbnailsTitle")}</h2>
            <p class="hint" id="thumbnails-hint">
              {t("driveSettings.thumbnailsHint")}
            </p>
          </div>
          <input
            type="checkbox"
            role="switch"
            class="switch"
            aria-labelledby="thumbnails-title"
            aria-describedby="thumbnails-hint"
            checked={settings.thumbnails}
            onChange={(event) => void save({ thumbnails: event.currentTarget.checked })}
          />
        </div>
      </section>
    </SettingsPage>
  );
}
