// Signs in one of Accordion's apps, which opened this page in the system
// browser (decision 3). The shell has already signed the reader in. Allowing
// the app sends the browser back to it, on this computer, with a code the
// app trades for a session of its own.

import { useEffect, useState } from "preact/hooks";

import { api, type Session } from "../api.ts";
import { t } from "../i18n.ts";
import { usePasswordCheck } from "../settings/password-check.tsx";
import { problemText } from "./dialog.tsx";
import { PageTitle } from "./page.tsx";

type Stage = "checking" | "asking" | "busy" | "allowed" | "canceled" | "problem";

export function OAuthPage({ session, onSignOut }: { session: Session; onSignOut: () => Promise<void> }) {
  const query = new URLSearchParams(location.search);
  const device = query.get("device_name")?.trim() || t("oauth.someDevice");
  const [stage, setStage] = useState<Stage>("checking");
  const [problem, setProblem] = useState("");
  const [checked, passwordDialog] = usePasswordCheck();

  useEffect(() => {
    // The server checks that the request is from one of Accordion's apps,
    // for an address on this computer, before anything goes back to it.
    api("GET", `/api/oauth/check${location.search}`).then(
      () => setStage("asking"),
      (error) => {
        setProblem(problemText(error));
        setStage("problem");
      },
    );
  }, []);

  async function allow() {
    setStage("busy");
    setProblem("");
    try {
      const approved = await checked(() =>
        api<{ redirect: string }>("POST", "/api/oauth/approve", {
          response_type: query.get("response_type"),
          client_id: query.get("client_id"),
          redirect_uri: query.get("redirect_uri"),
          code_challenge: query.get("code_challenge"),
          code_challenge_method: query.get("code_challenge_method"),
          state: query.get("state"),
          device_name: query.get("device_name"),
        }),
      );
      if (!approved) {
        setStage("asking");
        return;
      }
      setStage("allowed");
      location.assign(approved.redirect);
    } catch (error) {
      setProblem(problemText(error));
      setStage("asking");
    }
  }

  function cancel() {
    // The request was checked, so its address is the app's on this
    // computer, which says so to the person waiting there.
    const back = new URL(query.get("redirect_uri") ?? "");
    back.searchParams.set("error", "access_denied");
    const state = query.get("state");
    if (state) back.searchParams.set("state", state);
    setStage("canceled");
    location.assign(back.toString());
  }

  return (
    <main class="sign-in">
      <div class="sign-in-card">
        <PageTitle>{t("oauth.title")}</PageTitle>
        {stage === "checking" && <p class="loading">{t("shell.loading")}</p>}
        {stage === "problem" && (
          <p class="error" role="alert">
            {problem}
          </p>
        )}
        {(stage === "asking" || stage === "busy") && (
          <>
            <p>{t("oauth.body", { device, name: session.user.display_name })}</p>
            <p class="hint">{t("oauth.onlyIf")}</p>
            <p>
              {/* Signing out shows the sign-in page at this same address, so
                  the app's request goes on as whoever signs in next. */}
              <button type="button" class="link" disabled={stage === "busy"} onClick={() => void onSignOut()}>
                {t("oauth.otherAccount", { name: session.user.display_name })}
              </button>
            </p>
            <p class="error" role="alert">
              {problem}
            </p>
            <div class="form-buttons">
              <button type="button" disabled={stage === "busy"} onClick={() => void allow()}>
                {t("oauth.allow")}
              </button>
              <button type="button" class="secondary" disabled={stage === "busy"} onClick={cancel}>
                {t("oauth.cancel")}
              </button>
            </div>
          </>
        )}
        {stage === "allowed" && <p role="status">{t("oauth.allowed")}</p>}
        {stage === "canceled" && <p role="status">{t("oauth.canceled")}</p>}
        {passwordDialog}
      </div>
    </main>
  );
}

/** Where the app sends the browser once it's signed in, or not, so the
 * last page looks like the rest of Accordion. Both pages share the sign-in
 * page's card, so moving between them doesn't jump. */
export function OAuthDone() {
  const result = new URLSearchParams(location.search).get("result");
  const message =
    result === "canceled" ? t("oauth.canceled") : result === "failed" ? t("oauth.failed") : t("oauth.done");
  return (
    <main class="sign-in">
      <div class="sign-in-card">
        <PageTitle>{t("oauth.title")}</PageTitle>
        <p role="status">{message}</p>
      </div>
    </main>
  );
}
