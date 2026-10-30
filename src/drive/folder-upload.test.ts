import assert from "node:assert/strict";
import { test } from "node:test";

import { ApiError } from "../api.ts";
import { type Child, type Folders, type Tree, clashes, foldersNeeded, placeTree } from "./folder-upload.ts";

function tree(paths: string[][], empty: string[][] = []): Tree {
  return { files: paths.map((path) => ({ file: new File([], path.pop() ?? "f"), path })), folders: empty };
}

const TOP = { id: "top", name: "Drive" };

/** Folders kept in memory. The top folder starts with a file "Logo.png",
 * a file "Notes.txt", and a folder "Photos", which has a file "Beach.jpg"
 * and a folder "2026". */
class FakeFolders implements Folders {
  made: string[] = [];
  private next = 0;
  private contents = new Map<string, Child[]>([
    [
      "top",
      [
        { name: "Logo.png", kind: "file" },
        { name: "Notes.txt", kind: "file" },
        { name: "Photos", kind: "folder", id: "photos" },
      ],
    ],
    [
      "photos",
      [
        { name: "Beach.jpg", kind: "file" },
        { name: "2026", kind: "file" },
      ],
    ],
  ]);

  async create(parent: string, name: string) {
    if (this.contents.get(parent)?.some((child) => child.name === name)) {
      throw new ApiError(409, "This folder already has something with that name.");
    }
    this.made.push(`${parent}/${name}`);
    const id = `id-${++this.next}`;
    this.contents.set(parent, [...(this.contents.get(parent) ?? []), { name, kind: "folder", id }]);
    return id;
  }

  async children(parent: string) {
    return this.contents.get(parent) ?? [];
  }

  /** Adds an item behind the upload's back, as another device would. */
  sneak(parent: string, child: Child) {
    this.contents.set(parent, [...(this.contents.get(parent) ?? []), child]);
  }
}

function names(placed: Awaited<ReturnType<typeof placeTree>>): string[] {
  return placed.map((file) => `${file.folder.id}/${file.name}`);
}

test("needs each folder once, parents first", () => {
  const needed = foldersNeeded(
    tree([["Trip", "Day 1", "a"], ["Trip", "Day 1", "b"], ["Trip", "c"], ["d"]], [["Trip", "Day 2", "Empty"]]),
  );
  assert.deepEqual(needed, [["Trip"], ["Trip", "Day 1"], ["Trip", "Day 2"], ["Trip", "Day 2", "Empty"]]);
});

test("finds clashes only with items of the same kind", () => {
  const here: Child[] = [
    { name: "Logo.png", kind: "file" },
    { name: "Photos", kind: "folder" },
    { name: "Trip", kind: "file" },
  ];
  const found = clashes(tree([["Logo.png"], ["Photos", "a.jpg"], ["Trip", "b.jpg"]]), here);
  assert.deepEqual(
    found.map((child) => child.name),
    ["Logo.png", "Photos"],
  );
});

test("makes folders inside the ones it just made", async () => {
  const folders = new FakeFolders();
  const placed = await placeTree(TOP, tree([["Trip", "Day 1", "a.jpg"]]), false, folders);
  assert.deepEqual(folders.made, ["top/Trip", "id-1/Day 1"]);
  assert.deepEqual(names(placed), ["id-2/a.jpg"]);
});

test("numbers an upload that meets an item of the other kind, even when replacing", async () => {
  const folders = new FakeFolders();
  const placed = await placeTree(TOP, tree([["Logo.png", "a.png"], ["Photos"]]), true, folders);
  assert.deepEqual(folders.made, ["top/Logo (1).png"]);
  assert.deepEqual(names(placed), ["id-1/a.png", "top/Photos (1)"]);
});

test("replacing adds to the folder that's there", async () => {
  const folders = new FakeFolders();
  const placed = await placeTree(
    TOP,
    tree([["Photos", "Beach.jpg"], ["Photos", "2026", "c.jpg"], ["Notes.txt"]]),
    true,
    folders,
  );
  // "2026" in Photos is a file, so the folder takes a free name.
  assert.deepEqual(folders.made, ["photos/2026 (1)"]);
  assert.deepEqual(names(placed), ["photos/Beach.jpg", "id-1/c.jpg", "top/Notes.txt"]);
});

test("keeping both numbers files and folders", async () => {
  const folders = new FakeFolders();
  const placed = await placeTree(TOP, tree([["Photos", "Beach.jpg"], ["Notes.txt"]]), false, folders);
  assert.deepEqual(folders.made, ["top/Photos (1)"]);
  assert.deepEqual(names(placed), ["id-1/Beach.jpg", "top/Notes (1).txt"]);
});

test("takes the next number when something takes a name first", async () => {
  const folders = new FakeFolders();
  const listed = folders.children.bind(folders);
  let first = true;
  folders.children = async (parent) => {
    const children = await listed(parent);
    // Another device makes "Trip" just after the top folder is listed.
    if (first) folders.sneak("top", { name: "Trip", kind: "folder", id: "other" });
    first = false;
    return children;
  };
  await placeTree(TOP, tree([["Trip", "a.jpg"]]), false, folders);
  assert.deepEqual(folders.made, ["top/Trip (1)"]);
});

test("stops at a conflict that isn't a name", async () => {
  const folders = new FakeFolders();
  folders.create = async () => {
    throw new ApiError(409, "This folder is in the trash.");
  };
  await assert.rejects(placeTree(TOP, tree([["Trip", "a.jpg"]]), false, folders), /trash/);
});
