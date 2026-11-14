// Asking before a move lets more people open something (decision 32).
// Moving an item into a folder that's shared, or has a link, shares the
// item too. Before such a move, the web app asks the server who'd gain
// access, names them, and moves only if the reader agrees. Each move then
// names the people the reader agreed to, and the server refuses one that
// would reach anyone else, such as someone added to the folder in the
// meantime, so the reader is asked about them too.
//
// Undo and redo are moves as well. Redo names the people the first move
// showed, and undoing a move out of a shared folder names the people who
// lost access, so neither asks again unless someone new would gain access.

import { render } from "preact";

import { ApiError, api } from "../api.ts";
import { formatList, t } from "../i18n.ts";
import { Dialog } from "../shell/dialog.tsx";
import type { Item } from "./item.ts";

/** Someone a move would let in, or leave out. */
export interface Person {
  user: string;
  display_name: string;
}

/** Who a move would let open the items, beyond who can now. */
interface Widening {
  people: Person[];
  /** How many working links would reach them. */
  links: number;
}

/** What the reader agreed to, sent with each move. */
export interface Consent {
  allow: string[];
  allow_links: boolean;
}

/** Agreeing to nothing: a move that would share anything is refused. */
export function noConsent(): Consent {
  return { allow: [], allow_links: false };
}

/** Consent to give back access to `people`, such as for undoing a move
 * that took it away. */
export function consentFor(people: readonly Person[]): Consent {
  return { allow: people.map((person) => person.user), allow_links: true };
}

/** Asks the reader before `items` move into `folder`, if that would let
 * anyone new open them. Returns what to send with each move, or null if
 * the reader canceled. */
export async function askToMove(
  items: readonly Pick<Item, "id" | "parent" | "name">[],
  folder: { id: string; name: string },
): Promise<Consent | null> {
  const moving = items.filter((item) => item.parent !== folder.id);
  if (moving.length === 0) return noConsent();
  const widening = await api<Widening>("POST", "/api/drive/move-check", {
    items: moving.map((item) => item.id),
    into: folder.id,
  });
  return agree(widening, moving, folder.name, noConsent());
}

async function agree(
  widening: Widening,
  items: readonly Pick<Item, "name">[],
  folderName: string,
  consent: Consent,
): Promise<Consent | null> {
  if (widening.people.length === 0 && widening.links === 0) return consent;
  if (!(await confirmSharing(widening, items, folderName))) return null;
  return {
    allow: [...new Set([...consent.allow, ...widening.people.map((person) => person.user)])],
    allow_links: consent.allow_links || widening.links > 0,
  };
}

/** Moves an item, naming who the reader agreed may open it. If the server
 * says someone else would, the reader is asked about them, and `consent`
 * grows to include them. Returns who can't open the item anymore, or null
 * if the reader canceled. */
export async function moveWithConsent(
  item: Pick<Item, "id" | "name">,
  change: { parent: string; name?: string },
  consent: Consent,
  folderName: string,
): Promise<Person[] | null> {
  for (;;) {
    try {
      const moved = await api<{ lost?: Person[] }>("PATCH", `/api/drive/items/${item.id}`, { ...change, ...consent });
      return moved.lost ?? [];
    } catch (problem) {
      if (!(problem instanceof ApiError) || problem.code !== "would_share") throw problem;
      const widening = problem.data as Widening;
      const agreed = await agree(widening, [item], folderName, consent);
      if (!agreed) return null;
      consent.allow = agreed.allow;
      consent.allow_links = agreed.allow_links;
    }
  }
}

/** Everyone in `lists`, once each. */
export function everyone(lists: readonly (readonly Person[])[]): Person[] {
  const seen = new Map<string, Person>();
  for (const list of lists) for (const person of list) seen.set(person.user, person);
  return [...seen.values()];
}

/** A move's notice: `moved`, such as "Moved Plan.md to My Drive.", then
 * who can't open what moved anymore. Undoing the move gives them access
 * again, so the notice once it's undone says that instead. */
export function movedNotice(moved: string, lost: readonly Person[], count: number): { message: string; undone?: string } {
  if (lost.length === 0) return { message: moved };
  const people = formatList(lost.map((person) => person.display_name));
  const one = count === 1;
  return {
    message: `${moved} ${t(one ? "move.lostOne" : "move.lostMany", { people })}`,
    undone: `${t("drive.undoneChange", { change: moved })} ${t(one ? "move.backOne" : "move.backMany", { people })}`,
  };
}

/** Shows the question, and resolves with the answer. */
function confirmSharing(widening: Widening, items: readonly Pick<Item, "name">[], folderName: string): Promise<boolean> {
  return new Promise((answer) => {
    const host = document.createElement("div");
    document.body.append(host);
    const close = (yes: boolean) => {
      render(null, host);
      host.remove();
      answer(yes);
    };
    render(<ShareQuestion widening={widening} items={items} folderName={folderName} onAnswer={close} />, host);
  });
}

function ShareQuestion({
  widening,
  items,
  folderName,
  onAnswer,
}: {
  widening: Widening;
  items: readonly Pick<Item, "name">[];
  folderName: string;
  onAnswer: (yes: boolean) => void;
}) {
  const one = items.length === 1;
  const what = one ? items[0]!.name : t("move.theItems", { count: items.length });
  const title = one ? t("move.shareOne", { name: what }) : t("move.shareMany", { count: items.length });
  const people = widening.people.map((person) => person.display_name);
  return (
    <Dialog title={title} onClose={() => onAnswer(false)}>
      {people.length > 0 && <p>{t("move.people", { folder: folderName, people: formatList(people), name: what })}</p>}
      {widening.links > 0 && (
        <p>{t(people.length > 0 ? "move.linksToo" : "move.links", { folder: folderName, name: what })}</p>
      )}
      <div class="dialog-buttons">
        <button type="button" onClick={() => onAnswer(true)}>
          {t("move.moveAndShare")}
        </button>
        {/* Focus starts on the safe choice. */}
        <button type="button" class="secondary" autofocus onClick={() => onAnswer(false)}>
          {t("dialog.cancel")}
        </button>
      </div>
    </Dialog>
  );
}
