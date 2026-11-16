// Reminders on notes (decision 31). Each person's are their own, and the
// server keeps them: a clock time and the time zone it was set in, so one
// for 9:00 every Monday stays at 9:00 when the clocks change. This works out
// the quick choices, such as "Tomorrow", and how a reminder reads.

import { formatShortDay, formatTime, t } from "../i18n.ts";

export type Repeat = "daily" | "weekly" | "monthly" | "yearly";

export const REPEATS: readonly Repeat[] = ["daily", "weekly", "monthly", "yearly"];

export interface Reminder {
  /** The clock time it's set for, such as "2026-11-20T09:00". */
  local: string;
  /** The time zone it was set in, such as "Europe/Amsterdam". */
  zone: string;
  repeat: Repeat | null;
  /** When it next rings, after any snooze. For one that doesn't repeat and
   * has rung, when it rang. */
  due_at: string;
  /** Whether it rang and isn't done yet. */
  rang: boolean;
}

/** The hour quick choices ring at in the morning, and in the evening. */
const MORNING = 8;
const EVENING = 18;

/** This device's time zone, such as "Europe/Amsterdam". */
export function deviceZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

const two = (value: number) => String(value).padStart(2, "0");

/** A date's clock time on this device, as the server takes it:
 * "2026-11-20T09:00". */
export function localText(when: Date): string {
  return `${when.getFullYear()}-${two(when.getMonth() + 1)}-${two(when.getDate())}T${two(when.getHours())}:${two(when.getMinutes())}`;
}

/** The date in a clock time, for a date field: "2026-11-20". */
export function datePart(local: string): string {
  return local.slice(0, 10);
}

/** The time in a clock time, for a time field: "09:00". */
export function timePart(local: string): string {
  return local.slice(11, 16);
}

function at(day: Date, hour: number): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, 0);
}

function daysLater(day: Date, days: number): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() + days);
}

export type Quick = "inAnHour" | "laterToday" | "tomorrow" | "nextWeek";

/** The quick choices, as in Keep: this evening while there's an hour to
 * go, tomorrow morning, and next Monday morning. Snoozing adds an hour from
 * now first. */
export function quickTimes(now: Date, snoozing = false): { quick: Quick; at: Date }[] {
  const times: { quick: Quick; at: Date }[] = [];
  if (snoozing) {
    const hour = new Date(now.getTime() + 60 * 60 * 1000);
    hour.setSeconds(0, 0);
    times.push({ quick: "inAnHour", at: hour });
  }
  const evening = at(now, EVENING);
  if (evening.getTime() - now.getTime() >= 60 * 60 * 1000) times.push({ quick: "laterToday", at: evening });
  times.push({ quick: "tomorrow", at: at(daysLater(now, 1), MORNING) });
  // Monday is 1. On a Monday, next week is a week away.
  const toMonday = (8 - now.getDay()) % 7 || 7;
  times.push({ quick: "nextWeek", at: at(daysLater(now, toMonday), MORNING) });
  return times;
}

/** A time, as a reminder reads: "Today, 6:00 PM", "Tomorrow, 8:00 AM", or
 * "Mon, Nov 23, 8:00 AM". */
export function whenText(when: Date, now: Date): string {
  const time = formatTime(when);
  const today = at(now, 0).getTime();
  const day = at(when, 0).getTime();
  if (day === today) return t("notes.reminderToday", { time });
  if (day === at(daysLater(now, 1), 0).getTime()) return t("notes.reminderTomorrow", { time });
  return t("notes.reminderOn", { day: formatShortDay(when, now), time });
}

const REPEAT_KEYS = {
  daily: "notes.repeatDaily",
  weekly: "notes.repeatWeekly",
  monthly: "notes.repeatMonthly",
  yearly: "notes.repeatYearly",
} as const;

/** How often a reminder comes back, such as "Weekly". */
export function repeatText(repeat: Repeat): string {
  return t(REPEAT_KEYS[repeat]);
}

/** A reminder as its card shows it: when it next rings on this device,
 * and how often, such as "Tomorrow, 8:00 AM · Weekly". */
export function reminderText(reminder: Reminder, now: Date): string {
  const when = whenText(new Date(reminder.due_at), now);
  return reminder.repeat ? `${when} · ${repeatText(reminder.repeat)}` : when;
}

/** Whether a reminder has rung and waits to be snoozed or done. One that
 * repeats waits for its next time, so it never shows as passed. */
export function waiting(reminder: Reminder, now: Date): boolean {
  return reminder.repeat === null && (reminder.rang || Date.parse(reminder.due_at) <= now.getTime());
}

/** Orders notes by when their reminders ring next, soonest first. */
export function byDue(a: { reminder: Reminder | null }, b: { reminder: Reminder | null }): number {
  return Date.parse(a.reminder?.due_at ?? "") - Date.parse(b.reminder?.due_at ?? "");
}
