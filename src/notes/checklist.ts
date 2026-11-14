// Checklist notes: a note whose lines are all Markdown task items, such as
// "- [ ] Milk", shows as a list with checkboxes, as in Google Keep. The file
// keeps the items in their order. Checked items show at the bottom, but they
// don't move in the file (decision 31).

export interface ChecklistItem {
  checked: boolean;
  text: string;
}

const TASK = /^\s*[-*+] \[( |x|X)\](?: (.*))?$/;

/** Whether every line with something on it is a task, and there's one. */
export function isChecklist(body: string): boolean {
  const lines = body.split("\n").filter((line) => line.trim() !== "");
  return lines.length > 0 && lines.every((line) => TASK.test(line));
}

export function readChecklist(body: string): ChecklistItem[] {
  return body
    .split("\n")
    .map((line) => TASK.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => ({ checked: match[1] !== " ", text: match[2] ?? "" }));
}

export function writeChecklist(items: readonly ChecklistItem[]): string {
  return items.map((item) => `- [${item.checked ? "x" : " "}] ${item.text}`.trimEnd() + "\n").join("");
}

/** Text as a checklist: each line with something on it becomes an item,
 * without its list marker. */
export function toChecklist(body: string): ChecklistItem[] {
  return body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line) => {
      const task = TASK.exec(line);
      if (task) return { checked: task[1] !== " ", text: task[2] ?? "" };
      return { checked: false, text: line.replace(/^([-*+]|\d+\.)\s+/, "") };
    });
}

/** A checklist as plain lines of text. */
export function fromChecklist(items: readonly ChecklistItem[]): string {
  return items.map((item) => item.text).join("\n");
}

/** Ticks or unticks the `index`th task in `body`, leaving every other line
 * as it is. */
export function toggleTask(body: string, index: number): string {
  let seen = -1;
  return body
    .split("\n")
    .map((line) => {
      if (!TASK.test(line)) return line;
      seen += 1;
      if (seen !== index) return line;
      return line.replace(/\[( |x|X)\]/, (_, mark: string) => (mark === " " ? "[x]" : "[ ]"));
    })
    .join("\n");
}
