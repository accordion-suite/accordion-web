// People: everyone with an account on the server. Admins add people, who
// set their own password from a link, and reset passwords, rename, turn
// accounts off, and delete them. Each change needs a recent sign-in.

import { useState } from "preact/hooks";

import { api } from "../api.ts";
import { formatMoment, t } from "../i18n.ts";
import { ConfirmDialog, Dialog, problemText } from "../shell/dialog.tsx";
import { Menu, SEPARATOR, type MenuEntry, type MenuPlace } from "../shell/menu.tsx";
import { MoreIcon } from "../drive/icons.tsx";
import { SettingsPage } from "./layout.tsx";
import { FormDialog, LoadState, Secret, useLoad } from "./parts.tsx";
import { usePasswordCheck } from "./password-check.tsx";

type Role = "owner" | "admin" | "user";

interface Person {
  id: string;
  username: string;
  display_name: string;
  role: Role;
  state: "active" | "waiting" | "turned_off";
  password_link: { purpose: "new_account" | "reset"; expires_at: string } | null;
  can_manage: boolean;
}

interface People {
  people: Person[];
  you: string;
  can_add_admins: boolean;
}

/** A link for someone to set their password. */
interface Link {
  token: string;
  expires_at: string;
}

const ROLES = { owner: "people.owner", admin: "people.admin", user: "people.user" } as const;

type Open =
  | { kind: "add" }
  | { kind: "link"; name: string; link: Link; purpose: "new_account" | "reset"; deletedAppPasswords: boolean }
  | { kind: "reset"; person: Person }
  | { kind: "rename"; person: Person }
  | { kind: "admin"; person: Person }
  | { kind: "turnOff"; person: Person }
  | { kind: "delete"; person: Person };

export function PeoplePage() {
  const people = useLoad<People>("/api/people");
  const [open, setOpen] = useState<Open | null>(null);
  const [menu, setMenu] = useState<{ person: Person; place: MenuPlace; byKeyboard: boolean } | null>(null);
  const [done, setDone] = useState("");
  const [error, setError] = useState("");
  const [checked, passwordDialog] = usePasswordCheck();

  /** Sends a change, asking for the password first if it's needed, and
   * reloads the list. Returns the change's result, or null if canceled. */
  async function change<T>(method: string, path: string, body?: unknown): Promise<T | null> {
    const result = await checked(() => api<T>(method, path, body));
    await people.reload();
    return result;
  }

  /** Runs a change from the menu, which has no dialog to show problems. */
  async function fromMenu(run: () => Promise<unknown>) {
    setDone("");
    setError("");
    try {
      await run();
    } catch (problem) {
      setError(problemText(problem));
    }
  }

  async function newLink(person: Person, deleteAppPasswords = false) {
    const link = await change<Link & { purpose: "new_account" | "reset" }>(
      "POST",
      `/api/people/${person.id}/password-link`,
      deleteAppPasswords ? { delete_app_passwords: true } : {},
    );
    if (link) {
      setOpen({
        kind: "link",
        name: person.display_name,
        link,
        purpose: link.purpose,
        deletedAppPasswords: deleteAppPasswords,
      });
    }
  }

  function entries(person: Person, data: People): MenuEntry[] {
    const all: MenuEntry[] = [];
    if (person.state === "waiting") {
      all.push({ label: t("people.newLink"), onSelect: () => void fromMenu(() => newLink(person)) });
    } else if (person.state === "active") {
      all.push({ label: t("people.resetPassword"), onSelect: () => setOpen({ kind: "reset", person }) });
    }
    if (data.can_add_admins && person.state !== "turned_off") {
      all.push(
        person.role === "admin"
          ? {
              label: t("people.makeUser"),
              onSelect: () => void fromMenu(() => change("PUT", `/api/people/${person.id}/role`, { role: "user" })),
            }
          : { label: t("people.makeAdmin"), onSelect: () => setOpen({ kind: "admin", person }) },
      );
    }
    all.push({ label: t("people.rename"), onSelect: () => setOpen({ kind: "rename", person }) });
    all.push(SEPARATOR);
    all.push(
      person.state === "turned_off"
        ? {
            label: t("people.turnOn"),
            onSelect: () => void fromMenu(() => change("POST", `/api/people/${person.id}/turn-on`)),
          }
        : { label: t("people.turnOff"), onSelect: () => setOpen({ kind: "turnOff", person }) },
    );
    all.push({ label: t("people.delete"), onSelect: () => setOpen({ kind: "delete", person }) });
    return all;
  }

  const data = people.data;
  return (
    <SettingsPage title={t("settings.people")} intro={t("people.intro")}>
      <p class="done" role="status">
        {done}
      </p>
      <p class="error" role="alert">
        {error}
      </p>
      <section class="settings-card">
        <div class="card-head">
          <h2>{t("people.title")}</h2>
          <button type="button" onClick={() => setOpen({ kind: "add" })}>
            {t("people.add")}
          </button>
        </div>
        {data === null ? (
          <LoadState error={people.error} />
        ) : (
          <ul class="rows">
            {data.people.map((person) => (
              <li key={person.id} class="row">
                <span class="avatar small" aria-hidden="true">
                  {[...person.display_name.trim()][0]?.toUpperCase() ?? "?"}
                </span>
                <div class="row-text">
                  <strong>
                    {person.id === data.you ? t("people.you", { name: person.display_name }) : person.display_name}
                  </strong>
                  <span class="hint">
                    {person.username} · {t(ROLES[person.role])}
                  </span>
                  {describe(person) && <span>{describe(person)}</span>}
                </div>
                {person.can_manage && (
                  <button
                    type="button"
                    class="icon-button"
                    aria-label={t("people.actionsFor", { name: person.display_name })}
                    aria-haspopup="menu"
                    aria-expanded={menu?.person.id === person.id}
                    onClick={(event) =>
                      setMenu({ person, place: { under: event.currentTarget }, byKeyboard: event.detail === 0 })
                    }
                  >
                    <MoreIcon />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {menu && data && (
        <Menu
          label={t("people.actionsFor", { name: menu.person.display_name })}
          entries={entries(menu.person, data)}
          place={menu.place}
          byKeyboard={menu.byKeyboard}
          align="end"
          onClose={() => setMenu(null)}
        />
      )}
      {open?.kind === "add" && data && (
        <AddDialog
          canAddAdmins={data.can_add_admins}
          onAdd={async (person) => {
            const link = await change<Link>("POST", "/api/people", person);
            if (link) {
              setOpen({ kind: "link", name: person.display_name, link, purpose: "new_account", deletedAppPasswords: false });
            }
          }}
          onClose={() => setOpen(null)}
        />
      )}
      {open?.kind === "link" && <LinkDialog {...open} onClose={() => setOpen(null)} />}
      {open?.kind === "reset" && (
        <ResetDialog
          person={open.person}
          onReset={(deleteAppPasswords) => newLink(open.person, deleteAppPasswords)}
          onClose={() => setOpen(null)}
        />
      )}
      {open?.kind === "rename" && (
        <RenameDialog
          person={open.person}
          onRename={async (names) => {
            if (await change("PUT", `/api/people/${open.person.id}/name`, names)) setOpen(null);
          }}
          onClose={() => setOpen(null)}
        />
      )}
      {open?.kind === "admin" && (
        <ConfirmDialog
          title={t("people.makeAdminTitle", { name: open.person.display_name })}
          body={t("people.makeAdminBody")}
          confirm={t("people.makeAdmin")}
          safe
          onConfirm={async () => {
            await change("PUT", `/api/people/${open.person.id}/role`, { role: "admin" });
            setOpen(null);
          }}
          onClose={() => setOpen(null)}
        />
      )}
      {open?.kind === "turnOff" && (
        <ConfirmDialog
          title={t("people.turnOffTitle", { name: open.person.display_name })}
          body={t("people.turnOffBody")}
          confirm={t("people.turnOff")}
          onConfirm={async () => {
            await change("POST", `/api/people/${open.person.id}/turn-off`);
            setOpen(null);
          }}
          onClose={() => setOpen(null)}
        />
      )}
      {open?.kind === "delete" && data && (
        <DeleteDialog
          person={open.person}
          people={data}
          onDelete={async (body, givenTo) => {
            const result = await change<{ folder: string | null }>("DELETE", `/api/people/${open.person.id}`, body);
            if (!result) return;
            setOpen(null);
            const name = open.person.display_name;
            setDone(
              result.folder
                ? t("people.deletedGiven", { name, to: givenTo!, folder: result.folder })
                : givenTo
                  ? t("people.deletedNoFiles", { name })
                  : t("people.deletedWithFiles", { name }),
            );
          }}
          onClose={() => setOpen(null)}
        />
      )}
      {passwordDialog}
    </SettingsPage>
  );
}

/** What's different about someone's account, if anything. */
function describe(person: Person): string {
  if (person.state === "turned_off") return t("people.turnedOff");
  if (person.state !== "waiting") return "";
  const link = person.password_link;
  if (!link) return t("people.linkExpired");
  const until = formatMoment(link.expires_at);
  return link.purpose === "reset" ? t("people.waitingReset", { until }) : t("people.waitingNew", { until });
}

function AddDialog({
  canAddAdmins,
  onAdd,
  onClose,
}: {
  canAddAdmins: boolean;
  onAdd: (person: { display_name: string; username: string; role: "user" | "admin" }) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [role, setRole] = useState<"user" | "admin">("user");
  return (
    <FormDialog
      title={t("people.addTitle")}
      submit={t("people.addButton")}
      onSubmit={() => onAdd({ display_name: name.trim(), username, role })}
      onClose={onClose}
    >
      <p class="hint">{t("people.addIntro")}</p>
      <label for="person-name">{t("account.name")}</label>
      <p class="hint">{t("people.nameHint")}</p>
      <input id="person-name" maxLength={100} required autofocus value={name} onInput={(event) => setName(event.currentTarget.value)} />
      <label for="person-username">{t("account.username")}</label>
      <p class="hint">{t("people.usernameHint")}</p>
      <input
        id="person-username"
        maxLength={32}
        autocomplete="off"
        autocapitalize="none"
        spellcheck={false}
        required
        value={username}
        onInput={(event) => setUsername(event.currentTarget.value)}
      />
      {canAddAdmins && (
        <>
          <label for="person-role">{t("people.role")}</label>
          <p class="hint">{t("people.roleHint")}</p>
          <select id="person-role" value={role} onChange={(event) => setRole(event.currentTarget.value as "user" | "admin")}>
            <option value="user">{t("people.user")}</option>
            <option value="admin">{t("people.admin")}</option>
          </select>
        </>
      )}
    </FormDialog>
  );
}

function LinkDialog({
  name,
  link,
  purpose,
  deletedAppPasswords,
  onClose,
}: {
  name: string;
  link: Link;
  purpose: "new_account" | "reset";
  deletedAppPasswords: boolean;
  onClose: () => void;
}) {
  const reset = purpose === "reset";
  return (
    <Dialog title={t(reset ? "people.resetLinkTitle" : "people.linkTitle", { name })} onClose={onClose}>
      <p>
        {reset
          ? t(deletedAppPasswords ? "people.resetLinkBodyDeleted" : "people.resetLinkBodyKept", { name })
          : t("people.linkBody", { name })}
      </p>
      <Secret text={`${location.origin}/welcome#${link.token}`} label={t("people.copyLink")} long />
      <p class="hint">{t("people.linkExpires", { until: formatMoment(link.expires_at), name })}</p>
      <div class="dialog-buttons">
        <button type="button" onClick={onClose}>
          {t("devices.done")}
        </button>
      </div>
    </Dialog>
  );
}

function ResetDialog({
  person,
  onReset,
  onClose,
}: {
  person: Person;
  onReset: (deleteAppPasswords: boolean) => Promise<void>;
  onClose: () => void;
}) {
  const [exposed, setExposed] = useState(false);
  return (
    <FormDialog
      title={t("people.resetTitle", { name: person.display_name })}
      submit={t("people.resetPassword")}
      onSubmit={() => onReset(exposed)}
      onClose={onClose}
    >
      <p>{t("people.resetBody")}</p>
      <fieldset class="choices">
        <label class="choice">
          <input type="radio" name="reason" checked={!exposed} onChange={() => setExposed(false)} />
          <span>
            <strong>{t("people.forgot")}</strong> {t("people.forgotHint")}
          </span>
        </label>
        <label class="choice">
          <input type="radio" name="reason" checked={exposed} onChange={() => setExposed(true)} />
          <span>
            <strong>{t("people.exposed")}</strong> {t("people.exposedHint")}
          </span>
        </label>
      </fieldset>
    </FormDialog>
  );
}

function RenameDialog({
  person,
  onRename,
  onClose,
}: {
  person: Person;
  onRename: (names: { display_name: string; username: string }) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(person.display_name);
  const [username, setUsername] = useState(person.username);
  return (
    <FormDialog
      title={t("people.renameTitle", { name: person.display_name })}
      submit={t("account.saveName")}
      onSubmit={() => onRename({ display_name: name, username })}
      onClose={onClose}
    >
      <label for="rename-name">{t("account.name")}</label>
      <p class="hint">{t("people.renameNameHint")}</p>
      <input id="rename-name" maxLength={100} required autofocus value={name} onInput={(event) => setName(event.currentTarget.value)} />
      <label for="rename-username">{t("account.username")}</label>
      <p class="hint">{t("people.renameUsernameHint")}</p>
      <input
        id="rename-username"
        maxLength={32}
        autocomplete="off"
        autocapitalize="none"
        spellcheck={false}
        required
        value={username}
        onInput={(event) => setUsername(event.currentTarget.value)}
      />
    </FormDialog>
  );
}

function DeleteDialog({
  person,
  people,
  onDelete,
  onClose,
}: {
  person: Person;
  people: People;
  onDelete: (body: unknown, givenTo: string | null) => Promise<void>;
  onClose: () => void;
}) {
  const others = people.people.filter((other) => other.id !== person.id);
  const [give, setGive] = useState(others.length > 0);
  const [to, setTo] = useState(others.some((other) => other.id === people.you) ? people.you : (others[0]?.id ?? ""));
  const [typed, setTyped] = useState("");
  return (
    <FormDialog
      title={t("people.deleteTitle", { name: person.display_name })}
      submit={t("people.deleteButton")}
      danger
      onSubmit={() =>
        onDelete(
          { username: typed, files: give ? { give_to: to } : "delete" },
          give ? (others.find((other) => other.id === to)?.display_name ?? null) : null,
        )
      }
      onClose={onClose}
    >
      <p>{t("people.deleteBody")}</p>
      <p>
        <strong>{t("people.filesQuestion")}</strong>
      </p>
      <fieldset class="choices">
        <label class="choice">
          <input type="radio" name="files" checked={give} disabled={others.length === 0} onChange={() => setGive(true)} />
          <span>
            <strong>{t("people.give")}</strong> {t("people.giveHint")}
          </span>
        </label>
        {give && (
          <>
            <label for="give-to">{t("people.giveTo")}</label>
            <select id="give-to" value={to} onChange={(event) => setTo(event.currentTarget.value)}>
              {others.map((other) => (
                <option key={other.id} value={other.id}>
                  {other.id === people.you ? t("people.you", { name: other.display_name }) : other.display_name}
                </option>
              ))}
            </select>
          </>
        )}
        <label class="choice">
          <input type="radio" name="files" checked={!give} onChange={() => setGive(false)} />
          <span>
            <strong>{t("people.deleteFiles")}</strong> {t("people.deleteFilesHint")}
          </span>
        </label>
      </fieldset>
      <label for="delete-username">{t("people.typeUsername", { username: person.username })}</label>
      <input
        id="delete-username"
        autocomplete="off"
        autocapitalize="none"
        spellcheck={false}
        required
        value={typed}
        onInput={(event) => setTyped(event.currentTarget.value)}
      />
    </FormDialog>
  );
}
