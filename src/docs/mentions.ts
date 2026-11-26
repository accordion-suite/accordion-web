// @mentions in comments (decision 30, step 6). Typing @ in a comment box
// lists the people who can open the document. Choosing one writes `@` and
// their name, and the comment carries who that is, so the server can ring
// their bell. Only the names still in the text when it's sent count.

import type { Mention, MentionPerson } from "./comments.ts";

/** The longest name a list follows as it's typed after @. */
const MAX_QUERY = 40;

/** The most people the list shows at once. */
export const MAX_SHOWN = 8;

/** What's typed after an @ just before the caret, and where the @ is, or
 * `null` when the caret isn't in a mention being typed. An @ counts at the
 * start or after a space or an opening bracket, so an email address
 * doesn't open the list. */
export function mentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf("@");
  if (at < 0) return null;
  const query = before.slice(at + 1);
  if (query.length > MAX_QUERY || /[\n@]/.test(query) || query.startsWith(" ")) return null;
  if (at > 0 && !/[\s([{"']/.test(before[at - 1]!)) return null;
  return { start: at, query };
}

/** The people whose name, a word of it, or username starts with `query`,
 * ignoring case, those whose name starts with it first. */
export function matchingPeople(people: MentionPerson[], query: string): MentionPerson[] {
  const wanted = query.toLocaleLowerCase();
  const scored: [number, MentionPerson][] = [];
  for (const person of people) {
    const name = person.name.toLocaleLowerCase();
    if (name.startsWith(wanted)) scored.push([0, person]);
    else if (
      name.split(/\s+/).some((word) => word.startsWith(wanted)) ||
      person.username.toLocaleLowerCase().startsWith(wanted)
    ) {
      scored.push([1, person]);
    }
  }
  return scored
    .sort((a, b) => a[0] - b[0])
    .slice(0, MAX_SHOWN)
    .map(([, person]) => person);
}

/** `text` with the mention being typed from `start` to `caret` replaced
 * by `@` and `name`, and where the caret goes after it. A space follows,
 * unless one or a punctuation mark is already there. */
export function insertMention(text: string, start: number, caret: number, name: string): { text: string; caret: number } {
  const after = text.slice(caret);
  const spaced = /^\s/.test(after);
  const written = `@${name}${spaced || /^[,.;:!?)\]}]/.test(after) ? "" : " "}`;
  return { text: text.slice(0, start) + written + after, caret: start + written.length + (spaced ? 1 : 0) };
}

/** The accounts of the people chosen, by name, whose `@` and name are
 * still in `text`. */
export function keptMentions(text: string, chosen: Map<string, string>): string[] {
  const kept = new Set<string>();
  for (const [name, user] of chosen) {
    if (text.includes(`@${name}`)) kept.add(user);
  }
  return [...kept];
}

/** A comment's text in parts, each mention apart from the text around it,
 * so it can be shown as one. Longer names are found first, so "@Sam Kim"
 * wins over "@Sam". */
export function mentionParts(text: string, mentions: Mention[]): (string | Mention)[] {
  const names = [...new Map(mentions.map((mention) => [mention.name, mention])).values()]
    .filter((mention) => mention.name !== "")
    .sort((a, b) => b.name.length - a.name.length);
  const parts: (string | Mention)[] = [];
  let plain = "";
  let at = 0;
  while (at < text.length) {
    const found = text[at] === "@" ? names.find((mention) => text.startsWith(mention.name, at + 1)) : undefined;
    if (found) {
      if (plain) parts.push(plain);
      plain = "";
      parts.push(found);
      at += found.name.length + 1;
    } else {
      plain += text[at];
      at++;
    }
  }
  if (plain) parts.push(plain);
  return parts;
}
