// Moving items by dragging them onto a folder, in the list or the sidebar.
// A drag's data can't be read until it's dropped, so while it's over a
// folder, the folder checks what's being dragged here instead. The drag
// carries no files, so the upload drop zone leaves it alone.
//
// Browsers show a stop sign wherever a drag can't be dropped, which is
// almost everywhere, and a picture of the link being dragged. While items
// are dragged, the page takes the drag everywhere, so the pointer stays a
// move pointer, and dropping outside a folder does nothing. A small card
// with the items' name follows the pointer, as in Google Drive.

import { api } from "../api.ts";
import { t } from "../i18n.ts";
import type { Item } from "./item.ts";
import type { Notice } from "./layout.tsx";
import { announceChange } from "./store.ts";

/** Marks a drag as Accordion's own, for other apps it's dropped on. */
const DRAG_TYPE = "application/x-accordion-items";

let dragging: readonly Item[] | null = null;

/** "Photo.jpg" for one item, or "3 items" for more. */
export function naming(
  items: readonly Item[],
  one: Parameters<typeof t>[0],
  many: Parameters<typeof t>[0],
  to = "",
): string {
  return items.length === 1
    ? t(one, { name: items[0]!.name, folder: to })
    : t(many, { count: items.length, folder: to });
}

/** Starts dragging `items`. */
export function startDrag(event: DragEvent, items: readonly Item[]): void {
  dragging = items;
  const data = event.dataTransfer!;
  data.effectAllowed = "move";
  data.setData(DRAG_TYPE, items.map((item) => item.id).join(","));

  // The card has to be on the page when the browser takes its picture, so
  // it's placed out of sight, then removed.
  const card = document.createElement("div");
  card.className = "drag-card";
  card.textContent = items.length === 1 ? items[0]!.name : t("drive.dragging", { count: items.length });
  document.body.append(card);
  data.setDragImage(card, -12, -12);
  requestAnimationFrame(() => card.remove());

  document.addEventListener("dragover", anywhere);
  document.addEventListener("drop", anywhere);
}

export function endDrag(): void {
  dragging = null;
  document.removeEventListener("dragover", anywhere);
  document.removeEventListener("drop", anywhere);
}

/** Takes the drag outside the folders, which then does nothing. */
function anywhere(event: DragEvent): void {
  if (dragging === null || event.defaultPrevented) return;
  event.preventDefault();
  if (event.type === "dragover") event.dataTransfer!.dropEffect = "move";
}

/** Whether `folder` takes what's being dragged: not the folder itself, and
 * not when everything is in it already. */
function takes(folder: { id: string }): boolean {
  return (
    dragging !== null &&
    dragging.every((item) => item.id !== folder.id) &&
    dragging.some((item) => item.parent !== folder.id)
  );
}

/** What makes `folder` take a drag. `onOver` says which folder the drag is
 * over, or `null` when it leaves, for the page to show. */
export function dropProps(
  folder: { id: string; name: string },
  onOver: (id: string | null) => void,
  notify: (notice: Notice | null) => void,
) {
  return {
    onDragOver(event: DragEvent) {
      if (!takes(folder)) return;
      event.preventDefault();
      event.dataTransfer!.dropEffect = "move";
      onOver(folder.id);
    },
    onDragLeave(event: DragEvent) {
      // Moving onto something inside the folder's row isn't leaving it.
      const into = event.relatedTarget as Node | null;
      if (!(event.currentTarget as Node).contains(into)) onOver(null);
    },
    onDrop(event: DragEvent) {
      if (!takes(folder)) return;
      event.preventDefault();
      onOver(null);
      const items = dragging!;
      // The move can take the dragged row away, and then some browsers
      // never say the drag ended.
      endDrag();
      void moveInto(items, folder, notify);
    },
  };
}

async function moveInto(
  items: readonly Item[],
  folder: { id: string; name: string },
  notify: (notice: Notice | null) => void,
): Promise<void> {
  const moving = items.filter((item) => item.parent !== folder.id);
  const moved: Item[] = [];
  try {
    for (const item of moving) {
      await api("PATCH", `/api/drive/items/${item.id}`, { parent: folder.id });
      moved.push(item);
    }
    notify({
      message: naming(moving, "drive.movedOne", "drive.movedMany", folder.name),
      async undo() {
        for (const item of moved) await api("PATCH", `/api/drive/items/${item.id}`, { parent: item.parent });
      },
      async redo() {
        for (const item of moved) await api("PATCH", `/api/drive/items/${item.id}`, { parent: folder.id });
      },
    });
  } catch (failure) {
    // Such as a folder dropped into one of its own folders.
    notify({ message: failure instanceof Error ? failure.message : t("error.problem"), problem: true });
  }
  announceChange();
}
