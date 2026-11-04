// Links in the share dialog (decision 22): an item's links, making one for
// people without an account, and removing one. A new link's address is
// shown once, because the server keeps only its hash.

import type { TargetedSubmitEvent } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

import { api } from "../api.ts";
import { formatDay, t } from "../i18n.ts";
import { problemText as message } from "../shell/dialog.tsx";
import type { Item } from "./item.ts";

export interface Link {
  id: string;
  item: string;
  made_by: string;
  made_by_name: string;
  /** Whether the reader may remove it: its maker, the owner, and admins
   * may. */
  removable: boolean;
  password: boolean;
  note: string;
  created_at: string;
  expires_at: string | null;
  download_limit: number | null;
  downloads: number;
  opens: number;
  last_opened_at: string | null;
}

const EXPIRES = ["1d", "7d", "30d", "1y", "never"] as const;
type Expires = (typeof EXPIRES)[number];

const EXPIRES_NAMES = {
  "1d": "links.expires1d",
  "7d": "links.expires7d",
  "30d": "links.expires30d",
  "1y": "links.expires1y",
  never: "links.expiresNever",
} as const;

/** What a link's row says about it. */
export function linkFacts(link: Link): string {
  const facts = [
    link.expires_at
      ? t("links.expiresOn", { day: formatDay(link.expires_at) })
      : t("links.neverExpires"),
  ];
  if (link.password) facts.push(t("links.hasPassword"));
  if (link.download_limit !== null) {
    facts.push(t("links.downloadsOf", { count: String(link.downloads), limit: String(link.download_limit) }));
  }
  facts.push(
    link.last_opened_at
      ? t(link.opens === 1 ? "links.openedOnce" : "links.opened", {
          count: String(link.opens),
          day: formatDay(link.last_opened_at),
        })
      : t("links.notOpened"),
  );
  return facts.join(" ");
}

export function LinksSection({ item, onChanged }: { item: Item; onChanged: () => void }) {
  const [links, setLinks] = useState<Link[] | null>(null);
  const [making, setMaking] = useState(false);
  const [made, setMade] = useState("");
  const [expires, setExpires] = useState<Expires>("30d");
  const [password, setPassword] = useState("");
  const [limit, setLimit] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    setLinks(await api<Link[]>("GET", `/api/drive/items/${item.id}/links`));
  }

  useEffect(() => {
    load().catch((problem) => setError(message(problem)));
  }, [item.id]);

  async function make(event: TargetedSubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const downloadLimit = limit.trim() === "" ? null : Number(limit);
    if (downloadLimit !== null && (!Number.isInteger(downloadLimit) || downloadLimit < 1)) {
      setError(t("links.badLimit"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      const reply = await api<{ url: string }>("POST", `/api/drive/items/${item.id}/links`, {
        expires,
        password,
        download_limit: downloadLimit,
        note,
      });
      setMade(reply.url);
      setMaking(false);
      setPassword("");
      setLimit("");
      setNote("");
      onChanged();
      await load();
    } catch (problem) {
      setError(message(problem));
    }
    setBusy(false);
  }

  async function remove(link: Link) {
    setBusy(true);
    setError("");
    try {
      await api("DELETE", `/api/drive/links/${link.id}`);
      onChanged();
      await load();
    } catch (problem) {
      setError(message(problem));
    }
    setBusy(false);
  }

  return (
    <section class="share-links">
      <h3 class="share-heading">{t("links.title")}</h3>
      <p class="hint">{t("links.help")}</p>
      {made && <MadeLink url={made} />}
      {links === null ? (
        !error && <p class="loading">{t("shell.loading")}</p>
      ) : (
        links.length > 0 && (
          <ul class="share-people">
            {links.map((link) => (
              <li key={link.id}>
                <span class="share-name">
                  <span>{link.note || t("links.unnamed", { name: link.made_by_name })}</span>
                  <span class="share-username">{linkFacts(link)}</span>
                </span>
                {link.removable && (
                  <button
                    type="button"
                    class="secondary"
                    disabled={busy}
                    aria-label={t("links.removeNamed", { name: link.note || t("links.thisLink") })}
                    onClick={() => void remove(link)}
                  >
                    {t("share.remove")}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )
      )}
      {making ? (
        <form class="link-form" onSubmit={make} noValidate>
          <label for="link-expires">{t("links.expires")}</label>
          <select id="link-expires" value={expires} onChange={(event) => setExpires(event.currentTarget.value as Expires)}>
            {EXPIRES.map((value) => (
              <option key={value} value={value}>
                {t(EXPIRES_NAMES[value])}
              </option>
            ))}
          </select>
          <label for="link-password">{t("links.password")}</label>
          <input
            id="link-password"
            type="password"
            autocomplete="new-password"
            value={password}
            onInput={(event) => setPassword(event.currentTarget.value)}
          />
          <label for="link-limit">{t("links.limit")}</label>
          <input
            id="link-limit"
            class="short"
            inputMode="numeric"
            value={limit}
            onInput={(event) => setLimit(event.currentTarget.value)}
          />
          <label for="link-note">{t("links.note")}</label>
          <input
            id="link-note"
            maxLength={200}
            placeholder={t("links.noteHint")}
            value={note}
            onInput={(event) => setNote(event.currentTarget.value)}
          />
          <div class="form-buttons">
            <button type="submit" disabled={busy}>
              {t("links.make")}
            </button>
            <button type="button" class="secondary" onClick={() => setMaking(false)}>
              {t("dialog.cancel")}
            </button>
          </div>
        </form>
      ) : (
        <div class="form-buttons">
          <button type="button" class="secondary" onClick={() => setMaking(true)}>
            {t("links.new")}
          </button>
        </div>
      )}
      <p class="error" role="alert">
        {error}
      </p>
    </section>
  );
}

/** A new link's address, with a button that copies it. */
function MadeLink({ url }: { url: string }) {
  const field = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState<boolean | null>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      field.current?.select();
      setCopied(false);
    }
  }

  return (
    <div class="made-link">
      <label for="made-link">{t("links.madeTitle")}</label>
      <div class="made-link-row">
        <input id="made-link" ref={field} readOnly value={url} onFocus={(event) => event.currentTarget.select()} />
        <button type="button" onClick={() => void copy()}>
          {copied ? t("links.copied") : t("links.copy")}
        </button>
      </div>
      <p class="hint" role="status">
        {copied === false ? t("links.copySelected") : t("links.once")}
      </p>
    </div>
  );
}
