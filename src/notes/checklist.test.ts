import assert from "node:assert/strict";
import { test } from "node:test";

import {
  fromChecklist,
  isChecklist,
  moveItem,
  readChecklist,
  taskTexts,
  toChecklist,
  toggleItem,
  toggleTask,
  writeChecklist,
} from "./checklist.ts";

test("a note is a checklist when every line is a task", () => {
  assert.equal(isChecklist("- [ ] Milk\n- [x] Bread\n"), true);
  assert.equal(isChecklist("\n* [X] Eggs\n\n"), true);
  assert.equal(isChecklist("Shopping\n- [ ] Milk"), false);
  assert.equal(isChecklist(""), false);
});

test("reads and writes a checklist", () => {
  const items = readChecklist("- [ ] Milk\n- [x] Bread\n- [ ]\n");
  assert.deepEqual(items, [
    { checked: false, text: "Milk", depth: 0 },
    { checked: true, text: "Bread", depth: 0 },
    { checked: false, text: "", depth: 0 },
  ]);
  assert.equal(writeChecklist(items), "- [ ] Milk\n- [x] Bread\n- [ ]\n");
});

test("reads indented items as children, however they're indented", () => {
  const items = readChecklist("- [ ] Trip\n    - [ ] Tickets\n\t\t- [x] Seats\n  - [ ] Bags\n- [ ] Home\n");
  assert.deepEqual(
    items.map((item) => item.depth),
    [0, 1, 2, 1, 0],
  );
  assert.equal(writeChecklist(items), "- [ ] Trip\n  - [ ] Tickets\n    - [x] Seats\n  - [ ] Bags\n- [ ] Home\n");
});

test("checking an item checks its children, and unchecking one unchecks its parents", () => {
  const items = readChecklist("- [ ] Trip\n  - [ ] Tickets\n    - [ ] Seats\n- [ ] Home\n");
  assert.deepEqual(
    toggleItem(items, 0).map((item) => item.checked),
    [true, true, true, false],
  );
  const all = toggleItem(items, 0);
  assert.deepEqual(
    toggleItem(all, 2).map((item) => item.checked),
    [false, false, false, false],
  );
  assert.equal(toggleTask("- [ ] A\n  - [ ] B\n", 0), "- [x] A\n  - [x] B\n");
});

test("moves an item with its children", () => {
  const items = readChecklist("- [ ] A\n  - [ ] A1\n- [ ] B\n- [ ] C\n");
  const text = (list: ReturnType<typeof readChecklist>) => writeChecklist(list);
  // A and its child go after B.
  assert.equal(text(moveItem(items, 0, 3, 0)), "- [ ] B\n- [ ] A\n  - [ ] A1\n- [ ] C\n");
  // C goes first, and can't be indented with nothing above it.
  assert.equal(text(moveItem(items, 3, 0, 1)), "- [ ] C\n- [ ] A\n  - [ ] A1\n- [ ] B\n");
  // B goes under A, after A1.
  assert.equal(text(moveItem(items, 2, 2, 1)), "- [ ] A\n  - [ ] A1\n  - [ ] B\n- [ ] C\n");
});

test("turns text into a checklist and back", () => {
  const items = toChecklist("Milk\n- Bread\n\n1. Eggs\n- [x] Jam");
  assert.deepEqual(
    items.map((item) => item.text),
    ["Milk", "Bread", "Eggs", "Jam"],
  );
  assert.equal(items[3]!.checked, true);
  assert.equal(fromChecklist(items), "Milk\nBread\nEggs\nJam");
});

test("ticks one task and leaves the rest", () => {
  const body = "Shopping\n- [ ] Milk\n- [x] Bread\n";
  assert.equal(toggleTask(body, 0), "Shopping\n- [x] Milk\n- [x] Bread\n");
  assert.equal(toggleTask(body, 1), "Shopping\n- [ ] Milk\n- [ ] Bread\n");
});

test("finds where each task's text is", () => {
  const body = "- [ ] Milk\n- [x] Bread\n- [ ]\n";
  assert.deepEqual(taskTexts(body), [
    { start: 6, end: 10 },
    { start: 17, end: 22 },
    { start: 28, end: 28 },
  ]);
  assert.equal(body.slice(17, 22), "Bread");
});
