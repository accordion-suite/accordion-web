// The reader's own activity log: sign-ins, wrong passwords, changes to
// their password and app passwords, and sharing to and from them. Nobody
// else sees it, admins included.

import { t } from "../i18n.ts";
import { SettingsPage } from "./layout.tsx";
import { LogList } from "./log-list.tsx";

export function ActivityPage({ me }: { me: string }) {
  return (
    <SettingsPage title={t("settings.activity")} intro={t("log.intro")}>
      <section class="settings-card">
        <h2>{t("log.title")}</h2>
        <LogList path="/api/account/activity" me={me} />
      </section>
    </SettingsPage>
  );
}
