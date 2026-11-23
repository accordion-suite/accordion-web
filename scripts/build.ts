// Builds the web app into dist/ (decision 13). npm run build compiles this
// script with esbuild first, so it runs on any Node.js.
//
// The same source, esbuild version, and Node.js build give the same files,
// so a release built on the developer's computer matches CI's (decision 9).
// The Node.js build matters because its zlib and Brotli make the compressed
// copies, and Node.js's own builds use a different zlib from Ubuntu's, so
// the suite's release build downloads a pinned Node.js. File names carry a
// hash of their contents, and the compressed copies have no timestamps.
//
// dist/index.html is the page the server sends for every address in the
// app, and dist/app/ holds the scripts, styles, and icons. The manifest in
// dist/manifest.webmanifest lets phones and computers install the app. Each
// file also has .gz and .br copies, so the server never compresses on a
// request. PNGs and fonts are compressed already, so they don't.
//
// Docs' fonts are files in dist/app/ too, one for each style and language
// of each font in src/docs/fonts.ts, and for each weight of a font that
// isn't variable. The editor imports the list of them
// from "docs-fonts", which this script makes as it builds.
//
// dist/files.json lists every file with its SHA-256 hash. The server checks
// the files against it as it starts, and says so if any is missing or
// changed. The build fails if the page, the manifest, or a script names a
// file that isn't in the list.

import { createHash } from "node:crypto";
import { build, type Metafile, type Plugin } from "esbuild";
import { access, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";

import { FONTS } from "../src/docs/fonts.ts";

const OUT = "dist";
const ENTRY = "src/main.tsx";
const ICONS = "src/icon";
// The installed app's colors before its styles load, such as behind the
// icon while it opens. They match --page in src/app.css.
const LIGHT = "#f1f4f9";
const DARK = "#111418";
// Drive's first load, compressed with gzip. The build fails above it, so
// the first load stays fast on a Raspberry Pi over 4G (decision 13).
const BUDGET = 150 * 1024;

/** Makes the "docs-fonts" module: every font file, with the family, weights,
 * style, and characters each one is for, as FontFace takes them. Importing
 * each file through esbuild names it by its hash and copies it to dist/app/.
 * A variable font has one file for each style and language with all its
 * weights. Others have one for each weight too. The build fails if a font's
 * weights in src/docs/fonts.ts aren't the ones its package has. */
const docsFonts: Plugin = {
  name: "docs-fonts",
  setup(builder) {
    builder.onResolve({ filter: /^docs-fonts$/ }, () => ({ path: "docs-fonts", namespace: "docs-fonts" }));
    builder.onLoad({ filter: /.*/, namespace: "docs-fonts" }, async () => {
      const imports: string[] = [];
      const ranges: string[] = [];
      const faces: string[] = [];
      for (const font of FONTS) {
        const folder = resolve("node_modules", font.package);
        const metadata = JSON.parse(await readFile(join(folder, "metadata.json"), "utf8")) as {
          id: string;
          family: string;
          subsets: string[];
          weights: number[];
          styles: string[];
          variable?: { wght?: { min: string; max: string } };
        };
        if (metadata.family !== font.name) throw new Error(`${font.package} is ${metadata.family}, not ${font.name}.`);
        if (metadata.weights.join() !== font.weights.join()) {
          throw new Error(`${font.package} has weights ${metadata.weights.join(", ")}, not ${font.weights.join(", ")}.`);
        }
        const axis = metadata.variable?.wght;
        const variable = font.package.startsWith("@fontsource-variable/");
        if (variable && !axis) throw new Error(`${font.package} has no weight axis.`);
        // A variable file's weights, as FontFace's "100 900", or each weight.
        const files: [string, string][] = variable
          ? [["wght", `${axis!.min} ${axis!.max}`]]
          : font.weights.map((weight) => [String(weight), String(weight)]);
        const unicode = JSON.parse(await readFile(join(folder, "unicode.json"), "utf8")) as Record<string, string>;
        let found = 0;
        for (const subset of metadata.subsets) {
          const range = unicode[subset];
          if (!range) continue;
          for (const [part, weights] of files) {
            for (const style of metadata.styles) {
              const file = join(folder, "files", `${metadata.id}-${subset}-${part}-${style}.woff2`);
              if (!(await access(file).then(() => true, () => false))) continue;
              let at = ranges.indexOf(range);
              if (at < 0) at = ranges.push(range) - 1;
              imports.push(`import f${imports.length} from ${JSON.stringify(file)};`);
              faces.push(`[${JSON.stringify(font.name)},${JSON.stringify(weights)},${style === "italic"},R[${at}],f${imports.length - 1}]`);
              found++;
            }
          }
        }
        if (found === 0) throw new Error(`${font.package} has no font files.`);
      }
      const contents = `${imports.join("\n")}
const R = ${JSON.stringify(ranges)};
export const FACES = [${faces.join(",")}];
`;
      return { contents, loader: "js", resolveDir: process.cwd() };
    });
  },
};

await rm(OUT, { recursive: true, force: true });
const { metafile } = await build({
  entryPoints: [ENTRY],
  bundle: true,
  outdir: join(OUT, "app"),
  entryNames: "[name]-[hash]",
  chunkNames: "[name]-[hash]",
  assetNames: "[name]-[hash]",
  format: "esm",
  splitting: true,
  minify: true,
  // Browsers from about 2023 on. Older ones get a page that doesn't load.
  target: ["chrome111", "edge111", "firefox114", "safari16.4"],
  jsx: "automatic",
  jsxImportSource: "preact",
  charset: "utf8",
  metafile: true,
  logLevel: "warning",
  loader: { ".woff2": "file" },
  // Fonts are named from the page, which isn't in dist/app/.
  publicPath: "/app/",
  plugins: [docsFonts],
});

// The files the first load needs: the entry, the chunks it imports right
// away, and its styles.
function firstLoad(meta: Metafile): { script: string; style: string; files: string[] } {
  const outputs = Object.entries(meta.outputs);
  const entry = outputs.find(([, output]) => output.entryPoint === ENTRY);
  if (!entry) throw new Error(`esbuild didn't build ${ENTRY}.`);
  const [script, output] = entry;
  if (!output.cssBundle) throw new Error(`${ENTRY} has no styles.`);
  const files = new Set([script, output.cssBundle]);
  const pending = [script];
  for (let file = pending.pop(); file; file = pending.pop()) {
    for (const imported of meta.outputs[file]?.imports ?? []) {
      if (imported.kind === "import-statement" && !files.has(imported.path)) {
        files.add(imported.path);
        pending.push(imported.path);
      }
    }
  }
  return { script, style: output.cssBundle, files: [...files] };
}

const { script, style, files } = firstLoad(metafile);
const url = (file: string) => "/" + file.slice(OUT.length + 1);

/** Copies an icon into dist/app/, named by a hash of its contents like the
 * scripts, and returns its address. */
async function icon(name: string): Promise<string> {
  const content = await readFile(join(ICONS, name));
  const hash = createHash("sha256").update(content).digest("hex").slice(0, 8).toUpperCase();
  const dot = name.lastIndexOf(".");
  const file = join(OUT, "app", `${name.slice(0, dot)}-${hash}${name.slice(dot)}`);
  await writeFile(file, content);
  return url(file);
}

// The whole server is one app, so it opens at the server's address, and
// every page there, including the account and admin pages, stays in its
// window.
const manifest = {
  id: "/",
  name: "Accordion",
  short_name: "Accordion",
  start_url: "/",
  scope: "/",
  display: "standalone",
  background_color: LIGHT,
  theme_color: LIGHT,
  icons: [
    { src: await icon("icon-192.png"), sizes: "192x192", type: "image/png" },
    { src: await icon("icon-512.png"), sizes: "512x512", type: "image/png" },
    // Filled to the edges, for phones that cut the icon to their own shape.
    { src: await icon("icon-maskable-192.png"), sizes: "192x192", type: "image/png", purpose: "maskable" },
    { src: await icon("icon-maskable-512.png"), sizes: "512x512", type: "image/png", purpose: "maskable" },
  ],
};
await writeFile(join(OUT, "manifest.webmanifest"), JSON.stringify(manifest, null, 2) + "\n");
const tabIcon = await icon("icon.svg");
// iPhones and iPads round the corners themselves, and fill see-through ones
// with black.
const homeScreenIcon = await icon("apple-touch-icon.png");
const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" media="(prefers-color-scheme: light)" content="${LIGHT}">
<meta name="theme-color" media="(prefers-color-scheme: dark)" content="${DARK}">
<title>Accordion</title>
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="${tabIcon}" type="image/svg+xml">
<link rel="apple-touch-icon" href="${homeScreenIcon}">
<link rel="stylesheet" href="${url(style)}">
<script type="module" src="${url(script)}"></script>
</head>
<body>
<div id="app"></div>
<noscript>Accordion needs JavaScript. Turn it on in your browser's settings, then reload this page.</noscript>
</body>
</html>
`;
await writeFile(join(OUT, "index.html"), page);

const sizes = new Map<string, number>();
for (const entry of await readdir(OUT, { recursive: true, withFileTypes: true })) {
  // PNGs and fonts are compressed already.
  if (!entry.isFile() || entry.name.endsWith(".png") || entry.name.endsWith(".woff2")) continue;
  const file = join(entry.parentPath, entry.name);
  const content = await readFile(file);
  const gzipped = gzipSync(content, { level: 9 });
  sizes.set(file, gzipped.length);
  await writeFile(`${file}.gz`, gzipped);
  await writeFile(
    `${file}.br`,
    brotliCompressSync(content, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }),
  );
}

const hashes: Record<string, string> = {};
const entries = await readdir(OUT, { recursive: true, withFileTypes: true });
for (const entry of entries.filter((entry) => entry.isFile())) {
  const file = join(entry.parentPath, entry.name);
  hashes[relative(OUT, file).split(sep).join("/")] = createHash("sha256").update(await readFile(file)).digest("hex");
}
const named = [
  ...[...page.matchAll(/(?:href|src)="\/([^"]+)"/g)].map((match) => match[1] ?? ""),
  ...manifest.icons.map((icon) => icon.src.slice(1)),
  ...Object.values(metafile.outputs).flatMap((output) =>
    output.imports.filter((imported) => !imported.external).map((imported) => relative(OUT, imported.path)),
  ),
];
const missing = named.filter((file) => !(file in hashes));
if (missing.length > 0) {
  console.error(`The build names files it didn't make: ${[...new Set(missing)].join(", ")}.`);
  process.exit(1);
}
const sorted = Object.fromEntries(Object.entries(hashes).sort(([a], [b]) => (a < b ? -1 : 1)));
await writeFile(join(OUT, "files.json"), JSON.stringify({ files: sorted }, null, 2) + "\n");

const total = files.reduce((sum, file) => sum + (sizes.get(file) ?? 0), 0);
for (const file of files.sort()) {
  console.log(`${file}  ${((sizes.get(file) ?? 0) / 1024).toFixed(1)} KB compressed`);
}
console.log(`First load: ${(total / 1024).toFixed(1)} KB of ${BUDGET / 1024} KB.`);
if (total > BUDGET) {
  console.error(
    `The first load is over its ${BUDGET / 1024} KB budget. Load less up front, such as by importing a page's code when it opens.`,
  );
  process.exit(1);
}
