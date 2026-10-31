// The bar along the top of every signed-in page: Accordion's name with the
// module's, a place for the page's search, a way to Settings, and the
// reader's account.

import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";

import type { Session } from "../api.ts";
import { MenuIcon } from "../drive/icons.tsx";
import { SettingsIcon } from "../settings/icons.tsx";
import { t } from "../i18n.ts";
import { Menu, SEPARATOR, type MenuPlace } from "./menu.tsx";
import { followLink, navigate } from "./router.ts";

export function TopBar({
  session,
  onSignOut,
  module = t("drive.title"),
  home = "/drive/start",
  settings,
  menuOpen,
  onMenu,
  children,
}: {
  session: Session;
  onSignOut: () => void;
  /** The module's name beside Accordion's, and where it leads. */
  module?: string;
  home?: string;
  /** Where the gear leads: this module's group in Settings. No gear in
   * Settings itself. */
  settings?: string;
  /** Whether the sidebar is open, on screens too small to show it always. */
  menuOpen?: boolean;
  onMenu?: () => void;
  children?: ComponentChildren;
}) {
  const [account, setAccount] = useState<{ place: MenuPlace; byKeyboard: boolean } | null>(null);
  const name = session.user.display_name;

  return (
    <header class="top-bar">
      {onMenu && (
        <button
          type="button"
          class="icon-button sidebar-button"
          aria-label={t("shell.mainMenu")}
          aria-controls="sidebar"
          aria-expanded={menuOpen}
          onClick={onMenu}
        >
          <MenuIcon />
        </button>
      )}
      <a class="brand" href={home} onClick={followLink}>
        <span class="brand-name">{t("app.name")}</span>
        <span class="brand-module">{module}</span>
      </a>
      <div class="top-bar-middle">{children}</div>
      {settings && (
        <a class="icon-button" href={settings} title={t("settings.title")} aria-label={t("settings.title")} onClick={followLink}>
          <SettingsIcon />
        </a>
      )}
      <button
        type="button"
        class="avatar"
        aria-label={t("shell.account", { name })}
        aria-haspopup="menu"
        aria-expanded={account !== null}
        onClick={(event) => setAccount({ place: { under: event.currentTarget }, byKeyboard: event.detail === 0 })}
      >
        {/* The first letter, as Google's apps show it. */}
        {[...name.trim()][0]?.toUpperCase() ?? "?"}
      </button>
      {account && (
        <Menu
          label={t("shell.signedInAs", { name })}
          heading={t("shell.signedInAs", { name })}
          entries={[
            { label: t("settings.title"), onSelect: () => navigate("/settings/account") },
            SEPARATOR,
            { label: t("shell.signOut"), onSelect: onSignOut },
          ]}
          place={account.place}
          byKeyboard={account.byKeyboard}
          align="end"
          onClose={() => setAccount(null)}
        />
      )}
    </header>
  );
}
