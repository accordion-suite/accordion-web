// Setting, snoozing, and finishing a reminder, from a note's card or its
// editor: a menu of quick choices, as in Keep, and a dialog for any date and
// time, and how often it repeats. A reminder that has rung offers snoozing
// and done instead.

import type { TargetedSubmitEvent } from "preact";
import { useState } from "preact/hooks";

import { formatShortDay, formatTime, t } from "../i18n.ts";
import { Dialog, problemText } from "../shell/dialog.tsx";
import { Menu, type MenuEntry, type MenuPlace, SEPARATOR } from "../shell/menu.tsx";
import { finishReminder, type Note, removeReminder, setReminder, snoozeReminder } from "./notes-api.ts";
import {
  datePart,
  deviceZone,
  localText,
  type Quick,
  quickTimes,
  REPEATS,
  type Reminder,
  type Repeat,
  reminderText,
  repeatText,
  timePart,
  waiting,
  whenText,
} from "./reminders.ts";

export type ReminderAction =
  | { kind: "set"; local: string; repeat: Repeat | null }
  | { kind: "snooze"; until: Date }
  | { kind: "done" }
  | { kind: "remove" };

/** Asks once whether reminders may show as the device's own notifications.
 * Browsers only ask while someone is acting, so this runs as they set one. */
function askToNotify() {
  if (typeof Notification !== "undefined" && Notification.permission === "default") {
    void Notification.requestPermission().catch(() => undefined);
  }
}

/** Does `action` to the reader's reminder on note `id`, and says what
 * happened. */
export async function applyReminder(
  id: string,
  action: ReminderAction,
): Promise<{ reminder: Reminder | null; text: string }> {
  switch (action.kind) {
    case "set": {
      askToNotify();
      const reminder = await setReminder(id, action.local, deviceZone(), action.repeat);
      return { reminder, text: t("notes.reminderSet", { when: reminderText(reminder, new Date()) }) };
    }
    case "snooze": {
      const reminder = await snoozeReminder(id, action.until);
      return { reminder, text: t("notes.reminderSnoozed", { when: whenText(action.until, new Date()) }) };
    }
    case "done":
      return { reminder: await finishReminder(id), text: t("notes.reminderFinished") };
    case "remove":
      await removeReminder(id);
      return { reminder: null, text: t("notes.reminderRemoved") };
  }
}

const QUICK_KEYS: Record<Quick, "notes.inAnHour" | "notes.laterToday" | "notes.tomorrow" | "notes.nextWeek"> = {
  inAnHour: "notes.inAnHour",
  laterToday: "notes.laterToday",
  tomorrow: "notes.tomorrow",
  nextWeek: "notes.nextWeek",
};

function quickLabel(quick: Quick, at: Date, now: Date): string {
  const when = quick === "nextWeek" ? `${formatShortDay(at, now)}, ${formatTime(at)}` : formatTime(at);
  return t("notes.quickAt", { choice: t(QUICK_KEYS[quick]), when });
}

/** The reminder menu's choices for `note`. */
export function reminderEntries(
  note: Note,
  now: Date,
  onAction: (action: ReminderAction) => void,
  onPick: () => void,
): MenuEntry[] {
  const reminder = note.reminder;
  const passed = reminder !== null && waiting(reminder, now);
  const entries: MenuEntry[] = quickTimes(now, passed).map(({ quick, at }) => ({
    label: quickLabel(quick, at, now),
    onSelect: () => onAction(passed ? { kind: "snooze", until: at } : { kind: "set", local: localText(at), repeat: null }),
  }));
  if (reminder && (passed || reminder.rang)) {
    entries.push(SEPARATOR, { label: t("notes.reminderDone"), onSelect: () => onAction({ kind: "done" }) });
  }
  entries.push(SEPARATOR, { label: t("notes.pickTime"), onSelect: onPick });
  if (reminder) entries.push({ label: t("notes.removeReminder"), onSelect: () => onAction({ kind: "remove" }) });
  return entries;
}

export function ReminderMenu({
  note,
  place,
  onAction,
  onPick,
  onClose,
}: {
  note: Note;
  place: MenuPlace;
  onAction: (action: ReminderAction) => void;
  /** Opens the dialog for any date and time. */
  onPick: () => void;
  onClose: () => void;
}) {
  const now = new Date();
  const passed = note.reminder !== null && waiting(note.reminder, now);
  return (
    <Menu
      label={t(passed ? "notes.snooze" : "notes.remindMe")}
      heading={t(passed ? "notes.snooze" : "notes.remindMe")}
      entries={reminderEntries(note, now, onAction, onPick)}
      place={place}
      byKeyboard={false}
      onClose={onClose}
    />
  );
}

/** Sets a reminder for any date and time, and how often it repeats. */
export function ReminderDialog({
  reminder,
  onSave,
  onClose,
}: {
  reminder: Reminder | null;
  onSave: (local: string, repeat: Repeat | null) => Promise<void>;
  onClose: () => void;
}) {
  const now = new Date();
  const start = reminder?.local ?? localText(quickTimes(now).find((each) => each.quick === "tomorrow")!.at);
  const [date, setDate] = useState(datePart(start));
  const [time, setTime] = useState(timePart(start));
  const [repeat, setRepeat] = useState<Repeat | null>(reminder?.repeat ?? null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(event: TargetedSubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!date || !time) {
      setError(t("notes.reminderPast"));
      return;
    }
    // A reminder that repeats can start in the past: it rings at its next
    // time. One that doesn't needs a time that's still to come.
    if (repeat === null && new Date(`${date}T${time}`).getTime() <= Date.now()) {
      setError(t("notes.reminderPast"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onSave(`${date}T${time}`, repeat);
    } catch (problem) {
      setError(problemText(problem));
      setBusy(false);
    }
  }

  return (
    <Dialog title={t("notes.reminderTitle")} class="reminder-dialog" onClose={onClose}>
      <form onSubmit={save} noValidate>
        <div class="reminder-fields">
          <label>
            {t("notes.reminderDate")}
            <input type="date" value={date} required onInput={(event) => setDate(event.currentTarget.value)} />
          </label>
          <label>
            {t("notes.reminderTime")}
            <input type="time" value={time} required onInput={(event) => setTime(event.currentTarget.value)} />
          </label>
        </div>
        <label>
          {t("notes.reminderRepeat")}
          <select
            value={repeat ?? ""}
            onChange={(event) => setRepeat((event.currentTarget.value || null) as Repeat | null)}
          >
            <option value="">{t("notes.repeatNone")}</option>
            {REPEATS.map((each) => (
              <option key={each} value={each}>
                {repeatText(each)}
              </option>
            ))}
          </select>
        </label>
        <p class="error" role="alert">
          {error}
        </p>
        <div class="dialog-buttons">
          <button type="submit" disabled={busy}>
            {t("notes.saveReminder")}
          </button>
          <button type="button" class="secondary" onClick={onClose}>
            {t("dialog.cancel")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** A reminder as a chip on a card or in the editor, which opens the menu. */
export function ReminderChip({ reminder, onOpen }: { reminder: Reminder; onOpen: (button: HTMLElement) => void }) {
  const now = new Date();
  const text = reminderText(reminder, now);
  const passed = waiting(reminder, now);
  return (
    <button
      type="button"
      class={passed ? "note-reminder passed" : "note-reminder"}
      aria-label={t(passed ? "notes.reminderPassed" : "notes.reminderFor", { when: text })}
      aria-haspopup="menu"
      onClick={(event) => {
        event.stopPropagation();
        onOpen(event.currentTarget);
      }}
    >
      {text}
    </button>
  );
}
