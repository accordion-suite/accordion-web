// Choosing items as Google Drive does: a click selects, Ctrl or Cmd and a
// click adds or removes one, Shift and a click selects a range, and dragging
// from empty space draws a box that selects what it touches. The arrow keys
// move through the items the same way. The list itself opens items on a
// double-click.

import { type RefObject } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

/** A rectangle, in the page's own coordinates or the window's. */
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The items from `anchor` to `id`, both included, in the order shown. With
 * no anchor, or one that's gone, just `id`. */
export function range(order: readonly string[], anchor: string | null, id: string): string[] {
  const from = anchor === null ? -1 : order.indexOf(anchor);
  const to = order.indexOf(id);
  if (to < 0) return [];
  if (from < 0) return [id];
  return order.slice(Math.min(from, to), Math.max(from, to) + 1);
}

export function overlaps(a: Box, b: Box): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

/** The item an arrow key moves to from `from`, by where each item is on the
 * screen, so it works for rows, tiles, and cards alike. Left and right step
 * through the order, and up and down go to the nearest item in the row
 * above or below. */
export function neighbor(
  boxes: readonly { id: string; box: Box }[],
  from: string,
  key: "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight",
): string | null {
  const at = boxes.findIndex((item) => item.id === from);
  if (at < 0) return null;
  if (key === "ArrowLeft") return boxes[at - 1]?.id ?? null;
  if (key === "ArrowRight") return boxes[at + 1]?.id ?? null;
  const here = boxes[at]!.box;
  const middle = (box: Box) => (box.left + box.right) / 2;
  const down = key === "ArrowDown";
  const beyond = boxes.filter(({ box }) => (down ? box.top >= here.bottom - 1 : box.bottom <= here.top + 1));
  if (beyond.length === 0) return null;
  // The nearest row first, then the item closest across.
  const row = down ? Math.min(...beyond.map(({ box }) => box.top)) : Math.max(...beyond.map(({ box }) => box.bottom));
  const inRow = beyond.filter(({ box }) => (down ? box.top : box.bottom) === row);
  inRow.sort((a, b) => Math.abs(middle(a.box) - middle(here)) - Math.abs(middle(b.box) - middle(here)));
  return inRow[0]!.id;
}

/** How far the pointer moves before a press on empty space becomes a box. */
const THRESHOLD = 4;

/** How near the edge of the page the pointer scrolls it, and how fast. */
const EDGE = 40;
const SPEED = 16;

/** Clicks and presses inside these aren't on empty space. */
const NOT_EMPTY =
  "[data-id], a, button, input, select, textarea, label, summary, dialog, [role=menu], .selection-bar, thead";

export interface BandHandlers {
  /** Whether a box may start now, such as when no dialog is open. */
  allowed(): boolean;
  /** The items the box touches, by ID. `adding` says whether Ctrl, Cmd, or
   * Shift was held, to add to what was selected before. */
  touch(ids: string[], adding: boolean): void;
  /** A click on empty space, without a box. */
  click(adding: boolean): void;
}

/** Draws a selection box when the pointer drags across empty space in the
 * scrolling panel around `root`, and returns where to draw it, in the
 * window's coordinates. */
export function useSelectionBand(root: RefObject<HTMLElement | null>, handlers: BandHandlers): Box | null {
  const [band, setBand] = useState<Box | null>(null);
  const latest = useRef(handlers);
  latest.current = handlers;

  useEffect(() => {
    const list = root.current;
    const panel = list?.closest<HTMLElement>(".frame-main");
    if (!list || !panel) return;

    let stop: (() => void) | null = null;

    const down = (event: PointerEvent) => {
      if (event.button !== 0 || event.pointerType === "touch" || !latest.current.allowed()) return;
      const target = event.target as Element;
      if (!panel.contains(target) || target.closest(NOT_EMPTY)) return;
      // A press on the panel's own scroll bar. Browsers send it to the panel
      // itself, and the page fills the panel (min-height: 100%), so nothing
      // else does. Overlay scroll bars take no width, so measuring can't
      // find them.
      if (target === panel) return;
      // No text selection, and focus stays where it is.
      event.preventDefault();
      const adding = event.ctrlKey || event.metaKey || event.shiftKey;
      const start = { x: event.clientX + panel.scrollLeft, y: event.clientY + panel.scrollTop };
      let pointer = { x: event.clientX, y: event.clientY };
      let moved = false;
      let frame = 0;

      const update = () => {
        const now = { x: pointer.x + panel.scrollLeft, y: pointer.y + panel.scrollTop };
        const box: Box = {
          left: Math.min(start.x, now.x),
          top: Math.min(start.y, now.y),
          right: Math.max(start.x, now.x),
          bottom: Math.max(start.y, now.y),
        };
        const ids: string[] = [];
        for (const item of list.querySelectorAll<HTMLElement>("[data-id]")) {
          const rect = item.getBoundingClientRect();
          const placed: Box = {
            left: rect.left + panel.scrollLeft,
            top: rect.top + panel.scrollTop,
            right: rect.right + panel.scrollLeft,
            bottom: rect.bottom + panel.scrollTop,
          };
          if (overlaps(box, placed)) ids.push(item.dataset["id"]!);
        }
        latest.current.touch(ids, adding);
        // Drawn in the window, and kept inside the panel.
        const view = panel.getBoundingClientRect();
        setBand({
          left: Math.max(box.left - panel.scrollLeft, view.left),
          top: Math.max(box.top - panel.scrollTop, view.top),
          right: Math.min(box.right - panel.scrollLeft, view.left + panel.clientWidth),
          bottom: Math.min(box.bottom - panel.scrollTop, view.top + panel.clientHeight),
        });
      };

      // Scrolls while the pointer is near the top or bottom of the panel.
      const scroll = () => {
        const view = panel.getBoundingClientRect();
        const step =
          pointer.y < view.top + EDGE ? -SPEED : pointer.y > view.top + panel.clientHeight - EDGE ? SPEED : 0;
        if (step !== 0) {
          const before = panel.scrollTop;
          panel.scrollTop += step;
          if (panel.scrollTop !== before) update();
        }
        frame = requestAnimationFrame(scroll);
      };

      const move = (event: PointerEvent) => {
        pointer = { x: event.clientX, y: event.clientY };
        if (!moved) {
          if (Math.hypot(pointer.x + panel.scrollLeft - start.x, pointer.y + panel.scrollTop - start.y) < THRESHOLD) {
            return;
          }
          moved = true;
          document.documentElement.classList.add("selecting");
          frame = requestAnimationFrame(scroll);
        }
        update();
      };

      const finish = (event: PointerEvent) => {
        stop?.();
        if (!moved && event.type === "pointerup") latest.current.click(adding);
      };

      stop = () => {
        cancelAnimationFrame(frame);
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", finish);
        window.removeEventListener("pointercancel", finish);
        document.documentElement.classList.remove("selecting");
        setBand(null);
        stop = null;
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", finish);
      window.addEventListener("pointercancel", finish);
    };

    document.addEventListener("pointerdown", down);
    return () => {
      document.removeEventListener("pointerdown", down);
      stop?.();
    };
  }, []);

  return band;
}
