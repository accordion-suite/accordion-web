// The app's shell: sign-in, the top bar, and the page for the address.

import { useEffect, useState } from "preact/hooks";

import { ApiError, api, type Session } from "../api.ts";
import { DrivePage } from "../drive/drive-page.tsx";
import { uploads } from "../drive/http-transport.ts";
import { UploadPanel } from "../drive/upload-panel.tsx";
import { t } from "../i18n.ts";
import { PageTitle } from "./page.tsx";
import { followLink, navigate, usePath } from "./router.ts";
import { SignIn } from "./sign-in.tsx";

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
  return <SignedIn session={session} onSignedOut={() => setSession(null)} />;
}

function SignedIn({ session, onSignedOut }: { session: Session; onSignedOut: () => void }) {
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

  return (
    <>
      <header class="top-bar">
        <a class="app-name" href="/drive/" onClick={followLink}>
          {t("app.name")}
        </a>
        <nav aria-label={t("shell.mainMenu")}>
          <a
            href="/drive/"
            onClick={followLink}
            aria-current={path.startsWith("/drive/") ? "page" : undefined}
          >
            {t("drive.title")}
          </a>
        </nav>
        <span class="who">{t("shell.signedInAs", { name: session.user.display_name })}</span>
        <button type="button" class="secondary" onClick={signOut}>
          {t("shell.signOut")}
        </button>
      </header>
      <Route path={path} />
      <UploadPanel />
    </>
  );
}

function Route({ path }: { path: string }) {
  if (path === "/" || path === "/drive") {
    return <Redirect to="/drive/" />;
  }
  const drive = /^\/drive\/(?:folder\/([^/]+)\/?)?$/.exec(path);
  if (drive) {
    // Keyed, so each folder starts with its own state.
    return <DrivePage key={path} folder={drive[1] ?? null} />;
  }
  return (
    <main>
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

/** Replaces the address with `to`, such as "/" with "/drive/". */
function Redirect({ to }: { to: string }) {
  useEffect(() => navigate(to, { replace: true }), [to]);
  return null;
}
