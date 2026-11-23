// The list of Docs' font files, which scripts/build.ts makes as it builds:
// family, weights (such as "400", or "100 900" for a variable font),
// whether it's italic, the characters it has, and its address.
declare module "docs-fonts" {
  export const FACES: readonly (readonly [string, string, boolean, string, string])[];
}
