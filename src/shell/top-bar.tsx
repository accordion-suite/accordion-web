// The bar along the top of every signed-in page: Accordion's name, a place
// for the page's search, and the reader's account. The account menu leads
// to the server's own pages, which the server serves outside the app.

import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";

import type { Session } from "../api.ts";
import { MenuIcon } from "../drive/icons.tsx";
import { t, type MessageKey } from "../i18n.ts";
import { Menu, SEPARATOR, type MenuEntry, type MenuPlace } from "./menu.tsx";
import { followLink } from "./router.ts";

/** The admin pages, in the order the server's pages list them. */
const ADMIN_PAGES: readonly [string, MessageKey][] = [
  ["/people", "shell.people"],
  ["/health", "shell.health"],
  ["/backups", "shell.backups"],
  ["/updates", "shell.updates"],
  ["/network", "shell.network"],
];

/** A link to a page outside the app, which loads it in full. */
function page(path: string, label: MessageKey): MenuEntry {
  return { label: t(label), onSelect: () => location.assign(path) };
}

export function TopBar({
  session,
  onSignOut,
  menuOpen,
  onMenu,
  children,
}: {
  session: Session;
  onSignOut: () => void;
  /** Whether the sidebar is open, on screens too small to show it always. */
  menuOpen?: boolean;
  onMenu?: () => void;
  children?: ComponentChildren;
}) {
  const [account, setAccount] = useState<{ place: MenuPlace; byKeyboard: boolean } | null>(null);
  const name = session.user.display_name;
  const entries: MenuEntry[] = [page("/account", "shell.manageAccount")];
  if (session.admin_pages) entries.push(SEPARATOR, ...ADMIN_PAGES.map(([path, label]) => page(path, label)));
  entries.push(SEPARATOR, { label: t("shell.signOut"), onSelect: onSignOut });

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
      <a class="brand" href="/drive/" onClick={followLink}>
        <span class="brand-name">{t("app.name")}</span>
        <span class="brand-module">{t("drive.title")}</span>
      </a>
      <div class="top-bar-middle">{children}</div>
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
          entries={entries}
          place={account.place}
          byKeyboard={account.byKeyboard}
          align="end"
          onClose={() => setAccount(null)}
        />
      )}
    </header>
  );
}
