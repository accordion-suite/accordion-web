// Translated text, and numbers, sizes, and dates in the reader's own format
// (decision 13). Formatting uses the browser's Intl functions, so no
// translations or formats ship in the app beyond the message files.

import { en } from "./messages/en.ts";

export type MessageKey = keyof typeof en;
type Plural = { readonly other: string } & { readonly [category: string]: string };
type Values = Readonly<Record<string, string | number>>;

const messages: Readonly<Record<MessageKey, string | Plural>> = en;
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

/** A date and time, such as "Oct 28, 2026, 3:04 PM", in the reader's time
 * zone. */
export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(iso),
  );
}
