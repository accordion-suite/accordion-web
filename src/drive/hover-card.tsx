// A card with an item's basic facts, shown while the pointer rests on its
// icon: its name, whether it's starred, its description, its owner, and
// when it was last edited. It's for a mouse only. Touch has no hover, and
// the details panel shows the same facts to everyone.

import { type ComponentChildren, createPortal } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";

import { api } from "../api.ts";
import { formatMoment, t } from "../i18n.ts";
import { ItemIcon, StarIcon } from "./icons.tsx";
import type { Item } from "./item.ts";

/** How long the pointer rests before the card shows, so passing over an
 * icon doesn't flash one. */
const DELAY = 500;

/** Descriptions seen so far, so a second hover shows one at once. Each hover
 * asks again, in case it changed. */
const descriptions = new Map<string, string>();

export function HoverCard({ item, children }: { item: Item; children: ComponentChildren }) {
  const anchor = useRef<HTMLSpanElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const [shown, setShown] = useState(false);
  const [description, setDescription] = useState(descriptions.get(item.id) ?? "");

  function hide() {
    window.clearTimeout(timer.current);
    setShown(false);
  }

  function enter(event: PointerEvent) {
    if (event.pointerType === "touch") return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setShown(true), DELAY);
    api<{ description: string }>("GET", `/api/drive/items/${item.id}/description`).then(
      (found) => {
        descriptions.set(item.id, found.description);
        setDescription(found.description);
      },
      // Without its description, the card still shows the rest.
      () => undefined,
    );
  }

  // Scrolling moves the icon out from under the card.
  useEffect(() => {
    if (!shown) return;
    window.addEventListener("scroll", hide, true);
    return () => window.removeEventListener("scroll", hide, true);
  }, [shown]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <span class="hover-anchor" ref={anchor} onPointerEnter={enter} onPointerLeave={hide} onPointerDown={hide}>
      {children}
      {/* On the page's body, so no list, tile, or pinned head stacks over
          it. */}
      {shown &&
        anchor.current &&
        createPortal(<Card item={item} description={description} anchor={anchor.current} />, document.body)}
    </span>
  );
}

function Card({ item, description, anchor }: { item: Item; description: string; anchor: HTMLElement }) {
  const card = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);

  // Under the icon, or above it if there's no room below, and kept inside
  // the window's sides.
  useLayoutEffect(() => {
    const box = card.current;
    if (!box) return;
    const icon = anchor.getBoundingClientRect();
    const gap = 8;
    const below = icon.bottom + gap;
    const top = below + box.offsetHeight > window.innerHeight - gap ? icon.top - gap - box.offsetHeight : below;
    const left = Math.max(gap, Math.min(icon.left, window.innerWidth - gap - box.offsetWidth));
    setPlace({ left, top: Math.max(gap, top) });
  }, [anchor, description]);

  return (
    // Screen readers skip it. The details panel says the same.
    <div
      class="hover-card"
      ref={card}
      aria-hidden="true"
      style={place ? { left: `${place.left}px`, top: `${place.top}px` } : { visibility: "hidden" }}
    >
      <p class="hover-card-head">
        <ItemIcon item={item} />
        <span class="hover-card-name">{item.name}</span>
        {item.starred && (
          <span class="star-mark">
            <StarIcon filled />
          </span>
        )}
      </p>
      {description && <p class="hover-card-description">{description}</p>}
      <p class="hint">{item.owner ? t("details.ownedBy", { name: item.owner }) : t("hover.ownedByYou")}</p>
      <p class="hint">{t("hover.edited", { time: formatMoment(item.modified_at) })}</p>
    </div>
  );
}
