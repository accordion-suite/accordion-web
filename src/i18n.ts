// Translated text, and numbers, sizes, and dates in the reader's own format
// (decision 13). Formatting uses the browser's Intl functions, so no
// translations or formats ship in the app beyond the message files.

import { en } from "./messages/en.ts";
import type { settingsEn } from "./messages/settings.en.ts";

export type MessageKey = keyof typeof en | keyof typeof settingsEn;
type Plural = { readonly other: string } & { readonly [category: string]: string };
type Values = Readonly<Record<string, string | number>>;

const messages: Record<string, string | Plural> = { ...en };

/** Adds the messages of a part of the app that loads later, such as
 * Settings. */
export function addMessages(more: Readonly<Record<string, string | Plural>>): void {
  Object.assign(messages, more);
}
let locale = "en";
let plurals = new Intl.PluralRules(locale);

/** Switches the language that numbers, sizes, and dates use. */
export function setLocale(next: string): void {
  locale = next;
  plurals = new Intl.PluralRules(locale);
}

/** The message for `key`, with each {name} replaced from `values`. A
 * message with plural forms picks one by `values.count`. */
export function t(key: MessageKey, values: Values = {}): string {
  let message = messages[key];
  // A part's messages that haven't loaded. Showing the key is better than
  // breaking the page.
  if (message === undefined) return key;
  if (typeof message !== "string") {
    const category = plurals.select(Number(values["count"] ?? 0));
    message = message[category] ?? message.other;
  }
  return message.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = values[name];
    if (value === undefined) return whole;
    return typeof value === "number" ? formatNumber(value) : value;
  });
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat(locale).format(value);
}

/** A share of something, such as "12%", to a tenth of a percent when it's
 * small. */
export function formatPercent(share: number): string {
  const format = (value: number, digits: number) =>
    new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: digits }).format(value);
  // A share too small to show still isn't nothing, so it isn't "0%".
  if (share > 0 && share < 0.001) return `<${format(0.001, 1)}`;
  return format(share, share > 0 && share < 0.1 ? 1 : 0);
}

const SIZE_UNITS = ["byte", "kilobyte", "megabyte", "gigabyte", "terabyte"] as const;

/** A file size, such as "1.5 MB". Units are 1,000 of the one before, as on
 * phones and Macs, so the number matches the unit's name. */
export function formatSize(bytes: number): string {
  let unit = 0;
  let value = bytes;
  while (value >= 1000 && unit < SIZE_UNITS.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit: SIZE_UNITS[unit],
    unitDisplay: unit === 0 ? "long" : "short",
    maximumFractionDigits: unit === 0 || value >= 10 ? 0 : 1,
  }).format(value);
}

/** How long a video or a sound lasts, as a player's clock shows it:
 * "2:05", or "1:02:05". Anything shorter shows as a second. */
export function formatLength(seconds: number): string {
  const whole = Math.max(1, Math.round(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = String(whole % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}

/** A date and time, such as "Oct 28, 2026, 3:04 PM", in the reader's time
 * zone. */
export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(iso),
  );
}

/** A date, such as "October 22, 2026", from an ISO time or milliseconds.
 * The month is a word, so it reads the same in every country. */
export function formatDay(when: string | number): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(new Date(when));
}

/** A date and time, such as "October 22, 2026 at 3:04 AM", in the reader's
 * time zone. */
export function formatMoment(when: string | number): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "long", timeStyle: "short" }).format(new Date(when));
}

/** A calendar date with no time, such as a release's "2026-11-02", as
 * "November 2, 2026". It's read as a local date, so it doesn't move a day
 * in time zones behind UTC. */
export function formatCalendarDay(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(new Date(year!, month! - 1, day));
}

/** An hour of the day, such as "3 AM". */
export function formatHour(hour: number): string {
  return new Intl.DateTimeFormat(locale, { hour: "numeric" }).format(new Date(2000, 0, 1, hour));
}

/** Items joined as a sentence, such as "a, b, and c". */
export function formatList(items: readonly string[]): string {
  return new Intl.ListFormat(locale, { type: "conjunction" }).format(items);
}
