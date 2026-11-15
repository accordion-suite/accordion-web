// Notes' settings for lists: where new items go, and whether checked items
// move to the bottom, as in Google Keep. They save as soon as they change,
// and follow the reader to every device.

import { useState } from "preact/hooks";

import { t } from "../i18n.ts";
import { type NotesSettings, saveNotesSettings, useNotesSettings } from "../notes/preferences.ts";
import { problemText } from "../shell/dialog.tsx";
import { SettingsPage } from "./layout.tsx";
import { LoadState, type Outcome, OutcomeLine } from "./parts.tsx";

export function NotesPage() {
  const settings = useNotesSettings();
  const [outcome, setOutcome] = useState<Outcome>(null);

  async function save(change: Partial<NotesSettings>) {
    setOutcome(null);
    try {
      await saveNotesSettings(change);
      setOutcome({ done: t("notesSettings.saved") });
    } catch (problem) {
      setOutcome({ problem: problemText(problem) });
    }
  }

  if (!settings) {
    return (
      <SettingsPage title={t("settings.notesLists")}>
        <LoadState error="" />
      </SettingsPage>
    );
  }

  return (
    <SettingsPage title={t("settings.notesLists")}>
      <OutcomeLine outcome={outcome} />
      <section class="settings-card">
        <h2 id="new-items-title">{t("notesSettings.newItemsTitle")}</h2>
        <p class="hint">{t("notesSettings.newItemsIntro")}</p>
        <fieldset class="choices" aria-labelledby="new-items-title">
          {(["bottom", "top"] as const).map((place) => (
            <label class="choice" key={place}>
              <input
                type="radio"
                name="new-items"
                checked={settings.new_items === place}
                onChange={() => void save({ new_items: place })}
              />
              <span class="choice-text">
                <strong>{t(`notesSettings.${place}`)}</strong>
                <span class="hint">{t(`notesSettings.${place}Hint`)}</span>
              </span>
            </label>
          ))}
        </fieldset>
      </section>
      <section class="settings-card">
        <div class="switch-row">
          <div>
            <h2 id="checked-title">{t("notesSettings.checkedTitle")}</h2>
            <p class="hint" id="checked-hint">
              {t("notesSettings.checkedHint")}
            </p>
          </div>
          <input
            type="checkbox"
            role="switch"
            class="switch"
            aria-labelledby="checked-title"
            aria-describedby="checked-hint"
            checked={settings.checked_at_bottom}
            onChange={(event) => void save({ checked_at_bottom: event.currentTarget.checked })}
          />
        </div>
      </section>
    </SettingsPage>
  );
}
