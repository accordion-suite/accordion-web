import assert from "node:assert/strict";
import { test } from "node:test";

import { assetsOf } from "./update.ts";

function page(script: string, style: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="/app/icon-028EF957.svg" type="image/svg+xml">
<link rel="stylesheet" href="${style}">
<script type="module" src="${script}"></script>
</head>
<body><div id="app"></div></body>
</html>`;
}

test("reads the script and styles a page loads", () => {
  assert.equal(
    assetsOf(page("/app/main-2A54ABZ7.js", "/app/main-ORCARX5M.css")),
    "/app/main-2A54ABZ7.js /app/main-ORCARX5M.css",
  );
});

test("tells pages with new code apart", () => {
  const before = assetsOf(page("/app/main-2A54ABZ7.js", "/app/main-ORCARX5M.css"));
  assert.notEqual(assetsOf(page("/app/main-QX7KD2LM.js", "/app/main-ORCARX5M.css")), before);
  assert.notEqual(assetsOf(page("/app/main-2A54ABZ7.js", "/app/main-V3N8TT0C.css")), before);
});

test("finds nothing in a page that isn't the app's", () => {
  assert.equal(assetsOf("<!doctype html><title>Accordion needs repair</title><p>Some files are damaged.</p>"), null);
});
