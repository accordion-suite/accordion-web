// The text color and highlight pickers: Google Docs' grid of colors, a
// button for none, and any other color from the browser's own picker. It
// opens under its button, as a menu does, and the arrow keys move through
// the grid.

import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";

import { type MessageKey, t } from "../i18n.ts";
import { PALETTE } from "./text-style.ts";

/** Space kept between the picker and the window's edges. */
const MARGIN = 8;

const GRAYS: readonly MessageKey[] = [
  "docs.colorBlack",
  "docs.colorDarkGray4",
  "docs.colorDarkGray3",
  "docs.colorDarkGray2",
  "docs.colorDarkGray1",
  "docs.colorGray",
  "docs.colorLightGray1",
  "docs.colorLightGray2",
  "docs.colorLightGray3",
  "docs.colorWhite",
];

const HUES: readonly MessageKey[] = [
  "docs.colorRedBerry",
  "docs.colorRed",
  "docs.colorOrange",
  "docs.colorYellow",
  "docs.colorGreen",
  "docs.colorCyan",
  "docs.colorCornflowerBlue",
  "docs.colorBlue",
  "docs.colorPurple",
  "docs.colorMagenta",
];

/** A color's name in the grid, for screen readers and its tooltip: the
 * grays, the bright colors, then light 3 to 1 and dark 1 to 3 of each. */
function colorName(row: number, column: number): string {
  if (row === 0) return t(GRAYS[column]!);
  const hue = t(HUES[column]!);
  if (row === 1) return hue;
  if (row <= 4) return t("docs.colorLight", { color: hue, level: 5 - row });
  return t("docs.colorDark", { color: hue, level: row - 4 });
}

export function ColorMenu({
  label,
  noneLabel,
  color,
  under,
  byKeyboard,
  onPick,
  onClose,
}: {
  label: string;
  /** The button that takes the color off, such as **None**. */
  noneLabel: string;
  /** The color now, or null for none or for more than one. */
  color: string | null;
  under: Element;
  byKeyboard: boolean;
  onPick: (color: string | null) => void;
  onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  // The custom color, which the browser's picker changes as it's dragged.
  const [custom, setCustom] = useState(color ?? "#000000");

  useLayoutEffect(() => {
    const own = panel.current!.getBoundingClientRect();
    const button = under.getBoundingClientRect();
    const left = Math.max(MARGIN, Math.min(button.left, innerWidth - own.width - MARGIN));
    const top = Math.max(MARGIN, Math.min(button.bottom + 4, innerHeight - own.height - MARGIN));
    setPosition({ left, top });
  }, []);

  const placed = position !== null;
  useEffect(() => {
    if (!placed) return;
    const chosen = panel.current?.querySelector<HTMLButtonElement>("[aria-pressed=true]");
    (byKeyboard ? (chosen ?? swatches()[0]) : panel.current)?.focus();
  }, [placed]);

  useEffect(() => {
    const outside = (event: Event) => {
      const target = event.target as Node;
      if (panel.current?.contains(target)) return;
      // The button that opened it closes it, without opening it again.
      if (under.contains(target)) {
        document.addEventListener("click", (click) => click.stopPropagation(), { capture: true, once: true });
      }
      onClose();
    };
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("resize", onClose);
    };
  }, []);

  function swatches(): HTMLButtonElement[] {
    return [...(panel.current?.querySelectorAll<HTMLButtonElement>(".docs-swatch") ?? [])];
  }

  function close() {
    onClose();
    (under as HTMLElement).focus();
  }

  function pick(chosen: string | null) {
    onClose();
    onPick(chosen);
  }

  function keyDown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    const all = swatches();
    const at = all.indexOf(document.activeElement as HTMLButtonElement);
    const columns = PALETTE[0]!.length;
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: columns, ArrowUp: -columns }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const to = at === -1 ? 0 : Math.max(0, Math.min(all.length - 1, at + step));
    all[to]?.focus();
  }

  return (
    <div
      ref={panel}
      class="docs-colors"
      role="dialog"
      aria-label={label}
      tabIndex={-1}
      style={position ? { left: `${position.left}px`, top: `${position.top}px` } : { visibility: "hidden" }}
      onKeyDown={keyDown}
    >
      <button type="button" class="secondary docs-color-none" onClick={() => pick(null)}>
        {noneLabel}
      </button>
      <div class="docs-swatches">
        {PALETTE.map((row, rowAt) =>
          row.map((swatch, column) => {
            const name = colorName(rowAt, column);
            return (
              <button
                key={swatch}
                type="button"
                class={rowAt === 1 ? "docs-swatch docs-swatch-bright" : "docs-swatch"}
                title={name}
                aria-label={name}
                aria-pressed={swatch === color}
                tabIndex={-1}
                style={{ backgroundColor: swatch }}
                onClick={() => pick(swatch)}
              />
            );
          }),
        )}
      </div>
      <label class="docs-color-custom">
        <input
          type="color"
          value={custom}
          onInput={(event) => setCustom(event.currentTarget.value)}
          onChange={(event) => pick(event.currentTarget.value)}
        />
        {t("docs.colorCustom")}
      </label>
    </div>
  );
}
