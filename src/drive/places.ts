// Apps' places beside My Drive, such as Notes (decision 32). Each is a top
// folder of its own, which Drive shows as a tab below My Drive while its app
// is on, or while it holds anything, so turning an app off never hides
// anyone's files.

import { api } from "../api.ts";
import { t } from "../i18n.ts";
import type { Item } from "./item.ts";

/** One of the reader's places, as `/api/drive/places` lists them. */
export interface PlaceInfo {
  /** Such as "notes", the same as its module's name. */
  place: string;
  /** Such as "Notes". */
  name: string;
  /** Its top folder, once it exists. */
  id: string | null;
  /** Whether nothing is in it. */
  empty: boolean;
}

/** My Drive's place. */
export const MY_DRIVE = "drive";

/** The places loaded last, for naming them where a list says where items
 * are. */
let known: readonly PlaceInfo[] = [];

/** The reader's places, apart from My Drive. */
export async function loadPlaces(): Promise<readonly PlaceInfo[]> {
  known = await api<PlaceInfo[]>("GET", "/api/drive/places");
  return known;
}

/** Forgets the places, which belong to whoever was signed in before. */
export function forgetPlaces(): void {
  known = [];
}

/** What a place is called: "My Drive", or its app's name, such as Notes. */
export function placeName(place: string | null | undefined): string {
  if (!place || place === MY_DRIVE) return t("drive.myDrive");
  return known.find((known) => known.place === place)?.name ?? place;
}

/** A place's page. */
export function placePath(place: string | null | undefined): string {
  return !place || place === MY_DRIVE ? "/drive/my-drive" : `/drive/place/${place}`;
}

/** A folder's name, with a top folder named after its place, such as "My
 * Drive" or "Notes". */
export function folderName(folder: Pick<Item, "parent" | "name" | "place">): string {
  if (folder.parent !== null) return folder.name;
  return folder.place && folder.place !== MY_DRIVE ? folder.name : t("drive.myDrive");
}

/** Whether a top folder is an app's place rather than My Drive. */
export function isAppPlace(folder: Pick<Item, "parent" | "place">): boolean {
  return folder.parent === null && !!folder.place && folder.place !== MY_DRIVE;
}
