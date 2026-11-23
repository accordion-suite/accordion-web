import assert from "node:assert/strict";
import { test } from "node:test";

import { EditorState } from "prosemirror-state";

import { onFontsReplaced, type Replaced } from "./fonts.ts";
import { schema } from "./schema.ts";
import { fontCheck } from "./text-style.ts";

const { font_family: family, font_weight: weight } = schema.marks;

/** A paragraph of `text` in `font`, with `heavy` as its weight, after an
 * editor with the font check takes it in. */
function checked(text: string, font: string, heavy?: number) {
  const state = EditorState.create({ schema, plugins: [fontCheck(() => true)] });
  const marks = [family!.create({ family: font }), ...(heavy ? [weight!.create({ weight: heavy })] : [])];
  const tr = state.tr.insert(1, schema.text(text, marks));
  return state.apply(tr).doc.firstChild!.firstChild!;
}

test("text in a font Docs doesn't have gets the font Docs uses, and says so", async () => {
  const told: Replaced[][] = [];
  const stop = onFontsReplaced((replaced) => told.push([...replaced]));
  try {
    const georgia = checked("old", "Georgia");
    assert.equal(family!.isInSet(georgia.marks)?.attrs["family"], "Gelasio");
    // Arial becomes Arimo, the font text has anyway, so no font of its own.
    assert.equal(family!.isInSet(checked("old", "Arial").marks), undefined);
    await Promise.resolve();
    assert.deepEqual(told, [
      [
        { from: "Georgia", to: "Gelasio", kind: "same" },
        { from: "Arial", to: "Arimo", kind: "same" },
      ],
    ]);
  } finally {
    stop();
  }
});

test("a weight the font doesn't have becomes the nearest it has", () => {
  // Lato has 100, 300, 400, 700, and 900.
  assert.equal(weight!.isInSet(checked("x", "Lato", 200).marks)?.attrs["weight"], 100);
  // Amatic SC has only regular and bold, so 600 is bold.
  const amatic = checked("x", "Amatic SC", 600);
  assert.equal(weight!.isInSet(amatic.marks), undefined);
  assert.ok(schema.marks["bold"]!.isInSet(amatic.marks));
  assert.equal(weight!.isInSet(checked("x", "Raleway", 300).marks)?.attrs["weight"], 300);
});
