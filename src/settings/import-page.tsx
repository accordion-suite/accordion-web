// Import from Google (decision 34): the reader uploads the archives Google
// Takeout made, or chooses ones already in Drive, sees what they hold, and
// imports it. Keep's notes go to Notes and Drive's files to Drive; anything
// no app converts yet is kept as files. Imports run on the server, so the
// page can close, and the bell says when one ends.

import { useEffect, useRef, useState } from "preact/hooks";

import { api } from "../api.ts";
import { httpTransport } from "../drive/http-transport.ts";
import { uploadFile } from "../drive/uploads.ts";
import { formatDate, formatSize, t } from "../i18n.ts";
import { problemText } from "../shell/dialog.tsx";
import { useLive } from "../shell/live.ts";
import { followLink } from "../shell/router.ts";
import { SettingsPage } from "./layout.tsx";
import { LoadState, type Outcome, OutcomeLine, useLoad } from "./parts.tsx";

interface Archive {
  id: string;
  name: string;
  size: number;
  modified_at: string;
  /** `takeout` for Google Takeout, `top` for the top of My Drive. */
  place: "takeout" | "top";
}

interface Archives {
  archives: Archive[];
  folder: string | null;
}

interface FolderFound {
  folder: string;
  product: string | null;
  google: string | null;
  app: string | null;
  items: number;
  bytes: number;
}

interface Plan {
  parts: { format: string; entries: number }[];
  folders: FolderFound[];
  skipped: { path: string; why: string }[];
  skipped_count: number;
  room: number | null;
}

interface Import {
  id: string;
  state: "running" | "canceling" | "done" | "canceled" | "failed";
  items: number | null;
  done: number;
  started_at: string;
  finished_at: string | null;
  error: string | null;
  report: { id: string; name: string; folder: string | null } | null;
}

/** What to import from a folder of the export. */
type TakeItem = { product: string } | { other: string };

function takeOf(folder: FolderFound): TakeItem {
  return folder.product ? { product: folder.product } : { other: folder.folder };
}

function keyOf(folder: FolderFound): string {
  return folder.product ? `product:${folder.product}` : `other:${folder.folder}`;
}

const TAKEOUT_URL = "https://takeout.google.com/";

export function ImportPage() {
  const archives = useLoad<Archives>("/api/takeout/archives");
  const imports = useLoad<{ imports: Import[] }>("/api/takeout/imports");
  const [chosen, setChosen] = useState<Set<string> | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [taking, setTaking] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<"" | "upload" | "plan" | "start" | string>("");
  const [uploading, setUploading] = useState<{ name: string; sent: number; size: number } | null>(null);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useLive("takeout.imports", () => void imports.reload());
  useLive("drive.items", () => void archives.reload());

  // Every archive starts chosen, and new uploads join them.
  const all = archives.data?.archives ?? [];
  const selected = chosen ?? new Set(all.map((archive) => archive.id));
  useEffect(() => setPlan(null), [chosen, archives.data]);

  const running = imports.data?.imports.find((item) => item.state === "running" || item.state === "canceling") ?? null;

  async function upload(files: FileList) {
    setOutcome(null);
    setBusy("upload");
    try {
      const folder = await api<{ id: string }>("POST", "/api/takeout/folder");
      const added: string[] = [];
      for (const file of Array.from(files)) {
        setUploading({ name: file.name, sent: 0, size: file.size });
        const item = await uploadFile(
          { file, name: file.name, folder: { id: folder.id, name: t("import.takeoutFolder") } },
          httpTransport,
          (state) => {
            if (state.kind === "sending" || state.kind === "retrying")
              setUploading({ name: file.name, sent: state.sent, size: file.size });
          },
          new AbortController().signal,
        );
        added.push(item.id);
      }
      await archives.reload();
      if (chosen) setChosen(new Set([...chosen, ...added]));
      setOutcome({ done: t("import.uploaded", { count: files.length }) });
    } catch (problem) {
      setOutcome({ problem: problemText(problem) });
    } finally {
      setUploading(null);
      setBusy("");
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function check() {
    setOutcome(null);
    setBusy("plan");
    try {
      const found = await api<Plan>("POST", "/api/takeout/plan", { parts: [...selected] });
      setPlan(found);
      // What an app converts starts chosen. Folders no app converts, such
      // as Google Photos, can be large, so the reader chooses them.
      setTaking(new Set(found.folders.filter((folder) => folder.product).map(keyOf)));
    } catch (problem) {
      setOutcome({ problem: problemText(problem) });
    } finally {
      setBusy("");
    }
  }

  async function start() {
    if (!plan) return;
    setOutcome(null);
    setBusy("start");
    try {
      const take = plan.folders.filter((folder) => taking.has(keyOf(folder))).map(takeOf);
      await api("POST", "/api/takeout/imports", { parts: [...selected], take });
      setPlan(null);
      await imports.reload();
    } catch (problem) {
      setOutcome({ problem: problemText(problem) });
    } finally {
      setBusy("");
    }
  }

  async function cancel(id: string) {
    setOutcome(null);
    setBusy(id);
    try {
      await api("POST", `/api/takeout/imports/${id}/cancel`);
      await imports.reload();
    } catch (problem) {
      setOutcome({ problem: problemText(problem) });
    } finally {
      setBusy("");
    }
  }

  if (!archives.data || !imports.data) {
    return (
      <SettingsPage title={t("settings.import")}>
        <LoadState error={archives.error || imports.error} />
      </SettingsPage>
    );
  }

  const chosenBytes = plan
    ? plan.folders.filter((folder) => taking.has(keyOf(folder))).reduce((sum, folder) => sum + folder.bytes, 0)
    : 0;
  const tooBig = plan !== null && plan.room !== null && chosenBytes > plan.room;

  return (
    <SettingsPage title={t("settings.import")}>
      <OutcomeLine outcome={outcome} />
      <section class="settings-card">
        <h2>{t("import.howTitle")}</h2>
        <ol class="steps">
          <li>
            {t("import.howExport")}{" "}
            <a href={TAKEOUT_URL} target="_blank" rel="noopener noreferrer">
              {t("import.takeoutLink")}
            </a>
          </li>
          <li>{t("import.howUpload")}</li>
          <li>{t("import.howCheck")}</li>
        </ol>
      </section>

      <section class="settings-card">
        <div class="card-head">
          <h2 id="archives-title">{t("import.archivesTitle")}</h2>
          <button type="button" disabled={busy !== ""} onClick={() => fileInput.current?.click()}>
            {t("import.upload")}
          </button>
          <input
            ref={fileInput}
            type="file"
            multiple
            accept=".zip,.tgz,.gz,application/zip,application/gzip"
            hidden
            onChange={(event) => {
              const files = event.currentTarget.files;
              if (files && files.length > 0) void upload(files);
            }}
          />
        </div>
        {uploading && (
          <p role="status">
            {t("import.uploading", {
              name: uploading.name,
              percent: String(Math.floor((uploading.sent / Math.max(uploading.size, 1)) * 100)),
            })}
          </p>
        )}
        {all.length === 0 ? (
          <p class="hint">{t("import.noArchives")}</p>
        ) : (
          <fieldset class="choices" aria-labelledby="archives-title">
            {all.map((archive) => (
              <label class="choice" key={archive.id}>
                <input
                  type="checkbox"
                  checked={selected.has(archive.id)}
                  disabled={busy !== ""}
                  onChange={(event) => {
                    const next = new Set(selected);
                    if (event.currentTarget.checked) next.add(archive.id);
                    else next.delete(archive.id);
                    setChosen(next);
                  }}
                />
                <span class="choice-text">
                  <strong>{archive.name}</strong>
                  <span class="hint">
                    {t(archive.place === "takeout" ? "import.inTakeout" : "import.inMyDrive", {
                      size: formatSize(archive.size),
                    })}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
        )}
        <p class="hint">{t("import.archivesHint")}</p>
        <div class="form-buttons">
          <button type="button" disabled={busy !== "" || selected.size === 0 || running !== null} onClick={() => void check()}>
            {t("import.check")}
          </button>
        </div>
        {busy === "plan" && <p role="status">{t("import.checking")}</p>}
        {running && <p class="hint">{t("import.oneAtATime")}</p>}
      </section>

      {plan && (
        <section class="settings-card">
          <h2 id="found-title">{t("import.foundTitle")}</h2>
          {plan.folders.length === 0 ? (
            <p class="hint">{t("import.foundNothing")}</p>
          ) : (
            <fieldset class="choices" aria-labelledby="found-title">
              {plan.folders.map((folder) => (
                <label class="choice" key={keyOf(folder)}>
                  <input
                    type="checkbox"
                    checked={taking.has(keyOf(folder))}
                    disabled={busy !== ""}
                    onChange={(event) => {
                      const next = new Set(taking);
                      if (event.currentTarget.checked) next.add(keyOf(folder));
                      else next.delete(keyOf(folder));
                      setTaking(next);
                    }}
                  />
                  <span class="choice-text">
                    <strong>{folder.google ?? folder.folder}</strong>
                    <span class="hint">
                      {folder.app
                        ? t("import.intoApp", { count: folder.items, app: folder.app, size: formatSize(folder.bytes) })
                        : t("import.keptAsFiles", { count: folder.items, size: formatSize(folder.bytes) })}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>
          )}
          {plan.skipped_count > 0 && (
            <details>
              <summary>{t("import.skipped", { count: plan.skipped_count })}</summary>
              <ul class="plain-list">
                {plan.skipped.map((skipped) => (
                  <li key={skipped.path}>
                    <code>{skipped.path}</code>: {skipped.why}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <p class="hint">
            {plan.room === null
              ? t("import.size", { size: formatSize(chosenBytes) })
              : t("import.sizeAndRoom", { size: formatSize(chosenBytes), room: formatSize(plan.room) })}
          </p>
          {tooBig && <p class="error">{t("import.tooBig")}</p>}
          <p class="hint">{t("import.where")}</p>
          <div class="form-buttons">
            <button type="button" disabled={busy !== "" || taking.size === 0 || tooBig} onClick={() => void start()}>
              {t("import.start")}
            </button>
          </div>
        </section>
      )}

      <section class="settings-card">
        <h2>{t("import.importsTitle")}</h2>
        {imports.data.imports.length === 0 ? (
          <p class="hint">{t("import.noImports")}</p>
        ) : (
          <ul class="rows">
            {imports.data.imports.map((item) => (
              <li key={item.id} class="row">
                <div class="row-text">
                  <strong>{t("import.started", { date: formatDate(item.started_at) })}</strong>
                  <span role={item.state === "running" ? "status" : undefined}>{importLine(item)}</span>
                  {item.error && <span class="error">{item.error}</span>}
                  {item.report && (
                    <a
                      href={item.report.folder ? `/drive/folder/${item.report.folder}?file=${item.report.id}` : "/drive/my-drive"}
                      onClick={followLink}
                    >
                      {t("import.openReport")}
                    </a>
                  )}
                  {item.state === "running" && (
                    <div class="row-buttons">
                      <button type="button" class="secondary" disabled={busy !== ""} onClick={() => void cancel(item.id)}>
                        {t("import.cancel")}
                      </button>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </SettingsPage>
  );
}

/** Where an import is, in words. */
function importLine(item: Import): string {
  switch (item.state) {
    case "running":
      return item.items === null ? t("import.counting") : t("import.progress", { done: item.done, count: item.items });
    case "canceling":
      return t("import.canceling");
    case "done":
      return t("import.done", { count: item.done });
    case "canceled":
      return t("import.canceled", { count: item.done });
    case "failed":
      return t("import.failed");
  }
}
