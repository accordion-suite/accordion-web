import assert from "node:assert/strict";
import { test } from "node:test";

import { fromChecklist, isChecklist, readChecklist, toChecklist, toggleTask, writeChecklist } from "./checklist.ts";

test("a note is a checklist when every line is a task", () => {
  assert.equal(isChecklist("- [ ] Milk\n- [x] Bread\n"), true);
  assert.equal(isChecklist("\n* [X] Eggs\n\n"), true);
  assert.equal(isChecklist("Shopping\n- [ ] Milk"), false);
  assert.equal(isChecklist(""), false);
});

test("reads and writes a checklist", () => {
  const items = readChecklist("- [ ] Milk\n- [x] Bread\n- [ ]\n");
  assert.deepEqual(items, [
    { checked: false, text: "Milk" },
    { checked: true, text: "Bread" },
    { checked: false, text: "" },
  ]);
  assert.equal(writeChecklist(items), "- [ ] Milk\n- [x] Bread\n- [ ]\n");
});

test("turns text into a checklist and back", () => {
  const items = toChecklist("Milk\n- Bread\n\n1. Eggs\n- [x] Jam");
  assert.deepEqual(items.map((item) => item.text), ["Milk", "Bread", "Eggs", "Jam"]);
  assert.equal(items[3]!.checked, true);
  assert.equal(fromChecklist(items), "Milk\nBread\nEggs\nJam");
});

test("ticks one task and leaves the rest", () => {
  const body = "Shopping\n- [ ] Milk\n- [x] Bread\n";
  assert.equal(toggleTask(body, 0), "Shopping\n- [x] Milk\n- [x] Bread\n");
  assert.equal(toggleTask(body, 1), "Shopping\n- [ ] Milk\n- [ ] Bread\n");
});
