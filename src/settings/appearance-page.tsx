// Appearance: light, dark, or the device's own setting, for every app.

import { useState } from "preact/hooks";

import { t } from "../i18n.ts";
import { type Appearance, savedAppearance, setAppearance } from "../shell/appearance.ts";
import { SettingsPage } from "./layout.tsx";

const CHOICES: readonly [Appearance, "appearance.light" | "appearance.dark" | "appearance.auto"][] = [
  ["light", "appearance.light"],
  ["dark", "appearance.dark"],
  ["auto", "appearance.auto"],
];

export function AppearancePage() {
  const [chosen, setChosen] = useState(savedAppearance);
  return (
    <SettingsPage title={t("settings.appearance")}>
      <section class="settings-card">
        <h2 id="theme-title">{t("appearance.theme")}</h2>
        <p class="hint">{t("appearance.intro")}</p>
        <fieldset class="choices" aria-labelledby="theme-title">
          {CHOICES.map(([value, label]) => (
            <label key={value} class="choice">
              <input
                type="radio"
                name="appearance"
                checked={chosen === value}
                onChange={() => {
                  setAppearance(value);
                  setChosen(value);
                }}
              />
              <span>
                <strong>{t(label)}</strong>
                {value === "auto" && <> {t("appearance.autoHint")}</>}
              </span>
            </label>
          ))}
        </fieldset>
      </section>
    </SettingsPage>
  );
}
