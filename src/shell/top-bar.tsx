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
        <Logo />
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

/** Accordion's folded shape from its icon, without the icon's dark tile, in
 * colors that suit the page's light or dark look. The name beside it says
 * what it is. */
function Logo() {
  return (
    <svg class="brand-logo" viewBox="132 114 248 284" aria-hidden="true" focusable="false">
      <clipPath id="brand-logo-shape">
        <path d="M135.360 149.502 C135.360 144.976 140.179 142.080 144.175 144.203 L201.920 174.880 L220.133 132.990 C221.528 129.782 225.361 128.443 228.450 130.084 L289.280 162.400 L307.493 120.510 C308.888 117.302 312.721 115.963 315.810 117.604 L373.455 148.228 C375.415 149.269 376.640 151.307 376.640 153.527 L376.640 362.498 C376.640 367.024 371.821 369.920 367.825 367.797 L310.080 337.120 L291.867 379.010 C290.472 382.218 286.639 383.557 283.550 381.916 L222.720 349.600 L204.507 391.490 C203.112 394.698 199.279 396.037 196.190 394.396 L138.545 363.772 C136.585 362.731 135.360 360.693 135.360 358.473 Z" />
      </clipPath>
      <g clip-path="url(#brand-logo-shape)">
        <rect x="0" y="0" width="512" height="512" fill="var(--logo-gap)" />
        <rect x="95.36" y="0" width="106.56" height="512" fill="var(--logo-fold)" />
        <rect x="222.72" y="0" width="66.56" height="512" fill="var(--logo-fold)" />
        <rect x="310.08" y="0" width="106.56" height="512" fill="var(--logo-fold)" />
      </g>
    </svg>
  );
}
