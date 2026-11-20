// The list of Docs' font files, which scripts/build.ts makes as it builds:
// family, weight, whether it's italic, the characters it has, and its
// address.
declare module "docs-fonts" {
  export const FACES: readonly (readonly [string, number, boolean, string, string])[];
}
