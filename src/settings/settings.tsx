// Settings: its frame and the section for the address. The app loads this
// module only when Settings opens, so Drive's first load stays small.

import "./messages.ts";

import type { Session } from "../api.ts";
import { t } from "../i18n.ts";
import { AccountPage } from "./account-page.tsx";
import { AppearancePage } from "./appearance-page.tsx";
import { BackupsPage } from "./backups-page.tsx";
import { DevicesPage } from "./devices-page.tsx";
import { DrivePage } from "./drive-page.tsx";
import { HealthPage } from "./health-page.tsx";
import { SECTIONS, SettingsLayout, SettingsPage } from "./layout.tsx";
import { NetworkPage } from "./network-page.tsx";
import { PeoplePage } from "./people-page.tsx";
import { UpdatesPage } from "./updates-page.tsx";

export function Settings({
  path,
  session,
  onSessionChanged,
  onSignOut,
}: {
  path: string;
  session: Session;
  /** Loads the session again, such as after the reader renames themselves. */
  onSessionChanged: () => Promise<void>;
  onSignOut: () => void;
}) {
  return (
    <SettingsLayout session={session} onSignOut={onSignOut}>
      {sectionPage(path, session, onSessionChanged) ?? (
        <SettingsPage title={t("notFound.title")}>
          <p>{t("notFound.body")}</p>
        </SettingsPage>
      )}
    </SettingsLayout>
  );
}

/** The section for `path`, or null if there isn't one. */
function sectionPage(path: string, session: Session, onSessionChanged: () => Promise<void>) {
  const id = /^\/settings\/([a-z]+)\/?$/.exec(path)?.[1];
  const section = SECTIONS.find((each) => each.id === id);
  if (!section) return null;
  if (section.group === "server" && !session.admin_pages) {
    return (
      <SettingsPage key={id} title={t(section.label)}>
        <p>{t(session.user.role === "owner" || session.user.role === "admin" ? "settings.notHere" : "settings.adminsOnly")}</p>
      </SettingsPage>
    );
  }
  switch (id) {
    case "account":
      return <AccountPage key={id} session={session} onChanged={onSessionChanged} />;
    case "appearance":
      return <AppearancePage key={id} />;
    case "drive":
      return <DrivePage key={id} />;
    case "devices":
      return <DevicesPage key={id} username={session.user.username} />;
    case "people":
      return <PeoplePage key={id} />;
    case "health":
      return <HealthPage key={id} />;
    case "backups":
      return <BackupsPage key={id} />;
    case "updates":
      return <UpdatesPage key={id} />;
    case "network":
      return <NetworkPage key={id} />;
  }
  return null;
}
