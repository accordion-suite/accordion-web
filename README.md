# Accordion Web

The Accordion web app: Drive and every other module in your browser, installable on phones and computers. It's a TypeScript app built with esbuild and Preact, as [decision 13](https://github.com/accordion-suite/accordion/blob/main/docs/decisions/0013-the-web-app.md) explains.

This repo is part of [Accordion](https://github.com/accordion-suite/accordion), a self-hosted, zero-telemetry replacement for Google Workspace. Please open issues in the [main repo](https://github.com/accordion-suite/accordion/issues).

## Layout

- `src/shell/`: the app's frame, with sign-in, the top bar, and moving between pages.
- `src/drive/`, and later one folder per module: each module's pages. A module's pages call only its own API, such as `/api/drive`, and the server's shared endpoints, such as `/api/session`, so they could move with their module later.
- `src/messages/en.ts`: every string the app shows, in English, ready for translation.
- `scripts/build.ts`: the build, which writes `dist/`.

## Building

You need Node.js 22 or later. Install the packages without running their install scripts, then check, test, and build:

```sh
npm ci --ignore-scripts
npm run check
npm test
npm run build
```

The build writes the app to `dist/`, with compressed copies of each file, and fails if Drive's first load is over its 150 KB budget. The same source always builds the same files, so release builds can be compared (decision 9).

To try the app, point a development server at the build with the `ACCORDION_WEB_DIR` setting, and rebuild after each change.

## Adding a package

Each new package needs a reason in the commit that adds it, because every package is code that the build trusts. Install it with an exact version, and without install scripts:

```sh
npm install --ignore-scripts --save-exact <package>
```

CI checks that every package has a license that works with AGPL-3.0, comes from npm's registry, and has a checksum in `package-lock.json`.

## License

[AGPL-3.0 or later](LICENSE)
