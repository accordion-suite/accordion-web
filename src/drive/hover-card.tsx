// A card with an item's basic facts, shown while the pointer rests on its
// icon: its name, whether it's starred, its description, where it is, its
// owner, and when it was last edited. The pointer can move onto the card to
// star the item or go to where it is. It's for a mouse only. Touch has no
// hover, and the details panel and the item's menu offer the same to
// everyone.

import { type ComponentChildren, type FunctionComponent, createPortal } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";

import { api } from "../api.ts";
import { formatMoment, t } from "../i18n.ts";
import { appIcon } from "../shell/apps.tsx";
import { followLink } from "../shell/router.ts";
import { ClockIcon, DriveIcon, ItemIcon, PeopleIcon, PersonIcon, StarIcon, TextLinesIcon } from "./icons.tsx";
import type { Item } from "./item.ts";
import { MY_DRIVE, placeName, placePath } from "./places.ts";
import { pathTo } from "./store.ts";

/** How long the pointer rests before the card shows, so passing over an
 * icon doesn't flash one. */
const DELAY = 500;

/** How long the card stays after the pointer leaves the icon or the card,
 * so the pointer can cross the gap between them. */
const LINGER = 200;

/** Descriptions seen so far, so a second hover shows one at once. Each hover
 * asks again, in case it changed. */
const descriptions = new Map<string, string>();

/** Where an item is: the top of its trail, such as My Drive, Notes, or
 * Shared with me, and that place's page. */
interface Location {
  name: string;
  href: string;
  /** Which place it is, for its icon: "drive", an app's, or "shared". */
  place: string;
}

/** Where each item was, for the same reason. */
const locations = new Map<string, Location>();

/** The place `item` is in, starting at Shared with me for someone else's. */
async function locationOf(item: Item): Promise<Location> {
  if (item.owner !== null) return { name: t("shared.title"), href: "/drive/shared", place: "shared" };
  const [top] = await pathTo(item);
  const place = top?.place ?? MY_DRIVE;
  return { name: placeName(place), href: placePath(place), place };
}

/** A place's icon, the same as the sidebar shows. */
function placeIcon(place: string): FunctionComponent {
  if (place === "shared") return PeopleIcon;
  if (place === MY_DRIVE) return DriveIcon;
  return appIcon(place) ?? DriveIcon;
}

export function HoverCard({
  item,
  onStar,
  children,
}: {
  item: Item;
  /** Stars or unstars the item. Without it, as in the trash, the card only
   * shows whether it's starred. */
  onStar?: (on: boolean) => void;
  children: ComponentChildren;
}) {
  const anchor = useRef<HTMLSpanElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const [shown, setShown] = useState(false);
  const [description, setDescription] = useState(descriptions.get(item.id) ?? "");
  const [location, setLocation] = useState(locations.get(item.id) ?? null);

  function hide() {
    window.clearTimeout(timer.current);
    setShown(false);
  }

  /** Hides the card soon, unless the pointer comes back to the icon or
   * reaches the card first. */
  function leave() {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setShown(false), LINGER);
  }

  function stay() {
    window.clearTimeout(timer.current);
  }

  function enter(event: PointerEvent) {
    if (event.pointerType === "touch") return;
    window.clearTimeout(timer.current);
    // Back from the card, or across the gap, it's already showing.
    if (shown) return;
    timer.current = window.setTimeout(() => setShown(true), DELAY);
    api<{ description: string }>("GET", `/api/drive/items/${item.id}/description`).then(
      (found) => {
        descriptions.set(item.id, found.description);
        setDescription(found.description);
      },
      // Without its description, the card still shows the rest.
      () => undefined,
    );
    if (item.parent !== null) {
      locationOf(item).then(
        (found) => {
          locations.set(item.id, found);
          setLocation(found);
        },
        () => undefined,
      );
    }
  }

  // Scrolling moves the icon out from under the card.
  useEffect(() => {
    if (!shown) return;
    window.addEventListener("scroll", hide, true);
    return () => window.removeEventListener("scroll", hide, true);
  }, [shown]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <span class="hover-anchor" ref={anchor} onPointerEnter={enter} onPointerLeave={leave} onPointerDown={hide}>
      {children}
      {/* On the page's body, so no list, tile, or pinned head stacks over
          it. */}
      {shown &&
        anchor.current &&
        createPortal(
          <Card
            item={item}
            description={description}
            location={location}
            anchor={anchor.current}
            onStar={onStar}
            onEnter={stay}
            onLeave={leave}
            onDone={hide}
          />,
          document.body,
        )}
    </span>
  );
}

function Card({
  item,
  description,
  location,
  anchor,
  onStar,
  onEnter,
  onLeave,
  onDone,
}: {
  item: Item;
  description: string;
  location: Location | null;
  anchor: HTMLElement;
  onStar?: (on: boolean) => void;
  onEnter: () => void;
  onLeave: () => void;
  onDone: () => void;
}) {
  const card = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
  // Changes at once on a click, before the list hears of it.
  const [starred, setStarred] = useState(item.starred);
  useEffect(() => setStarred(item.starred), [item.starred]);

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
  }, [anchor, description, location]);

  function star() {
    if (!onStar) return;
    setStarred(!starred);
    onStar(!starred);
  }

  const starLabel = starred ? t("drive.removeStar") : t("drive.addStar");
  const PlaceIcon = location ? placeIcon(location.place) : null;
  // The words around the place's link, so a language can put it anywhere.
  const [placeBefore = "", placeAfter = ""] = t("hover.location", { place: "\u0000" }).split("\u0000");

  return (
    // Screen readers skip it, and so does Tab: it shows only for a mouse,
    // and the details panel and the item's menu say and do the same.
    <div
      class="hover-card"
      ref={card}
      aria-hidden="true"
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
      style={place ? { left: `${place.left}px`, top: `${place.top}px` } : { visibility: "hidden" }}
    >
      <p class="hover-card-head">
        <ItemIcon item={item} />
        <span class="hover-card-name">{item.name}</span>
        {onStar ? (
          <button
            type="button"
            class={starred ? "hover-card-star starred" : "hover-card-star"}
            tabIndex={-1}
            title={starLabel}
            aria-label={starLabel}
            onClick={star}
          >
            <StarIcon filled={starred} />
          </button>
        ) : (
          starred && (
            <span class="star-mark">
              <StarIcon filled />
            </span>
          )
        )}
      </p>
      {description && (
        <p class="hover-card-line hover-card-description">
          <TextLinesIcon />
          <span>{description}</span>
        </p>
      )}
      {location && PlaceIcon && (
        <p class="hover-card-line hint">
          <PlaceIcon />
          <span>
            {placeBefore}
            <a
              href={location.href}
              tabIndex={-1}
              onClick={(event) => {
                followLink(event);
                onDone();
              }}
            >
              {location.name}
            </a>
            {placeAfter}
          </span>
        </p>
      )}
      <p class="hover-card-line hint">
        <PersonIcon />
        <span>{item.owner ? t("details.ownedBy", { name: item.owner }) : t("hover.ownedByYou")}</span>
      </p>
      <p class="hover-card-line hint">
        <ClockIcon />
        <span>{t("hover.edited", { time: formatMoment(item.modified_at) })}</span>
      </p>
    </div>
  );
}
