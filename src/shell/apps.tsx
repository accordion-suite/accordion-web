// The app grid in the top bar, as Google's apps have: a button that opens a
// menu of the modules that are on, so the reader can move between them. It
// shows only modules that live in the web app.

import type { FunctionComponent } from "preact";
import { useState } from "preact/hooks";

import { DriveIcon, Icon } from "../drive/icons.tsx";
import { t, type MessageKey } from "../i18n.ts";
import { NoteIcon } from "../notes/icons.tsx";
import { Menu, type MenuPlace } from "./menu.tsx";
import { navigate } from "./router.ts";

/** Each module the grid knows, in its order: its name, where it starts, and
 * its icon. */
const APPS: readonly { id: string; name: MessageKey; home: string; icon: FunctionComponent }[] = [
  { id: "drive", name: "drive.title", home: "/drive/start", icon: DriveIcon },
  { id: "notes", name: "apps.notes", home: "/notes/", icon: NoteIcon },
];

export const AppsIcon = () => (
  <Icon>
    {[5, 12, 19].flatMap((x) => [5, 12, 19].map((y) => <circle key={`${x}-${y}`} cx={x} cy={y} r="2" fill="currentColor" />))}
  </Icon>
);

/** The modules among `modules` that the grid shows. */
export function appsOn(modules: readonly string[]) {
  return APPS.filter((app) => modules.includes(app.id));
}

export function AppsButton({ modules }: { modules: readonly string[] }) {
  const [menu, setMenu] = useState<{ place: MenuPlace; byKeyboard: boolean } | null>(null);
  const apps = appsOn(modules);
  // With one module there's nowhere else to go.
  if (apps.length < 2) return null;
  return (
    <>
      <button
        type="button"
        class="icon-button apps-button"
        title={t("apps.title")}
        aria-label={t("apps.title")}
        aria-haspopup="menu"
        aria-expanded={menu !== null}
        onClick={(event) => setMenu({ place: { under: event.currentTarget }, byKeyboard: event.detail === 0 })}
      >
        <AppsIcon />
      </button>
      {menu && (
        <Menu
          label={t("apps.title")}
          entries={apps.map((app) => ({
            label: t(app.name),
            icon: <app.icon />,
            onSelect: () => navigate(app.home),
          }))}
          place={menu.place}
          byKeyboard={menu.byKeyboard}
          align="end"
          onClose={() => setMenu(null)}
        />
      )}
    </>
  );
}
