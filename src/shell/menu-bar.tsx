// A row of menus across the top of an app, such as Docs' File, Edit, View,
// Insert, and Format. It follows the ARIA menu bar pattern: Left and Right
// move between the menus, Down or Enter opens one, and with a menu open,
// Left and Right open the one beside it. With a menu open, the pointer
// resting on another opens that one instead.

import { useRef, useState } from "preact/hooks";
import { Menu, type MenuEntry } from "./menu";

export interface MenuBarMenu {
  label: string;
  /** The menu's items, made as it opens, so they show the app as it is
   * then. */
  entries: () => readonly MenuEntry[];
}

export function MenuBar({ label, menus }: { label: string; menus: readonly MenuBarMenu[] }) {
  const [open, setOpen] = useState<{
    index: number;
    byKeyboard: boolean;
  } | null>(null);
  // The menu Tab reaches: the last one used.
  const [current, setCurrent] = useState(0);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const wrap = (index: number) => (index + menus.length) % menus.length;
  const show = (index: number, byKeyboard: boolean) => {
    setCurrent(index);
    setOpen({ index, byKeyboard });
  };
  const menu = open && menus[open.index];

  return (
    <div class="menu-bar" role="menubar" aria-label={label}>
      {menus.map((menu, index) => (
        <button
          key={menu.label}
          ref={(button) => {
            buttons.current[index] = button;
          }}
          type="button"
          role="menuitem"
          class="menu-bar-item"
          aria-haspopup="menu"
          aria-expanded={open?.index === index}
          tabIndex={index === current ? 0 : -1}
          // What's being edited keeps its selection, so the menu's items
          // act on it.
          onMouseDown={(event) => event.preventDefault()}
          onPointerEnter={(event) => {
            if (event.pointerType === "mouse" && open && open.index !== index) show(index, false);
          }}
          onClick={(event) => (open?.index === index ? setOpen(null) : show(index, event.detail === 0))}
          onKeyDown={(event) => {
            const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
            if (step) {
              const next = wrap(index + step);
              setCurrent(next);
              buttons.current[next]?.focus();
            } else if (event.key === "ArrowDown") show(index, true);
            else return;
            event.preventDefault();
          }}
        >
          {menu.label}
        </button>
      ))}
      {open && menu && buttons.current[open.index] && (
        <Menu
          key={open.index}
          label={menu.label}
          entries={menu.entries()}
          place={{ under: buttons.current[open.index]! }}
          byKeyboard={open.byKeyboard}
          onClose={() => setOpen(null)}
          onNext={() => show(wrap(open.index + 1), true)}
          onPrevious={() => show(wrap(open.index - 1), true)}
        />
      )}
    </div>
  );
}
