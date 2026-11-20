// A menu of actions, such as the one that opens on right-clicking a file.
// It follows the ARIA menu pattern: the arrow keys move between items,
// Enter or Space picks one, and Escape or Tab closes it and returns focus to
// where it was. Only the focused item is highlighted, and the pointer moves
// focus, so there's never more than one. An item can open a submenu beside
// it, by the pointer resting on it, the Right arrow, or Enter.

import type { ComponentChildren } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";

export interface MenuAction {
  label: string;
  /** What choosing the item does. An item with a submenu needs none. */
  onSelect?: () => void;
  /** The actions the item opens beside it, such as a menu bar's
   * **Download** with each format. */
  submenu?: readonly MenuEntry[];
  /** The key that does the same, shown beside the label, such as "F2". */
  shortcut?: string;
  /** For a choice among options, such as a search filter: whether it's the
   * one chosen. */
  checked?: boolean;
  /** A symbol before the label, such as an icon. A choice's icon takes the
   * check's place, and the check replaces it on the one chosen. */
  icon?: ComponentChildren;
  /** The CSS font the label shows in, such as a font menu's own fonts. */
  font?: string;
}

/** A line between groups of actions. */
export const SEPARATOR = "separator" as const;

export type MenuEntry = MenuAction | typeof SEPARATOR;

/** Where the menu opens: at a point, such as the pointer, or under an
 * element, such as the button that opened it. */
export type MenuPlace = { x: number; y: number } | { under: Element } | { beside: Element };

/** Space kept between the menu and the window's edges. */
const MARGIN = 8;

/** How long the pointer rests on an item before its submenu opens, or
 * another item's closes, so crossing items on the way to a submenu doesn't
 * close it. */
const REST = 150;

export function Menu({
  label,
  entries,
  place,
  byKeyboard,
  heading,
  align = "start",
  side = "below",
  onClose,
  onChosen,
  onNext,
  onPrevious,
}: {
  label: string;
  entries: readonly MenuEntry[];
  place: MenuPlace;
  /** Text above the actions, such as who's signed in. */
  heading?: string;
  /** Under an element, whether the menu lines up with its left edge or its
   * right edge, for a button at the right of the screen. */
  align?: "start" | "end";
  /** Under an element, whether the menu opens below it or above it, for a
   * button near the bottom of what it belongs to. Above goes below if
   * there's no room. */
  side?: "below" | "above";
  /** Whether a key opened the menu, which starts it on its first item. */
  byKeyboard: boolean;
  /** Closes this menu: Escape, a press outside it, or, for a submenu, the
   * Left arrow. */
  onClose: () => void;
  /** Closes every menu once an item is chosen. A submenu gets its parent's,
   * and a menu without it closes itself. */
  onChosen?: () => void;
  /** In a menu bar, opens the menu after this one or before it, for the
   * Right and Left arrows. */
  onNext?: () => void;
  onPrevious?: () => void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const [open, setOpen] = useState<{
    index: number;
    byKeyboard: boolean;
  } | null>(null);
  const resting = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const chosen = onChosen ?? onClose;
  const isSubmenu = "beside" in place;
  useEffect(() => () => clearTimeout(resting.current), []);

  // Opens where it was asked, moved back inside the window if it would go
  // past an edge. It measures itself first, so it starts out hidden.
  useLayoutEffect(() => {
    const own = menu.current!.getBoundingClientRect();
    let { x, y } = "x" in place ? place : { x: 0, y: 0 };
    if ("beside" in place) {
      // To the right of its item, or to the left without room, with its
      // first item level with it.
      const beside = place.beside.getBoundingClientRect();
      x = beside.right + own.width + MARGIN <= innerWidth ? beside.right : beside.left - own.width;
      y = beside.top - 8;
    } else if ("under" in place) {
      const under = place.under.getBoundingClientRect();
      x = align === "end" ? under.right - own.width : under.left;
      y = side === "above" && under.top - 4 - own.height >= MARGIN ? under.top - 4 - own.height : under.bottom + 4;
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
      const target = event.target as Node;
      if (menu.current?.contains(target)) return;
      // Pressing the button that opened the menu closes it, so its click
      // mustn't open it again. The click comes right after the press is
      // let go, if it comes at all, so later clicks are left alone.
      if ("under" in place && place.under.contains(target)) {
        const swallow = (click: Event) => {
          click.stopPropagation();
          click.preventDefault();
        };
        document.addEventListener("click", swallow, {
          capture: true,
          once: true,
        });
        document.addEventListener(
          "pointerup",
          () => setTimeout(() => document.removeEventListener("click", swallow, { capture: true })),
          { capture: true, once: true },
        );
      }
      onClose();
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
      // Focus goes back where it was, unless the item chosen moved it, such
      // as into the text it changed or a dialog it opened.
      const focused = document.activeElement;
      const moved = focused && focused !== document.body && !menu.current?.contains(focused);
      if (!moved && opener && opener !== document.body && document.contains(opener)) opener.focus();
    };
  }, []);

  /** This menu's own items, not an open submenu's. */
  function items(): HTMLButtonElement[] {
    return [...(menu.current?.querySelectorAll<HTMLButtonElement>(":scope > [role^=menuitem]") ?? [])];
  }

  /** Opens the submenu of the item at `index`, or closes the open one for
   * an item without, once the pointer has rested there. */
  function rest(index: number) {
    clearTimeout(resting.current);
    const entry = entries[index];
    const wanted = entry !== SEPARATOR && entry?.submenu ? index : null;
    if ((open?.index ?? null) === wanted) return;
    resting.current = setTimeout(() => setOpen(wanted === null ? null : { index: wanted, byKeyboard: false }), REST);
  }

  function keyDown(event: KeyboardEvent) {
    const all = items();
    const at = all.indexOf(document.activeElement as HTMLButtonElement);
    const move = (to: number) => all[(to + all.length) % all.length]?.focus();
    const focused = at === -1 ? null : entryAt(at);
    switch (event.key) {
      case "ArrowRight":
        if (focused?.submenu) {
          clearTimeout(resting.current);
          setOpen({ index: entries.indexOf(focused), byKeyboard: true });
        } else if (onNext) onNext();
        else return;
        break;
      case "ArrowLeft":
        if (isSubmenu) onClose();
        else if (onPrevious) onPrevious();
        else return;
        break;
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
        onClose();
        break;
      case "Tab":
        chosen();
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  }

  /** The action of the `at`th item. */
  function entryAt(at: number): MenuAction | null {
    const actions = entries.filter((entry): entry is MenuAction => entry !== SEPARATOR);
    return actions[at] ?? null;
  }

  const hasChoices = entries.some((entry) => entry !== SEPARATOR && entry.checked !== undefined);

  return (
    <div
      ref={menu}
      class={hasChoices ? "menu has-choices" : "menu"}
      role="menu"
      aria-label={label}
      tabIndex={-1}
      style={position ? { left: `${position.left}px`, top: `${position.top}px` } : { visibility: "hidden" }}
      onKeyDown={keyDown}
      onContextMenu={(event) => event.preventDefault()}
      // The pointer reaching an open submenu keeps it open.
      onPointerOver={(event) => {
        if ((event.target as Element).closest(".menu") !== menu.current) clearTimeout(resting.current);
      }}
    >
      {heading && (
        <p class="menu-heading" aria-hidden="true">
          {heading}
        </p>
      )}
      {entries.map((entry, index) =>
        entry === SEPARATOR ? (
          <hr key={index} role="separator" />
        ) : (
          <button
            key={index}
            type="button"
            role={entry.checked === undefined ? "menuitem" : "menuitemradio"}
            aria-checked={entry.checked}
            aria-haspopup={entry.submenu ? "menu" : undefined}
            aria-expanded={entry.submenu ? open?.index === index : undefined}
            class={entry.checked !== undefined && entry.icon !== undefined ? "with-icon" : undefined}
            tabIndex={-1}
            aria-keyshortcuts={entry.shortcut}
            onPointerMove={(event) => {
              if (document.activeElement !== event.currentTarget) {
                event.currentTarget.focus();
                rest(index);
              }
            }}
            onPointerLeave={() => menu.current?.focus()}
            onClick={(event) => {
              if (entry.submenu) {
                clearTimeout(resting.current);
                setOpen({ index, byKeyboard: event.detail === 0 });
                return;
              }
              chosen();
              entry.onSelect?.();
            }}
          >
            {entry.icon !== undefined && !entry.checked && (
              <span class="menu-icon" aria-hidden="true">
                {entry.icon}
              </span>
            )}
            <span class="menu-label" style={entry.font ? { fontFamily: entry.font } : undefined}>
              {entry.label}
            </span>
            {entry.shortcut && <kbd aria-hidden="true">{entry.shortcut}</kbd>}
            {entry.submenu && (
              <span class="menu-more" aria-hidden="true">
                ›
              </span>
            )}
          </button>
        ),
      )}
      {open &&
        (() => {
          const entry = entries[open.index];
          const item = items()[entries.slice(0, open.index).filter((other) => other !== SEPARATOR).length];
          if (entry === SEPARATOR || !entry?.submenu || !item) return null;
          // Inside this menu, so a press in the submenu isn't outside it.
          return (
            <Menu
              key={open.index}
              label={entry.label}
              entries={entry.submenu}
              place={{ beside: item }}
              byKeyboard={open.byKeyboard}
              onClose={() => setOpen(null)}
              onChosen={chosen}
              onNext={onNext}
            />
          );
        })()}
    </div>
  );
}
