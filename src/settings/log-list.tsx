// A list of events from the event log, newest first, for the activity logs
// in Settings (decision 18): what happened, when, from where, and who did it
// when it wasn't the reader.

import { useEffect, useState } from "preact/hooks";

import { api } from "../api.ts";
import { t } from "../i18n.ts";
import { problemText } from "../shell/dialog.tsx";
import { detail, type EventPage, type LoggedEvent, viaText, when, who } from "../shell/events.ts";
import { logText } from "./log-text.ts";
import { LoadState } from "./parts.tsx";

/** When, from where, how, and who did it if it wasn't the reader. */
function logLine(event: LoggedEvent, me: string): string {
  const parts = [when(event.at)];
  const address = detail(event, "address");
  if (address) parts.push(t("log.from", { address }));
  const how = viaText(event.via);
  if (how) parts.push(how);
  if (event.actor && event.actor.id !== me) parts.push(t("log.by", { name: who(event.actor, me) }));
  return parts.join(" · ");
}

export function LogList({ path, me }: { path: string; me: string }) {
  const [events, setEvents] = useState<LoggedEvent[] | null>(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function load(before?: number) {
    setLoading(true);
    try {
      const page = await api<EventPage>("GET", before === undefined ? path : `${path}?before=${before}`);
      setEvents((shown) => [...(before === undefined ? [] : (shown ?? [])), ...page.events]);
      setMore(page.more);
      setError("");
    } catch (problem) {
      setError(problemText(problem));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [path]);

  if (events === null) return <LoadState error={error} />;
  return (
    <>
      {events.length === 0 ? (
        <p class="hint">{t("log.none")}</p>
      ) : (
        <ul class="rows log-rows">
          {events.map((event) => (
            <li key={event.id} class="row">
              <div class="row-text">
                <strong>{logText(event, me)}</strong>
                <span class="hint">{logLine(event, me)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p class="error" role="alert">
          {error}
        </p>
      )}
      {more && (
        <div class="form-buttons">
          <button
            type="button"
            class="secondary"
            disabled={loading}
            onClick={() => void load(events[events.length - 1]?.id)}
          >
            {t("log.more")}
          </button>
        </div>
      )}
    </>
  );
}
