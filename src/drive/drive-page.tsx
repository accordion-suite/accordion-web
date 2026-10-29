// A folder in Drive: what's in it, with links into subfolders and to
// download files, and uploads by button or by dropping files on it. It uses
// only Drive's own API, /api/drive (decision 13).

import type { TargetedDragEvent, TargetedEvent } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

import { api } from "../api.ts";
import { formatDate, formatSize, t } from "../i18n.ts";
import { PageTitle } from "../shell/page.tsx";
import { followLink } from "../shell/router.ts";
import { uploads } from "./http-transport.ts";
import type { Item } from "./item.ts";

interface Loaded {
  folder: Item;
  parent: Item | null;
  children: Item[];
}

function folderPath(item: Item): string {
  return item.parent === null ? "/drive/" : `/drive/folder/${item.id}`;
}

async function load(id: string | null): Promise<Loaded> {
  const folder = await api<Item>("GET", id === null ? "/api/drive/top" : `/api/drive/items/${id}`);
  const [parent, children] = await Promise.all([
    folder.parent === null ? null : api<Item>("GET", `/api/drive/items/${folder.parent}`),
    api<Item[]>("GET", `/api/drive/items/${folder.id}/children`),
  ]);
  // Folders first, then by name in the reader's language.
  const collator = new Intl.Collator(undefined, { numeric: true });
  children.sort(
    (a, b) => Number(b.kind === "folder") - Number(a.kind === "folder") || collator.compare(a.name, b.name),
  );
  return { folder, parent, children };
}

/** Whether a drag holds files from the device, rather than, say, text. */
function holdsFiles(event: DragEvent): boolean {
  return event.dataTransfer?.types.includes("Files") ?? false;
}

export function DrivePage({ folder }: { folder: string | null }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dropping, setDropping] = useState(false);
  // Drags enter and leave each element inside the page, so this counts how
  // deep the pointer is to know when it has really left.
  const dragDepth = useRef(0);
  const chooser = useRef<HTMLInputElement>(null);

  useEffect(() => {
    load(folder).then(setLoaded, (problem: Error) => setError(problem.message));
  }, [folder]);

  // Shows a file as soon as its upload into this folder finishes.
  const folderId = loaded?.folder.id;
  useEffect(() => {
    if (!folderId) return;
    return uploads.onFinished((upload) => {
      if (upload.folder.id === folderId) {
        load(folder).then(setLoaded, () => undefined);
      }
    });
  }, [folder, folderId]);

  if (error) {
    return (
      <main>
        <PageTitle>{t("drive.title")}</PageTitle>
        <p class="error" role="alert">
          {error}
        </p>
      </main>
    );
  }
  if (!loaded) {
    return <p class="loading">{t("shell.loading")}</p>;
  }
  const { parent, children } = loaded;
  const folderName = parent ? loaded.folder.name : t("drive.title");

  function upload(files: readonly File[]) {
    if (files.length > 0) {
      uploads.add(
        files.map((file) => ({ file, name: file.name })),
        { id: loaded!.folder.id, name: folderName },
      );
    }
  }

  function chosen(event: TargetedEvent<HTMLInputElement>) {
    setNotice("");
    upload([...(event.currentTarget.files ?? [])]);
    // Lets the same file be chosen again.
    event.currentTarget.value = "";
  }

  function dragEnter(event: TargetedDragEvent<HTMLElement>) {
    if (!holdsFiles(event)) return;
    event.preventDefault();
    dragDepth.current += 1;
    setDropping(true);
  }

  function dragOver(event: TargetedDragEvent<HTMLElement>) {
    if (!holdsFiles(event)) return;
    event.preventDefault();
    event.dataTransfer!.dropEffect = "copy";
  }

  function dragLeave(event: TargetedDragEvent<HTMLElement>) {
    if (!holdsFiles(event)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDropping(false);
  }

  function drop(event: TargetedDragEvent<HTMLElement>) {
    if (!holdsFiles(event)) return;
    event.preventDefault();
    dragDepth.current = 0;
    setDropping(false);
    setNotice("");
    const files: File[] = [];
    let folders = false;
    for (const entry of event.dataTransfer!.items) {
      if (entry.kind !== "file") continue;
      // A dropped folder arrives as a file that can't be read.
      if (entry.webkitGetAsEntry?.()?.isDirectory) {
        folders = true;
        continue;
      }
      const file = entry.getAsFile();
      if (file) files.push(file);
    }
    if (folders) setNotice(t("drive.noFolders"));
    upload(files);
  }

  return (
    <main
      class={dropping ? "dropping" : undefined}
      onDragEnter={dragEnter}
      onDragOver={dragOver}
      onDragLeave={dragLeave}
      onDrop={drop}
    >
      {dropping && (
        <p class="drop-hint" aria-hidden="true">
          {t("drive.dropHere", { folder: folderName })}
        </p>
      )}
      {parent && (
        <p>
          <a href={folderPath(parent)} onClick={followLink}>
            {t("drive.up", { name: parent.parent === null ? t("drive.title") : parent.name })}
          </a>
        </p>
      )}
      <PageTitle>{folderName}</PageTitle>
      <div class="toolbar">
        <button type="button" onClick={() => chooser.current?.click()}>
          {t("drive.upload")}
        </button>
        <input ref={chooser} type="file" multiple hidden onChange={chosen} />
      </div>
      <p class="error" role="alert">
        {notice}
      </p>
      {children.length === 0 ? (
        <p>{t("drive.empty")}</p>
      ) : (
        <>
          <p class="hint">{t("drive.count", { count: children.length })}</p>
          <table class="items">
            <thead>
              <tr>
                <th scope="col">{t("drive.name")}</th>
                <th scope="col">{t("drive.modified")}</th>
                <th scope="col" class="size">
                  {t("drive.size")}
                </th>
              </tr>
            </thead>
            <tbody>
              {children.map((item) => (
                <tr key={item.id}>
                  <th scope="row">
                    {item.kind === "folder" ? (
                      <a href={folderPath(item)} onClick={followLink}>
                        {item.name}
                      </a>
                    ) : (
                      <a
                        href={`/api/drive/items/${item.id}/content`}
                        download={item.name}
                        aria-label={t("drive.download", { name: item.name })}
                      >
                        {item.name}
                      </a>
                    )}
                  </th>
                  <td>{formatDate(item.modified_at)}</td>
                  <td class="size">
                    {item.kind === "folder" ? t("drive.folder") : formatSize(item.size ?? 0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </main>
  );
}
