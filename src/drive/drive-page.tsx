// A folder in Drive: what's in it, with links into subfolders and to
// download files. It uses only Drive's own API, /api/drive (decision 13).

import { useEffect, useState } from "preact/hooks";

import { api } from "../api.ts";
import { formatDate, formatSize, t } from "../i18n.ts";
import { PageTitle } from "../shell/page.tsx";
import { followLink } from "../shell/router.ts";

/** A file or folder, as `/api/drive` describes it. */
interface Item {
  id: string;
  parent: string | null;
  name: string;
  kind: "file" | "folder";
  size: number | null;
  modified_at: string;
}

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

export function DrivePage({ folder }: { folder: string | null }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    load(folder).then(setLoaded, (problem: Error) => setError(problem.message));
  }, [folder]);

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
  return (
    <main>
      {parent && (
        <p>
          <a href={folderPath(parent)} onClick={followLink}>
            {t("drive.up", { name: parent.parent === null ? t("drive.title") : parent.name })}
          </a>
        </p>
      )}
      <PageTitle>{parent ? loaded.folder.name : t("drive.title")}</PageTitle>
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
