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
// app, and dist/app/ holds the scripts and styles. Each file also has .gz
// and .br copies, so the server never compresses on a request.

import { build, type Metafile } from "esbuild";
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";

const OUT = "dist";
const ENTRY = "src/main.tsx";
// Drive's first load, compressed with gzip. The build fails above it, so
// the first load stays fast on a Raspberry Pi over 4G (decision 13).
const BUDGET = 150 * 1024;

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
await writeFile(
  join(OUT, "index.html"),
  `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Accordion</title>
<link rel="stylesheet" href="${url(style)}">
<script type="module" src="${url(script)}"></script>
</head>
<body>
<div id="app"></div>
<noscript>Accordion needs JavaScript. Turn it on in your browser's settings, then reload this page.</noscript>
</body>
</html>
`,
);

const sizes = new Map<string, number>();
for (const entry of await readdir(OUT, { recursive: true, withFileTypes: true })) {
  if (!entry.isFile()) continue;
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
