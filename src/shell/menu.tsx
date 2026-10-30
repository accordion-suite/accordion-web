// A menu of actions, such as the one that opens on right-clicking a file.
// It follows the ARIA menu pattern: the arrow keys move between items,
// Enter or Space picks one, and Escape or Tab closes it and returns focus to
// where it was. Only the focused item is highlighted, and the pointer moves
// focus, so there's never more than one.

import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";

export interface MenuAction {
  label: string;
  onSelect: () => void;
  /** The key that does the same, shown beside the label, such as "F2". */
  shortcut?: string;
}

/** A line between groups of actions. */
export const SEPARATOR = "separator";

export type MenuEntry = MenuAction | typeof SEPARATOR;

/** Where the menu opens: at a point, such as the pointer, or under an
 * element, such as the button that opened it. */
export type MenuPlace = { x: number; y: number } | { under: Element };

/** Space kept between the menu and the window's edges. */
const MARGIN = 8;

export function Menu({
  label,
  entries,
  place,
  byKeyboard,
  onClose,
}: {
  label: string;
  entries: readonly MenuEntry[];
  place: MenuPlace;
  /** Whether a key opened the menu, which starts it on its first item. */
  byKeyboard: boolean;
  onClose: () => void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  // Opens where it was asked, moved back inside the window if it would go
  // past an edge. It measures itself first, so it starts out hidden.
  useLayoutEffect(() => {
    const own = menu.current!.getBoundingClientRect();
    let { x, y } = "under" in place ? { x: 0, y: 0 } : place;
    if ("under" in place) {
      const under = place.under.getBoundingClientRect();
      x = under.left;
      y = under.bottom + 4;
    }
    const left = Math.max(MARGIN, Math.min(x, innerWidth - own.width - MARGIN));
    const top = Math.max(MARGIN, Math.min(y, innerHeight - own.height - MARGIN));
    setPosition({ left, top });
  }, []);

  // A hidden menu can't take focus, so it takes it once it's in place. Opened
  // by the pointer, the menu itself takes it, so no item is highlighted
  // until the pointer reaches one or an arrow key is pressed.
  const placed = position !== null;
  useEffect(() => {
    if (placed) (byKeyboard ? items()[0] : menu.current)?.focus();
  }, [placed]);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const outside = (event: Event) => {
      if (!menu.current?.contains(event.target as Node)) onClose();
    };
    // Capture, so a press anywhere else closes the menu before it does
    // anything else.
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("resize", onClose);
    window.addEventListener("blur", onClose);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("blur", onClose);
      if (opener && opener !== document.body && document.contains(opener)) opener.focus();
    };
  }, []);

  function items(): HTMLButtonElement[] {
    return [...(menu.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]") ?? [])];
  }

  function keyDown(event: KeyboardEvent) {
    const all = items();
    const at = all.indexOf(document.activeElement as HTMLButtonElement);
    const move = (to: number) => all[(to + all.length) % all.length]?.focus();
    switch (event.key) {
      case "ArrowDown":
        move(at + 1);
        break;
      case "ArrowUp":
        // With no item focused yet, `at` is -1, and Up goes to the last.
        move(at === -1 ? all.length - 1 : at - 1);
        break;
      case "Home":
        move(0);
        break;
      case "End":
        move(all.length - 1);
        break;
      case "Escape":
      case "Tab":
        onClose();
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  }

  return (
    <div
      ref={menu}
      class="menu"
      role="menu"
      aria-label={label}
      tabIndex={-1}
      style={position ? { left: `${position.left}px`, top: `${position.top}px` } : { visibility: "hidden" }}
      onKeyDown={keyDown}
      onContextMenu={(event) => event.preventDefault()}
    >
      {entries.map((entry, index) =>
        entry === SEPARATOR ? (
          <hr key={index} role="separator" />
        ) : (
          <button
            key={index}
            type="button"
            role="menuitem"
            tabIndex={-1}
            aria-keyshortcuts={entry.shortcut}
            onPointerMove={(event) => {
              if (document.activeElement !== event.currentTarget) event.currentTarget.focus();
            }}
            onPointerLeave={() => menu.current?.focus()}
            onClick={() => {
              onClose();
              entry.onSelect();
            }}
          >
            <span>{entry.label}</span>
            {entry.shortcut && <kbd aria-hidden="true">{entry.shortcut}</kbd>}
          </button>
        ),
      )}
    </div>
  );
}
