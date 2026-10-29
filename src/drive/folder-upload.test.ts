import assert from "node:assert/strict";
import { test } from "node:test";

import { ApiError } from "../api.ts";
import { type Folders, type Tree, foldersNeeded, makeFolders } from "./folder-upload.ts";

function tree(paths: string[][], empty: string[][] = []): Tree {
  return { files: paths.map((path) => ({ file: new File([], "f"), path })), folders: empty };
}

/** Folders kept in memory, with "Taken" already a file in the top folder
 * and "Photos" already a folder there. */
class FakeFolders implements Folders {
  made: string[] = [];
  private next = 0;

  async create(parent: string, name: string) {
    if (parent === "top" && (name === "Taken" || name === "Photos")) {
      throw new ApiError(409, "This folder already has something with that name.");
    }
    this.made.push(`${parent}/${name}`);
    return `id-${++this.next}`;
  }

  async find(parent: string, name: string) {
    return parent === "top" && name === "Photos" ? "photos" : null;
  }
}

test("needs each folder once, parents first", () => {
  const needed = foldersNeeded(
    tree([["Trip", "Day 1"], ["Trip", "Day 1"], ["Trip"], []], [["Trip", "Day 2", "Empty"]]),
  );
  assert.deepEqual(needed, [["Trip"], ["Trip", "Day 1"], ["Trip", "Day 2"], ["Trip", "Day 2", "Empty"]]);
});

test("makes folders inside the ones it just made", async () => {
  const folders = new FakeFolders();
  const ids = await makeFolders("top", tree([["Trip", "Day 1"]]), folders);
  assert.deepEqual(folders.made, ["top/Trip", "id-1/Day 1"]);
  assert.equal(ids.get("Trip/Day 1"), "id-2");
  assert.equal(ids.get(""), "top");
});

test("adds to a folder that's already there", async () => {
  const folders = new FakeFolders();
  const ids = await makeFolders("top", tree([["Photos", "2026"]]), folders);
  assert.equal(ids.get("Photos"), "photos");
  assert.deepEqual(folders.made, ["photos/2026"]);
});

test("stops at a file with the folder's name", async () => {
  await assert.rejects(makeFolders("top", tree([["Taken"]]), new FakeFolders()), (problem: ApiError) => {
    assert.match(problem.message, /Taken/);
    return true;
  });
});
