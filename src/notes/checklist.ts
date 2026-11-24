// Checklist notes: a note whose lines are all Markdown task items, such as
// "- [ ] Milk", shows as a list with checkboxes, as in Google Keep. The file
// keeps the items in their order. Checked items show at the bottom unless
// the reader's settings say otherwise, but they don't move in the file
// (decision 31). An item indented under another is its child, written two
// spaces further in: it moves with its parent, and checking the parent
// checks it too.

export interface ChecklistItem {
  checked: boolean;
  text: string;
  /** How far in it is: 0 at the left, 1 under the item above, and so on. */
  depth?: number;
}

const TASK = /^(\s*)[-*+] \[( |x|X)\](?: (.*))?$/;

/** Whether every line with something on it is a task, and there's one. */
export function isChecklist(body: string): boolean {
  const lines = body.split("\n").filter((line) => line.trim() !== "");
  return lines.length > 0 && lines.every((line) => TASK.test(line));
}

export function readChecklist(body: string): ChecklistItem[] {
  const matches = body
    .split("\n")
    .map((line) => TASK.exec(line))
    .filter((match): match is RegExpExecArray => match !== null);
  const depths = depthsOf(matches.map((match) => match[1]!));
  return matches.map((match, index) => ({ checked: match[2] !== " ", text: match[3] ?? "", depth: depths[index]! }));
}

/** Each item's depth from its indent: one deeper than the nearest item
 * above that's less indented, however many spaces or tabs that takes. */
function depthsOf(indents: readonly string[]): number[] {
  const open: number[] = [];
  return indents.map((indent) => {
    const width = indent.replace(/\t/g, "    ").length;
    while (open.length > 0 && open[open.length - 1]! >= width) open.pop();
    open.push(width);
    return open.length - 1;
  });
}

export function writeChecklist(items: readonly ChecklistItem[]): string {
  return items
    .map((item) => `${"  ".repeat(item.depth ?? 0)}- [${item.checked ? "x" : " "}] ${item.text}`.trimEnd() + "\n")
    .join("");
}

/** Where the `index`th item's children end: the first item after it that
 * isn't further in. */
export function blockEnd(items: readonly ChecklistItem[], index: number): number {
  const depth = items[index]?.depth ?? 0;
  let end = index + 1;
  while (end < items.length && (items[end]!.depth ?? 0) > depth) end++;
  return end;
}

/** The items with the `index`th ticked or unticked, as in Google Keep:
 * ticking an item ticks its children, and unticking one unticks the items
 * it's under. */
export function toggleItem(items: readonly ChecklistItem[], index: number): ChecklistItem[] {
  const checked = !items[index]!.checked;
  const next = items.map((item) => ({ ...item }));
  const end = blockEnd(items, index);
  for (let at = index; at < end; at++) next[at]!.checked = checked;
  if (!checked) {
    let depth = items[index]!.depth ?? 0;
    for (let at = index - 1; at >= 0 && depth > 0; at--) {
      const above = items[at]!.depth ?? 0;
      if (above < depth) {
        next[at]!.checked = false;
        depth = above;
      }
    }
  }
  return next;
}

/** The items with the `index`th, and its children, moved so it starts at
 * `before` (an index in `items` as they are) at `depth`. Its children
 * keep their place under it. */
export function moveItem(items: readonly ChecklistItem[], index: number, before: number, depth: number): ChecklistItem[] {
  const end = blockEnd(items, index);
  if (before > index && before < end) return [...items];
  const shift = depth - (items[index]!.depth ?? 0);
  const block = items.slice(index, end).map((item) => ({ ...item, depth: Math.max(0, (item.depth ?? 0) + shift) }));
  const rest = [...items.slice(0, index), ...items.slice(end)];
  const at = before > index ? before - block.length : before;
  rest.splice(at, 0, ...block);
  return fixDepths(rest);
}

/** The items with none further in than one past the item above, so each
 * reads back with the same depth. */
export function fixDepths(items: readonly ChecklistItem[]): ChecklistItem[] {
  let above = -1;
  return items.map((item) => {
    const depth = Math.min(item.depth ?? 0, above + 1);
    above = depth;
    return depth === (item.depth ?? 0) ? item : { ...item, depth };
  });
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
      if (task) return { checked: task[2] !== " ", text: task[3] ?? "" };
      return { checked: false, text: line.replace(/^([-*+]|\d+\.)\s+/, "") };
    });
}

/** A checklist as plain lines of text. */
export function fromChecklist(items: readonly ChecklistItem[]): string {
  return items.map((item) => item.text).join("\n");
}

/** Ticks or unticks the `index`th task in `body`, with its children and
 * the items it's under as toggleItem says, leaving every other line as it
 * is. */
export function toggleTask(body: string, index: number): string {
  const items = readChecklist(body);
  if (!items[index]) return body;
  const next = toggleItem(items, index);
  let seen = -1;
  return body
    .split("\n")
    .map((line) => {
      if (!TASK.test(line)) return line;
      seen += 1;
      return next[seen]!.checked === items[seen]!.checked
        ? line
        : line.replace(/\[( |x|X)\]/, next[seen]!.checked ? "[x]" : "[ ]");
    })
    .join("\n");
}

const TASK_START = /^\s*[-*+] \[[ xX]\] ?/;

/** Where each task's text is in `body`, in order, as offsets from the
 * start: from just after its checkbox to the end of its line. Others'
 * carets in a shared list are offsets in the body, and these place them
 * in an item. */
export function taskTexts(body: string): { start: number; end: number }[] {
  const texts: { start: number; end: number }[] = [];
  let at = 0;
  for (const line of body.split("\n")) {
    const bare = line.replace(/\r$/, "");
    const start = TASK_START.exec(bare);
    if (start && TASK.test(bare)) texts.push({ start: at + start[0].length, end: at + bare.length });
    at += line.length + 1;
  }
  return texts;
}
