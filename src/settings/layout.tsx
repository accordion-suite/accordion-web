// Settings' frame: the top bar, and a sidebar with each section, in groups
// as Proton's settings are: the reader's own, one for each app with
// settings, and the server's. Each app's gear opens its group. The server's
// sections are for admins, and only where the server lets them in, usually
// on the home network.

import type { ComponentChildren, FunctionComponent } from "preact";
import { useEffect, useState } from "preact/hooks";

import type { Session } from "../api.ts";
import { DriveIcon } from "../drive/icons.tsx";
import { t, type MessageKey } from "../i18n.ts";
import { PageTitle } from "../shell/page.tsx";
import { followLink, usePath } from "../shell/router.ts";
import { TopBar } from "../shell/top-bar.tsx";
import {
  BackIcon,
  BackupIcon,
  DevicesIcon,
  HealthIcon,
  NetworkIcon,
  PaletteIcon,
  PeopleIcon,
  PersonIcon,
  UpdatesIcon,
} from "./icons.tsx";

export interface Section {
  /** The last part of its address, such as "people" for /settings/people. */
  id: string;
  label: MessageKey;
  icon: FunctionComponent;
  group: Group;
}

/** The reader's own settings, an app's, or the server's, which are for
 * admins. */
type Group = "you" | "drive" | "server";

const GROUPS: readonly [Group, MessageKey][] = [
  ["you", "settings.you"],
  ["drive", "settings.driveGroup"],
  ["server", "settings.server"],
];

export const SECTIONS: readonly Section[] = [
  { id: "account", label: "settings.account", icon: PersonIcon, group: "you" },
  { id: "appearance", label: "settings.appearance", icon: PaletteIcon, group: "you" },
  { id: "devices", label: "settings.devices", icon: DevicesIcon, group: "you" },
  { id: "drive", label: "settings.driveGeneral", icon: DriveIcon, group: "drive" },
  { id: "people", label: "settings.people", icon: PeopleIcon, group: "server" },
  { id: "health", label: "settings.health", icon: HealthIcon, group: "server" },
  { id: "backups", label: "settings.backups", icon: BackupIcon, group: "server" },
  { id: "updates", label: "settings.updates", icon: UpdatesIcon, group: "server" },
  { id: "network", label: "settings.network", icon: NetworkIcon, group: "server" },
];

export function SettingsLayout({
  session,
  onSignOut,
  children,
}: {
  session: Session;
  onSignOut: () => void;
  children: ComponentChildren;
}) {
  const path = usePath();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // A page on a phone starts with the sidebar out of the way.
  useEffect(() => setSidebarOpen(false), [path]);

  return (
    <div class={sidebarOpen ? "frame settings-frame sidebar-open" : "frame settings-frame"}>
      <TopBar
        session={session}
        onSignOut={onSignOut}
        module={t("settings.title")}
        home="/settings/"
        menuOpen={sidebarOpen}
        onMenu={() => setSidebarOpen(!sidebarOpen)}
      />
      <nav id="sidebar" class="sidebar" aria-label={t("settings.sections")}>
        <a class="place back" href="/drive/" onClick={followLink}>
          <BackIcon />
          {t("settings.backToDrive")}
        </a>
        {GROUPS.filter(([group]) => group !== "server" || session.admin_pages).map(([group, title]) => (
          <GroupLinks
            key={group}
            title={t(title)}
            sections={SECTIONS.filter((section) => section.group === group)}
            path={path}
          />
        ))}
      </nav>
      {/* Closes the sidebar on a phone when the reader taps beside it. */}
      <div class="sidebar-scrim" aria-hidden="true" onClick={() => setSidebarOpen(false)} />
      <div class="frame-main">{children}</div>
    </div>
  );
}

function GroupLinks({ title, sections, path }: { title: string; sections: readonly Section[]; path: string }) {
  return (
    <>
      <h2 class="places-title">{title}</h2>
      <ul class="places">
        {sections.map(({ id, label, icon: SectionIcon }) => {
          const href = `/settings/${id}`;
          return (
            <li key={id}>
              <div class="place-row">
                <a class="place" href={href} onClick={followLink} aria-current={path === href ? "page" : undefined}>
                  <SectionIcon />
                  {t(label)}
                </a>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/** A section's page: its title, then its content. */
export function SettingsPage({
  title,
  intro,
  children,
}: {
  title: string;
  intro?: ComponentChildren;
  children: ComponentChildren;
}) {
  return (
    <main class="page settings-page">
      <div class="page-head">
        <PageTitle>{title}</PageTitle>
      </div>
      {intro && <p class="settings-intro">{intro}</p>}
      {children}
    </main>
  );
}
