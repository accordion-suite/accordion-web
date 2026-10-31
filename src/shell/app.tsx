// The app's shell: sign-in, and the page for the address, in its module's
// frame, or in Settings'.

import { useEffect, useState } from "preact/hooks";

import { ApiError, api, type Session } from "../api.ts";
import { FolderPage } from "../drive/folder-page.tsx";
import { HomePage } from "../drive/home-page.tsx";
import { driveSettings, startPath } from "../drive/preferences.ts";
import { uploads } from "../drive/http-transport.ts";
import { DriveLayout } from "../drive/layout.tsx";
import { SearchPage } from "../drive/search-page.tsx";
import { StarredPage } from "../drive/starred-page.tsx";
import { TrashPage } from "../drive/trash-page.tsx";
import { UploadPanel } from "../drive/upload-panel.tsx";
import { t } from "../i18n.ts";
import { PageTitle } from "./page.tsx";
import { followLink, navigate, usePath } from "./router.ts";
import { SignIn } from "./sign-in.tsx";
import { TopBar } from "./top-bar.tsx";

export function App() {
  // Undefined while the app finds out whether someone is signed in.
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [error, setError] = useState("");

  useEffect(() => {
    api<Session>("GET", "/api/session")
      .then(setSession)
      .catch((problem: ApiError) => {
        if (problem.status === 401) {
          setSession(null);
        } else {
          setError(problem.message);
        }
      });
  }, []);

  if (error) {
    return (
      <main class="narrow">
        <p class="error" role="alert">
          {error}
        </p>
      </main>
    );
  }
  if (session === undefined) {
    return <p class="loading">{t("shell.loading")}</p>;
  }
  if (session === null) {
    return <SignIn onSignedIn={setSession} />;
  }
  return (
    <SignedIn
      session={session}
      onSessionChanged={async () => setSession(await api<Session>("GET", "/api/session"))}
      onSignedOut={() => setSession(null)}
    />
  );
}

function SignedIn({
  session,
  onSessionChanged,
  onSignedOut,
}: {
  session: Session;
  /** Loads the session again, such as after the reader renames themselves. */
  onSessionChanged: () => Promise<void>;
  onSignedOut: () => void;
}) {
  const path = usePath();

  useEffect(() => {
    // A file dropped outside a folder's page would otherwise open in the
    // tab, in place of the app and its uploads.
    const ignoreDrop = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
    };
    // Leaving the page stops its uploads, so the browser asks first.
    const confirmLeaving = (event: BeforeUnloadEvent) => {
      if (uploads.busy) event.preventDefault();
    };
    window.addEventListener("dragover", ignoreDrop);
    window.addEventListener("drop", ignoreDrop);
    window.addEventListener("beforeunload", confirmLeaving);
    return () => {
      window.removeEventListener("dragover", ignoreDrop);
      window.removeEventListener("drop", ignoreDrop);
      window.removeEventListener("beforeunload", confirmLeaving);
    };
  }, []);

  async function signOut() {
    // Uploads need the session to remove what they sent.
    await uploads.cancelAll();
    uploads.clearFinished();
    await api("DELETE", "/api/session").catch(() => undefined);
    onSignedOut();
  }

  const page = drivePage(path);
  return (
    <>
      {page ? (
        <DriveLayout session={session} onSignOut={signOut}>
          {page}
        </DriveLayout>
      ) : path === "/" || path === "/drive" || path === "/drive/start" ? (
        <StartPage />
      ) : path === "/settings" || path === "/settings/" ? (
        <Redirect to="/settings/account" />
      ) : path.startsWith("/settings/") ? (
        <LazySettings path={path} session={session} onSessionChanged={onSessionChanged} onSignOut={signOut} />
      ) : (
        <>
          <TopBar session={session} onSignOut={signOut} />
          <NotFound />
        </>
      )}
      <UploadPanel />
    </>
  );
}

/** Drive's page for `path`, or null if it isn't one. Each page is keyed by
 * its path, so it starts with its own state. */
function drivePage(path: string) {
  const trimmed = path.length > "/drive/".length ? path.replace(/\/$/, "") : path;
  switch (trimmed) {
    case "/drive/":
      return <HomePage key={trimmed} />;
    case "/drive/my-drive":
      return <FolderPage key={trimmed} folder={null} />;
    case "/drive/starred":
      return <StarredPage key={trimmed} />;
    case "/drive/trash":
      return <TrashPage key={trimmed} />;
    case "/drive/search":
      return <SearchPage key={trimmed} />;
  }
  const folder = /^\/drive\/folder\/([^/]+)$/.exec(trimmed);
  return folder ? <FolderPage key={trimmed} folder={folder[1]!} /> : null;
}

type SettingsModule = typeof import("../settings/settings.tsx");

/** Settings, whose code loads the first time it opens, so Drive doesn't
 * wait for it. */
let settingsModule: SettingsModule | null = null;

function LazySettings(props: Parameters<SettingsModule["Settings"]>[0]) {
  const [loaded, setLoaded] = useState(settingsModule);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (loaded) return;
    import("../settings/settings.tsx").then(
      (module) => {
        settingsModule = module;
        setLoaded(module);
      },
      // Such as after a server update, when the old code is gone.
      () => setFailed(true),
    );
  }, []);

  if (failed) {
    return (
      <main class="narrow">
        <p class="error" role="alert">
          {t("settings.loadFailed")}
        </p>
      </main>
    );
  }
  if (!loaded) return <p class="loading">{t("shell.loading")}</p>;
  return <loaded.Settings {...props} />;
}

function NotFound() {
  return (
    <main class="page narrow">
      <PageTitle>{t("notFound.title")}</PageTitle>
      <p>{t("notFound.body")}</p>
      <p>
        <a href="/drive/" onClick={followLink}>
          {t("notFound.toDrive")}
        </a>
      </p>
    </main>
  );
}

/** Opens the reader's start page, Home or My Drive, from the server's
 * address or Drive's name in the top bar. */
function StartPage() {
  useEffect(() => {
    void driveSettings().then((settings) => navigate(startPath(settings), { replace: true }));
  }, []);
  return null;
}

/** Replaces the address with `to`, such as "/settings" with its first
 * section. */
function Redirect({ to }: { to: string }) {
  useEffect(() => navigate(to, { replace: true }), [to]);
  return null;
}
