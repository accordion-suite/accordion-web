// The bell in the top bar: what the reader should hear about, such as a
// folder shared with them, or someone adding files to one they shared
// (decision 18). It checks every minute while the page is in view, and
// opening it marks everything read, as in Google's apps.

import { useEffect, useRef, useState } from "preact/hooks";

import { ApiError, api } from "../api.ts";
import { Icon } from "../drive/icons.tsx";
import { t } from "../i18n.ts";
import { detail, notificationLink, notificationText, type Notifications, when } from "./events.ts";
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

  async function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    const loaded = (await load()) ?? data;
    const newest = loaded?.notifications[0];
    if (loaded && newest && loaded.unread > 0) {
      // The list keeps showing what was new until it closes.
      await api("POST", "/api/drive/notifications/read", { up_to: newest.id }).catch(() => undefined);
      setData({ ...loaded, unread: 0 });
    }
  }

  if (!available) return null;
  const unread = data?.unread ?? 0;
  const label = unread > 0 ? t("notify.buttonUnread", { count: unread }) : t("notify.button");
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
        {unread > 0 && (
          <span class="notifications-count" aria-hidden="true">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <section id="notifications-panel" class="notifications-panel" aria-labelledby="notifications-title">
          <h2 id="notifications-title">{t("notify.title")}</h2>
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
                        setOpen(false);
                        followLink(event);
                      }}
                    >
                      <span class="notification-text">{notificationText(notification, me)}</span>
                      <span class="hint">
                        <time dateTime={notification.at}>{when(notification.at)}</time>
                        {level && ` · ${t(level === "editor" ? "notify.youCanEdit" : "notify.youCanView")}`}
                      </span>
                    </a>
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
