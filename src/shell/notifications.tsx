// The bell in the top bar: what the reader should hear about, such as a
// folder shared with them, or someone adding files to one they shared
// (decision 18). It checks every minute while the page is in view. Opening
// it clears the count, and each notification stays highlighted until it's
// selected. Each can be removed, or all of them at once.

import { useEffect, useRef, useState } from "preact/hooks";

import { ApiError, api } from "../api.ts";
import { CloseIcon, Icon } from "../drive/icons.tsx";
import { t } from "../i18n.ts";
import {
  detail,
  type Notification,
  notificationLink,
  notificationText,
  type Notifications,
  when,
} from "./events.ts";
import { followLink } from "./router.ts";

/** How often the bell checks, while the page is in view. */
const EVERY_MS = 60_000;

const BellIcon = () => (
  <Icon>
    <path
      d="M12 2.5a1.5 1.5 0 0 0-1.5 1.5v.7A6.5 6.5 0 0 0 5.5 11v4.3l-1.8 2.2a.9.9 0 0 0 .7 1.5h15.2a.9.9 0 0 0 .7-1.5l-1.8-2.2V11a6.5 6.5 0 0 0-5-6.3V4A1.5 1.5 0 0 0 12 2.5m0 4.1a4.5 4.5 0 0 1 4.5 4.4v5h-9v-5A4.5 4.5 0 0 1 12 6.6M9.6 20a2.4 2.4 0 0 0 4.8 0z"
      fill="currentColor"
      fill-rule="evenodd"
    />
  </Icon>
);

export function NotificationsButton({ me }: { me: string }) {
  const [data, setData] = useState<Notifications | null>(null);
  // Without Drive, there's nothing to hear about, so the bell goes.
  const [available, setAvailable] = useState(true);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const holder = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  async function load(): Promise<Notifications | null> {
    try {
      const loaded = await api<Notifications>("GET", "/api/drive/notifications");
      setData(loaded);
      setError("");
      return loaded;
    } catch (problem) {
      if (problem instanceof ApiError && problem.status === 404) setAvailable(false);
      else setError(problem instanceof Error ? problem.message : t("error.problem"));
      return null;
    }
  }

  useEffect(() => {
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, EVERY_MS);
    const shown = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", shown);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", shown);
    };
  }, []);

  // Closes on Escape, or a press outside the list.
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!holder.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  /** Opening the list sees everything in it, which clears the count. Each
   * one stays highlighted until it's selected. */
  async function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    const loaded = (await load()) ?? data;
    const newest = loaded?.notifications[0];
    if (loaded && newest && loaded.new > 0) {
      await api("POST", "/api/drive/notifications/seen", { up_to: newest.id }).catch(() => undefined);
      setData({ ...loaded, new: 0, notifications: loaded.notifications.map((each) => ({ ...each, seen: true })) });
    }
  }

  function select(chosen: Notification) {
    setOpen(false);
    if (chosen.read || !data) return;
    // Sent without waiting, so going to what it's about isn't held up.
    void api("POST", "/api/drive/notifications/read", { ids: chosen.ids }).catch(() => undefined);
    setData({
      ...data,
      notifications: data.notifications.map((each) => (each.id === chosen.id ? { ...each, read: true } : each)),
    });
  }

  async function remove(chosen: Notification) {
    if (!data) return;
    const before = data;
    setData({ ...data, notifications: data.notifications.filter((each) => each.id !== chosen.id) });
    try {
      await api("POST", "/api/drive/notifications/remove", { ids: chosen.ids });
    } catch (problem) {
      setData(before);
      setError(problem instanceof Error ? problem.message : t("error.problem"));
    }
  }

  async function clearAll() {
    const newest = data?.notifications[0];
    if (!data || !newest) return;
    const before = data;
    setData({ ...data, notifications: [] });
    try {
      await api("DELETE", `/api/drive/notifications?up_to=${newest.id}`);
      button.current?.focus();
    } catch (problem) {
      setData(before);
      setError(problem instanceof Error ? problem.message : t("error.problem"));
    }
  }

  if (!available) return null;
  const unseen = data?.new ?? 0;
  const label = unseen > 0 ? t("notify.buttonUnread", { count: unseen }) : t("notify.button");
  return (
    <div class="notifications" ref={holder}>
      <button
        ref={button}
        type="button"
        class="icon-button"
        title={label}
        aria-label={label}
        aria-expanded={open}
        aria-controls="notifications-panel"
        onClick={() => void toggle()}
      >
        <BellIcon />
        {unseen > 0 && (
          <span class="notifications-count" aria-hidden="true">
            {unseen > 9 ? "9+" : unseen}
          </span>
        )}
      </button>
      {open && (
        <section id="notifications-panel" class="notifications-panel" aria-labelledby="notifications-title">
          <div class="notifications-head">
            <h2 id="notifications-title">{t("notify.title")}</h2>
            {data && data.notifications.length > 0 && (
              <button type="button" class="link" onClick={() => void clearAll()}>
                {t("notify.clearAll")}
              </button>
            )}
          </div>
          {error && (
            <p class="error" role="alert">
              {error}
            </p>
          )}
          {data === null ? (
            !error && <p class="hint">{t("shell.loading")}</p>
          ) : data.notifications.length === 0 ? (
            <p class="hint">{t("notify.none")}</p>
          ) : (
            <ul>
              {data.notifications.map((notification) => {
                const level = detail(notification, "level");
                return (
                  <li key={notification.id} class={notification.read ? undefined : "unread"}>
                    <a
                      href={notificationLink(notification)}
                      onClick={(event) => {
                        select(notification);
                        followLink(event);
                      }}
                    >
                      <span class="notification-text">{notificationText(notification, me)}</span>
                      <span class="hint">
                        <time dateTime={notification.at}>{when(notification.at)}</time>
                        {level && ` · ${t(level === "editor" ? "notify.youCanEdit" : "notify.youCanView")}`}
                      </span>
                    </a>
                    <button
                      type="button"
                      class="icon-button"
                      aria-label={t("notify.remove", { text: notificationText(notification, me) })}
                      title={t("notify.removeShort")}
                      onClick={() => void remove(notification)}
                    >
                      <CloseIcon />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
